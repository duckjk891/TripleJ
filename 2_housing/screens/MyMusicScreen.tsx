import { useState, useCallback, useMemo, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Share,
  Linking,
} from 'react-native';
import { showAlert } from '../utils/appAlert';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useAuthStore } from '../stores/authStore';
import { useLyricsStore } from '../stores/lyricsStore';
import { useLikesStore } from '../stores/likesStore';
import api, { BACKEND_BASE_URL } from '../services/api';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';
import { AppText, EmptyState, Button, Tag } from '../components/ui';
import LoginPrompt from '../components/LoginPrompt';
import TrackRow from '../components/TrackRow';
import TrackActionSheet from '../components/TrackActionSheet';
import TrackShareDownloadSheet, { SheetMode, downloadTrackMp3 } from '../components/TrackShareDownloadSheet';
// v3.96(A-2): 내 앨범 관리 — 앨범 탭 + 생성 모달, 상세/관리는 AlbumDetailScreen
import AlbumCreateModal from '../components/AlbumCreateModal';
import { Album, getMyAlbums, albumCoverUri } from '../services/albumService';
// v3.117: 내 아티스트 요약 행 — 다중 아티스트 정본(GET /character/list) + 레거시 /me 폴백
import { listArtists, artistSheetUrl, ServerArtist } from '../services/characterService';
// v3.210 ③: AI 곡 Inst. 버전 생성 — trackService 계약(backend 조 병렬, PLAN v3.210)
import { requestInstrumental, getInstrumentalStatus } from '../services/trackService';
import { confirmStarSpend } from '../utils/starSpendConfirm';
// v3.215 ④: Inst = 작곡(composer) 디렉터 영역 — 생성 전 쿨다운 게이트 (MusicGeneration 관행)
import { getFatigueStatus } from '../services/fatigueService';
import { showFatigueCooldownDialog } from '../utils/fatigueGate';
// v3.114: 내 채널(피드·커뮤니티) — MAIDOL 내 채널 구성 반영. FeedCard·이미지 블록(v3.111) 재사용
import FeedCard from '../components/feed/FeedCard';
import FeedImageBlock, { feedImageUri } from '../components/feed/FeedImageBlock';
import { playTrackNow } from '../services/playback';
// v3.228 W1: Inst. job 전역 추적(작업실 말풍선·도착 알림·재시작 환불 정리) — 곡별 서버 claim은 그대로
import { registerGenJob } from '../services/generationTracker';
import { findInstJobForTrack } from '../services/genJobs/inst';

interface Track {
  id: number;
  title: string;
  uploader_nickname: string;
  ai_model: string;
  genre: string[];
  mood: string[];
  audio_url: string;
  play_count: number;
  like_count: number;
  created_at: string;
  cover_image: string;
  is_public?: boolean;
  lyrics?: string;
}

// v3.115: 상위 탭 3개(곡·앨범/피드/커뮤니티 — UserChannel과 동일 탭명)로 재구성.
// 기존 작곡/앨범/작사 콘텐츠는 '곡·앨범' 안 하위 칩(곡/앨범/작사)으로 그대로 재배치.
type MyMusicTab = 'music' | 'feed' | 'community';
type MusicSubTab = 'tracks' | 'albums' | 'lyrics';

// v3.70과 짝(FeedScreen): 텍스트 블록의 [item]{JSON} 마커 → 아이템 카드. 파싱 실패 시 일반 텍스트 폴백.
interface FeedItemAttach { name?: string; category?: string; url?: string; img?: string }
function parseItemMarker(text?: string): FeedItemAttach | null {
  if (!text || !text.startsWith('[item]')) return null;
  try { return JSON.parse(text.slice(6)); } catch { return null; }
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}.${m}.${d}`;
}

function getCoverUrl(coverImage: string): string {
  return `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(coverImage)}`;
}

export default function MyMusicScreen({ navigation }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const lyricsStore = useLyricsStore();
  const { track: playingTrack } = usePlayerStore();
  const hasMiniPlayer = !!playingTrack;
  const [activeTab, setActiveTab] = useState<MyMusicTab>('music');
  const [musicSub, setMusicSub] = useState<MusicSubTab>('tracks'); // v3.115: 곡·앨범 탭 하위 칩
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [expandedLyrics, setExpandedLyrics] = useState<Set<string>>(new Set());
  const [actionTrack, setActionTrack] = useState<Track | null>(null); // ⋮ 더보기 대상
  const likedMap = useLikesStore((s) => s.liked);
  const syncLikes = useLikesStore((s) => s.sync);
  const [sdTrack, setSdTrack] = useState<Track | null>(null);   // 공유/다운로드 선택지 대상
  const [sdMode, setSdMode] = useState<SheetMode>('share');
  // v3.210 ③: Inst. 생성 진행 중인 트랙 id 집합 — 진행 중엔 ⋮ 메뉴에서 항목 제외(중복 요청 방지)
  const [instBusy, setInstBusy] = useState<Record<string, boolean>>({});
  const [myCharacter, setMyCharacter] = useState<{ preview_url: string; sheet_object_name: string } | null>(null);
  // v3.117: 다중 아티스트 목록(대표 요약 행용) — 빈 배열이면 myCharacter(/me)로 레거시 폴백
  const [artists, setArtists] = useState<ServerArtist[]>([]);
  // v3.96(A-2): 내 앨범 탭
  const [albums, setAlbums] = useState<Album[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [showAlbumCreate, setShowAlbumCreate] = useState(false);
  // v3.114: 내가 쓴 피드/커뮤니티 글
  const [feeds, setFeeds] = useState<any[]>([]);
  const [notices, setNotices] = useState<any[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedRefreshing, setFeedRefreshing] = useState(false);
  // v3.115: 프로필 팔로워/팔로잉 수 (null=미조회 — '-' 표시)
  const [followerCount, setFollowerCount] = useState<number | null>(null);
  const [followingCount, setFollowingCount] = useState<number | null>(null);

  const fetchTracks = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    try {
      const res = await api.get('/tracks/my', {
        params: { page: 1, limit: 20, sort: 'created_at' },
      });
      const list = res.data.tracks || [];
      setTracks(list);
      if (list.length) syncLikes(list.map((t: Track) => String(t.id)));
    } catch (e) {
      console.error('[MyMusic] fetch error', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchMyCharacter = useCallback(async () => {
    try {
      const res = await api.get('/character/me');
      const ch = res.data?.character;
      console.log('[MyMusic] /character/me response:', JSON.stringify(res.data));
      if (ch?.sheet_object_name) {
        // presigned URL은 internal host를 가리킬 수 있어 모바일에서 안 열림 → 항상 백엔드 proxy 사용
        // cache-buster: RN Image 캐시 우회 (옷 저장 후 옛 이미지 표시 방지)
        const url = `${BACKEND_BASE_URL}/api/character/preview/${ch.sheet_object_name}?t=${Date.now()}`;
        setMyCharacter({ preview_url: url, sheet_object_name: ch.sheet_object_name });
      } else {
        setMyCharacter(null);
      }
    } catch (err: any) {
      console.warn('[MyMusic] fetchMyCharacter error:', err?.response?.status, err?.message);
      setMyCharacter(null);
    }
  }, []);

  // v3.117: 내 아티스트 목록 — GET /character/list. 빈 배열이면 fetchMyCharacter의
  // /character/me 시트로 폴백 표시(레거시 미마이그레이션 계정 구제 — MyArtists v3.116과 동일 취지).
  const fetchArtists = useCallback(async () => {
    try {
      const { characters } = await listArtists();
      setArtists(characters);
    } catch (err: any) {
      console.error('[MyMusic] fetchArtists 실패', { status: err?.response?.status });
      setArtists([]);
    }
  }, []);

  // v3.96(A-2): 내 앨범 목록 (GET /albums/my — 비공개 포함)
  const fetchAlbums = useCallback(async () => {
    setAlbumsLoading(true);
    try {
      const res = await getMyAlbums(1, 50);
      setAlbums(res.albums);
    } catch (err: any) {
      console.error('[MyMusic] fetchAlbums 실패', { status: err?.response?.status });
    } finally {
      setAlbumsLoading(false);
    }
  }, []);

  // v3.114: 내가 쓴 피드·커뮤니티 글 — UserChannelScreen과 동일 계약 GET /feeds/user/{id}?kind=feed|community
  // (백엔드 v137: viewer==owner면 비공개 글도 포함해 내려온다)
  const fetchFeeds = useCallback(async (isRefresh = false) => {
    const uid = useAuthStore.getState().user?.id;
    if (!uid) return;
    if (isRefresh) setFeedRefreshing(true);
    else setFeedLoading(true);
    if (__DEV__) console.info('[MyMusic] fetchFeeds', { refresh: isRefresh });
    try {
      const [fRes, cRes] = await Promise.allSettled([
        api.get(`/feeds/user/${uid}`, { params: { kind: 'feed', limit: 50 } }),
        api.get(`/feeds/user/${uid}`, { params: { kind: 'community', limit: 50 } }),
      ]);
      if (fRes.status === 'fulfilled') setFeeds(fRes.value.data?.feeds || []);
      else console.error('[MyMusic] 피드 조회 실패', { status: (fRes.reason as any)?.response?.status });
      if (cRes.status === 'fulfilled') setNotices(cRes.value.data?.feeds || []);
      else console.error('[MyMusic] 커뮤니티 조회 실패', { status: (cRes.reason as any)?.response?.status });
    } finally {
      setFeedLoading(false);
      setFeedRefreshing(false);
    }
  }, []);

  // v3.115: 팔로워/팔로잉 수 — 백엔드 실측 계약:
  //  - 팔로워: GET /follows/summary/{내id} 의 follower_count (UserChannel이 타 유저에 쓰는 것과 동일 라우트)
  //  - 팔로잉: 전용 카운트 API 없음 → GET /follows/following?page=1&limit=1 의 total 활용
  const fetchFollowCounts = useCallback(async () => {
    const uid = useAuthStore.getState().user?.id;
    if (!uid) return;
    const [sRes, gRes] = await Promise.allSettled([
      api.get(`/follows/summary/${uid}`),
      api.get('/follows/following', { params: { page: 1, limit: 1 } }),
    ]);
    if (sRes.status === 'fulfilled') setFollowerCount(sRes.value.data?.follower_count ?? 0);
    else console.error('[MyMusic] 팔로워 수 조회 실패', { status: (sRes.reason as any)?.response?.status });
    if (gRes.status === 'fulfilled') setFollowingCount(gRes.value.data?.total ?? 0);
    else console.error('[MyMusic] 팔로잉 수 조회 실패', { status: (gRes.reason as any)?.response?.status });
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (user) {
        fetchTracks();
        fetchMyCharacter();
        fetchArtists(); // v3.117: 작업실에서 생성/삭제 후 복귀 시 focus로 요약 행 갱신
        fetchAlbums();
        fetchFeeds(); // FeedCompose에서 작성 후 goBack 복귀 시 focus로 재조회 → 목록 갱신
        fetchFollowCounts();
      }
    }, [user])
  );

  // v3.117: 요약 행 데이터 — 대표(is_default) 우선, 없으면 첫 번째. list가 비면 /me 레거시 폴백.
  // artistSheetUrl은 cache-buster(Date.now) 포함이라 렌더마다 새 URL이 되지 않게 useMemo로 고정.
  const artistView = useMemo(() => {
    // v3.163(대표): 대표 지정 개념 제거 → v3.217 ③ 복원: 대표(is_default) 우선,
    // 대표가 없으면 "가장 최근에 만든" 아티스트 폴백(대표 지정이 실사용 의미를 갖도록)
    const def = artists.length
      ? artists.find((a) => a.is_default)
        ?? [...artists].sort((a, b) =>
          new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
        )[0]
      : null;
    if (def) {
      return {
        name: def.name || '나의 아티스트',
        thumb: def.sheet_object_name ? artistSheetUrl(def.sheet_object_name) : def.sheet_url,
        extra: artists.length - 1,
      };
    }
    if (myCharacter) return { name: '나의 아티스트', thumb: myCharacter.preview_url, extra: 0 };
    return null;
  }, [artists, myCharacter]);

  // v3.179(대표): 내 목소리 진입 카드 제거에 따라 handleOpenVoices 삭제 — VoiceManage는 아티스트 흐름에서 접근

  // v3.117: 탭 시 작업실 스택의 내 아티스트 목록으로(크로스 탭 — 이 화면의 Studio 진입 관행 동일)
  const handleOpenArtist = () => {
    if (__DEV__) console.info('[MyMusic] 내 아티스트 → Studio/MyArtists');
    // v3.117.1: Studio 스택 중간(MyArtists)으로 바로 점프하면 스택에 Map이 없어
    // 뒤로가기가 차트(탭 폴백)로 떨어짐 — Map을 먼저 깔고 MyArtists를 얹어
    // 뒤로가기 = 작업실(Map) 복귀가 되게 한다.
    navigation.navigate('Studio', { screen: 'Map' });
    navigation.navigate('Studio', { screen: 'MyArtists' });
  };

  const handleDeleteTrack = (trackId: string, title: string) => {
    showAlert(
      '곡 삭제',
      `"${title}"을(를) 삭제하시겠습니까?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/tracks/${trackId}`);
              setTracks((prev) => prev.filter((t) => String(t.id) !== trackId));
            } catch {
              showAlert('오류', '삭제에 실패했습니다.');
            }
          },
        },
      ]
    );
  };

  // v3.221: ⋮ 다운로드 → [영상, 음원] 2택 — 영상은 영상 디렉터로 이동(해당 곡 프리셋),
  // 음원은 기존 mp3 다운로드 즉시 실행(TrackShareDownloadSheet 모듈 헬퍼 위임).
  const handleDownloadChoice = (t: Track) => {
    if (__DEV__) console.info('[MyMusic] 다운로드 선택 다이얼로그', { id: t.id });
    showAlert('다운로드', '받을 형식을 선택해주세요.', [
      { text: '취소', style: 'cancel' },
      {
        text: '영상',
        onPress: () => {
          // v3.222 ①: initial:false — Studio 미방문 세션에도 스택 [Map, VideoDirector] 적재.
          // Map 마운트만으로 엔터명 헤더 셋업(useLayoutEffect) = 정상 진입과 동일 타이틀·뒤로가기.
          navigation.getParent()?.navigate('MainTabs', {
            screen: 'Studio',
            params: { screen: 'VideoDirector', initial: false, params: { initialTrackId: String(t.id) } },
          });
        },
      },
      { text: '음원', onPress: () => { downloadTrackMp3({ id: String(t.id), title: t.title }, !!user); } },
    ]);
  };

  const handlePublishToChart = (trackId: string, title: string) => {
    showAlert(
      '차트 업로드',
      `"${title}"을(를) 차트에 공개하시겠습니까?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '업로드',
          onPress: async () => {
            try {
              await api.put(`/tracks/${trackId}`, { is_public: true });
              showAlert('완료', '차트에 업로드되었습니다!');
              fetchTracks(true);
            } catch (err: any) {
              // v3.217 ②: report_blinded 곡 재공개 400 등 — 서버 메시지 그대로 표출
              console.error('[MyMusic] 차트 업로드 실패', { trackId, status: err?.response?.status });
              showAlert('오류', err?.response?.data?.error || '업로드에 실패했습니다.');
            }
          },
        },
      ]
    );
  };

  // v3.217 ②: 공개곡 → 차트에서 숨기기(is_public=false) — 업로드와 양방향(PUT /tracks/{id} 기존 API).
  // 차트는 응답 조립 시점 is_public 재필터라 숨김 즉시 차트에서 소멸(서버 무변경 — PLAN F2).
  const handleHideFromChart = (trackId: string, title: string) => {
    showAlert(
      '차트에서 숨기기',
      `"${title}"을(를) 차트에서 숨기시겠습니까?\n숨긴 곡은 언제든 다시 차트에 업로드할 수 있어요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '숨기기',
          onPress: async () => {
            try {
              await api.put(`/tracks/${trackId}`, { is_public: false });
              // 즉시 상태 반영("차트 스트리밍 중" 표기 해제) 후 서버 진실로 재동기화
              setTracks((prev) =>
                prev.map((t) => (String(t.id) === trackId ? { ...t, is_public: false } : t))
              );
              showAlert('완료', '차트에서 숨겼습니다.');
              fetchTracks(true);
            } catch (err: any) {
              console.error('[MyMusic] 차트 숨기기 실패', { trackId, status: err?.response?.status });
              showAlert('오류', err?.response?.data?.error || '차트에서 숨기지 못했습니다.');
            }
          },
        },
      ]
    );
  };

  // v3.210 ③: Inst. 항목 노출 조건 — AI 곡(ai_model suno 한정, 발매 시 'Suno' 저장 — MusicResult:464),
  // 이미 (Inst.)인 곡·생성 진행 중인 곡 제외 (PLAN v3.210 확정 스펙)
  const canMakeInstrumental = (t: Track): boolean =>
    (t.ai_model || '').toLowerCase() === 'suno'
    && !(t.title || '').includes('(Inst.)')
    && !instBusy[String(t.id)];

  // v3.222 ②: Inst 폴링 소유권을 InstLoadingScreen으로 이관 — 이 화면은 진입 배선만 담당.
  // ①과 동일한 헤더 정합(initial:false — Map 하부 적재, ← 주입은 InstLoading이 동일 관행 적용).
  const goInstLoading = (trackId: string, title: string, resume = false) => {
    // v3.223 C-10: 요청마다 nonce — StudioStack getId로 매 진입 새 InstLoading 인스턴스(이전 상태 잔존 방지)
    const nonce = String(Date.now());
    if (__DEV__) console.info('[Inst] InstLoading 진입', { trackId, resume, nonce });
    navigation.getParent()?.navigate('MainTabs', {
      screen: 'Studio',
      params: {
        screen: 'InstLoading',
        initial: false,
        params: { trackId, title, nonce, ...(resume ? { resume: true } : {}) },
      },
    });
  };

  // v3.222 ②: 기존 pollInstrumental while 루프 제거 — 복귀 focus 시 busy 트랙 status 1회 확인으로
  // instBusy 해제 + 목록 갱신(⋮ 진행 중 항목 제외 회귀는 instBusy 유지로 보존).
  // instBusy는 ref 미러로 읽어 focus effect 재구독(재fetch) 없이 최신값을 본다.
  const instBusyRef = useRef(instBusy);
  instBusyRef.current = instBusy;
  const reconcileInstBusy = useCallback(async () => {
    const busyIds = Object.keys(instBusyRef.current).filter((id) => instBusyRef.current[id]);
    if (!busyIds.length) return;
    let anyDone = false;
    await Promise.all(
      busyIds.map(async (trackId) => {
        try {
          const data = await getInstrumentalStatus(trackId);
          const st = String(data?.status || '').toLowerCase();
          if (__DEV__) console.info('[Inst] focus 상태 확인', { trackId, status: st });
          if (
            st === 'completed' || st === 'success' || st === 'done' ||
            st === 'failed' || st === 'error'
          ) {
            setInstBusy((prev) => ({ ...prev, [trackId]: false }));
            anyDone = true;
          }
        } catch (err: any) {
          // 확인 실패는 다음 focus에서 재시도(진행 자체는 서버 백그라운드)
          console.error('[Inst] focus 상태 확인 실패', { trackId, status: err?.response?.status });
        }
      })
    );
    if (anyDone) fetchTracks(true); // 완료/실패 확정 — 새 "<원제> (Inst.)" 반영 등 목록 갱신
  }, [fetchTracks]);

  // v3.222 ②: InstLoading에서 복귀(또는 임의 재진입) focus 시 busy 트랙 1회 확인
  useFocusEffect(
    useCallback(() => {
      if (user) reconcileInstBusy();
    }, [user, reconcileInstBusy])
  );

  // v3.215 ④: Inst = 작곡(composer) 디렉터 영역 — 생성 진입 전 쿨다운 게이트.
  // cooldown_remaining_sec>0면 확인 다이얼로그 미진입 + 공용 쿨다운 다이얼로그(12곳 관행).
  // 조회 실패는 게이트 오픈 — 서버 429(과금 전)가 최종 방어(MusicGeneration 관행).
  const handleCreateInstrumental = async (track: Track) => {
    // v3.228: 이 곡의 Inst.가 추적 중(진행 중)이면 새 요청 없이 진행 화면으로(과금·피로 게이트 전)
    const tracked = findInstJobForTrack(String(track.id));
    if (tracked?.lastStatus === 'processing') {
      if (__DEV__) console.info('[Inst] 추적 중인 Inst. — 진행 화면으로', { trackId: track.id, jobId: tracked.jobId });
      goInstLoading(String(track.id), track.title, true);
      return;
    }
    try {
      const status = await getFatigueStatus('composer');
      const remain = Math.max(0, Math.floor(status?.cooldown_remaining_sec ?? 0));
      if (remain > 0) {
        if (__DEV__) console.info('[MyMusic] [fatigue:composer] Inst 게이트 — 남은', remain, '초');
        showFatigueCooldownDialog({
          status,
          remainingSec: remain,
          director: 'composer',
          onCleared: () => confirmCreateInstrumental(track), // 해제 시 재진입 — 확인 다이얼로그 재개
        });
        return;
      }
    } catch (err: any) {
      // 조회 실패 = 게이트 오픈 (서버 429가 최종 방어)
      console.warn('[MyMusic] [fatigue:composer] 상태 조회 실패 — 게이트 오픈', {
        status: err?.response?.status,
      });
    }
    confirmCreateInstrumental(track);
  };

  // v3.210 ③: ⋮ 메뉴 [Inst. 버전 만들기] — 확인 다이얼로그(⭐ 비용 안내) → 생성 요청 → 폴링
  // v3.230 A5-2(tester 1차): 공통 ⭐ 확인(confirmStarSpend)으로 교체 — 보유 ⭐ 표시·잔액 부족 안내·
  // 휴식 단축 직후(onCleared·409 이미 해제) 0.8초 잠금이 다른 경로와 동일하게 적용된다.
  const confirmCreateInstrumental = async (track: Track) => {
    const trackId = String(track.id);
    if (instBusy[trackId]) return;
    const ok = await confirmStarSpend({
      source: 'MyMusic.inst',
      costKey: 'instrumental',
      action: 'Inst. 버전 만들기',
      message: `"${track.title}"에서 보이스를 뺀 연주(Inst.) 버전을 만들어요. 완료되면 "${track.title} (Inst.)" 트랙이 내 곡에 추가돼요.`,
    });
    if (!ok) {
      console.info('[Inst] ⭐ 확인 취소 — 요청 없음', { trackId });
      return;
    }
    if (instBusy[trackId]) return;
    setInstBusy((prev) => ({ ...prev, [trackId]: true }));
    if (__DEV__) console.info('[Inst] 생성 시작', { trackId });
    try {
      const accepted = await requestInstrumental(trackId);
      // v3.228: 202 수신 즉시 전역 추적 등록(진행 화면 이탈·재시작 후에도 회수)
      if (accepted?.job_id) {
        registerGenJob({ kind: 'inst', serverJobId: String(accepted.job_id), meta: { trackId, title: track.title } });
      }
      // v3.222 ②: '생성 시작' alert + 백그라운드 폴링 → InstLoading 진행 화면으로 교체
      // (완료 표시·미리듣기는 그 화면이 담당, 이탈 시 복귀 focus 확인으로 갈음 — 결정 2 기본안)
      goInstLoading(trackId, track.title);
    } catch (err: any) {
      const status = err?.response?.status;
      console.error('[Inst] 생성 요청 실패', { trackId, status });
      setInstBusy((prev) => ({ ...prev, [trackId]: false }));
      if (status === 429 || err?.response?.data?.error === 'director_fatigue') {
        // v3.215 ④: 서버 composer 게이트 429(과금 전 무비용 — 게이트→과금 순서) —
        // 선게이트와의 레이스는 동일 쿨다운 다이얼로그로 대응 (VideoDirector 관행)
        const remain = Math.max(
          0,
          Math.floor(err?.response?.data?.cooldown_remaining_sec ?? 0)
        );
        showFatigueCooldownDialog({
          status: null, // 게이트 통과 직후라 최신 status 미보유 — 다이얼로그가 계약 폴백 표기
          remainingSec: remain > 0 ? remain : 1,
          director: 'composer',
          onCleared: () => confirmCreateInstrumental(track),
        });
      } else if (status === 402) {
        showAlert('알림', '스타(⭐)가 부족해요. 음악을 듣거나 출석체크로 스타를 모아보세요!');
      } else if (status === 409) {
        // v3.210 tester U-7③: 서버 409는 2형상 — existing_track_id(이미 완성) vs job_id(진행 중)
        if (err?.response?.data?.existing_track_id) {
          showAlert('알림', err?.response?.data?.error || '이미 이 곡의 Inst. 버전이 있어요.');
        } else {
          // v3.222 ②: 진행 중 409 → 동일 화면 resume 모드(폴링만 — MusicLoading resume 관행)
          // v3.228: 진행 중 job(다른 창·기기 포함)을 추적기에 편입
          const busyJobId = err?.response?.data?.job_id;
          if (busyJobId) {
            registerGenJob({ kind: 'inst', serverJobId: String(busyJobId), meta: { trackId, title: track.title }, source: 'conflict' });
          }
          setInstBusy((prev) => ({ ...prev, [trackId]: true }));
          goInstLoading(trackId, track.title, true);
        }
      } else if (status === 404) {
        // v3.214 ③: 서버 /instrumental 미배포(v3.210) 과도기 안내 — 배포 후 404는 곡 미존재뿐이라 무해
        showAlert('알림', 'Inst. 만들기 준비 중이에요. 잠시 후 다시 시도해주세요.');
      } else {
        showAlert('오류', err?.response?.data?.error || 'Inst. 생성 요청에 실패했어요. 잠시 후 다시 시도해주세요.');
      }
    }
  };

  // 내 곡 공유 (내가 만든 곡만 노출되는 화면이므로 소유권 체크 불필요)
  const handleShareTrack = async (track: Track) => {
    const link = `${BACKEND_BASE_URL}/track/${track.id}`;
    if (__DEV__) console.info('[MyMusic] share', { id: track.id });
    try {
      await Share.share({ message: `MAIDOL에서 내가 만든 곡 "${track.title}" 들어보세요!\n베타 테스트 기간 가입 시 ⭐50 추가 증정!\n${link}` });
    } catch (err: any) {
      console.error('[MyMusic] share 실패', { message: err?.message });
    }
  };

  // 내 곡 다운로드 — presigned URL 받아 열기(웹=다운로드/새탭, 네이티브=브라우저 저장)
  const handleDownloadTrack = async (track: Track) => {
    if (__DEV__) console.info('[MyMusic] download 호출', { id: track.id });
    try {
      const { data } = await api.post(`/tracks/download/${track.id}`);
      const url = data?.download_url;
      if (!url) { showAlert('오류', '다운로드 링크를 가져오지 못했어요.'); return; }
      await Linking.openURL(url);
    } catch (err: any) {
      console.error('[MyMusic] download 실패', { status: err?.response?.status });
      showAlert('오류', '다운로드에 실패했어요. 잠시 후 다시 시도해 주세요.');
    }
  };

  if (!user) {
    // 로그인 CTA는 피드/검색/플레이리스트/작업실과 동일하게 공통 LoginPrompt + 세로 중앙 정렬
    return (
      <View style={[styles.container, { justifyContent: 'center', alignItems: 'center' }]}>
        <LoginPrompt
          title="내가 만든 음악 보관함"
          desc={'AI로 만든 나만의 곡을\n한곳에서 관리하고 들을 수 있어요!'}
          onPress={() => navigation.getParent()?.navigate('Settings')}
        />
      </View>
    );
  }

  if (loading && tracks.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyContainer}>
          <ActivityIndicator size="large" color={colors.accent.primary} />
        </View>
      </View>
    );
  }

  // 행 디자인은 차트·검색·플레이리스트와 동일한 공용 TrackRow (좌측 순번은 비움).
  // 내 곡 고유 기능(공유·다운로드·차트 업로드·삭제)은 ⋮ 메뉴로 옮겨 보존한다.
  const renderTrack = ({ item }: { item: Track }) => (
    <TrackRow
      track={{ ...item, id: String(item.id) }}
      liked={!!likedMap[String(item.id)]}
      onPress={() => navigation.getParent()?.navigate('Player', { track: item })}
      onMore={() => setActionTrack(item)}
      footer={
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 3, alignItems: 'center' }}>
          {[...(item.genre || []).slice(0, 2), ...(item.mood || []).slice(0, 1)].map((t, i) => (
            <View key={i} style={{ backgroundColor: colors.bg.surface2, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
              <AppText style={{ fontSize: 10, color: colors.text.secondary }}>{t}</AppText>
            </View>
          ))}
          {item.is_public ? (
            <AppText style={{ fontSize: 10, color: colors.status.success, fontWeight: '600' }}>차트 스트리밍 중</AppText>
          ) : null}
        </View>
      }
    />
  );

  // v3.114: 내가 쓴 피드/커뮤니티 카드 — 공용 FeedCard 재사용(좋아요·댓글·삭제 등 액션 그대로).
  // 블록 렌더는 FeedScreen 규칙(텍스트/이미지 v3.111/트랙/[item] 마커). 카드 여백 탭 시 상세(FeedDetail)로.
  const renderFeed = ({ item }: { item: any }) => {
    const blocks: any[] = item.blocks || [];
    const rawText = blocks.filter((b) => b.type === 'text' && b.text);
    const textBlocks = rawText.filter((b) => !parseItemMarker(b.text));
    const itemBlocks = rawText.map((b) => parseItemMarker(b.text)).filter(Boolean) as FeedItemAttach[];
    const trackBlocks = blocks.filter((b) => b.type === 'track' && b.track?.id);
    const imageBlocks = blocks.filter((b) => b.type === 'image' && (b.image_url || b.object_name));
    const queue = trackBlocks.map((b) => b.track);
    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => {
          if (__DEV__) console.info('[MyMusic] 피드 상세로', { feedId: item.id });
          navigation.getParent()?.navigate('FeedDetail', { feedId: String(item.id) });
        }}
        accessibilityLabel="피드 상세 보기"
      >
        <FeedCard
          feed={item}
          requireLogin={() => true}
          onDeleted={() => fetchFeeds(true)}
          onPressAuthor={() => navigation.getParent()?.navigate('UserChannel', { authorId: user.id, name: user.nickname })}
          renderBlocks={() => (
            <View>
              {textBlocks.map((b, i) => (
                <AppText key={`t${i}`} style={styles.feedBody}>{b.text}</AppText>
              ))}
              {imageBlocks.map((b, i) => {
                const uri = feedImageUri(b);
                return uri ? <FeedImageBlock key={`im${i}`} uri={uri} /> : null;
              })}
              {trackBlocks.map((b, i) => (
                <View key={`tr${i}`} style={styles.feedTrackWrap}>
                  <TrackRow
                    track={{ ...b.track, id: String(b.track.id) }}
                    liked={!!likedMap[String(b.track.id)]}
                    onPress={() => playTrackNow(b.track)} // v3.223 ①: 곡 단위 탭 = append(재생목록 보존)
                  />
                </View>
              ))}
              {itemBlocks.map((it, i) => (
                <TouchableOpacity
                  key={`it${i}`}
                  style={styles.feedItemCard}
                  activeOpacity={it.url ? 0.7 : 1}
                  accessibilityLabel={`아이템 ${it.name || ''}`}
                  onPress={() => {
                    if (!it.url) return;
                    Linking.openURL(it.url).catch((err) =>
                      console.error('[MyMusic] 아이템 링크 실패', { message: err?.message }));
                  }}
                >
                  <Feather name="shopping-bag" size={16} color={colors.text.secondary} />
                  <View style={{ flex: 1 }}>
                    <AppText style={{ fontSize: 11, color: colors.accent.primary }}>{it.category || '아이템'}</AppText>
                    <AppText style={{ fontSize: 13, color: colors.text.secondary }} numberOfLines={2}>{it.name || ''}</AppText>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          )}
        />
      </TouchableOpacity>
    );
  };

  // 성장 지표 계산 — v3.115: 레벨(LV·다음 레벨까지) 표시 제거(대표 지시, 이 화면 한정), 앨범·팔로워·팔로잉 수 추가
  const totalPlays = tracks.reduce((sum, t) => sum + (t.play_count ?? 0), 0);
  const bestTrack = tracks.length > 0
    ? [...tracks].sort((a, b) => (b.play_count ?? 0) - (a.play_count ?? 0))[0]
    : null;
  const companyLabel = user.company_name || `${user.nickname} 엔터테인먼트`;
  const displayLabel = `${user.nickname}${user.display_title ? ' ' + user.display_title : ' 대표'}`;

  return (
    <View style={styles.container}>
      {/* v3.179(대표): 콘텐츠가 하단 슬리버에 갇히는 문제 해결 — 화면 전체를 하나의
          ScrollView로 묶고, 성장카드·내 아티스트는 스크롤과 함께 접히며 탭바(+칩)만
          상단에 고정(sticky). 내부 FlatList/ScrollView는 inline 렌더로 전환(목록 소규모). */}
      <ScrollView
        stickyHeaderIndices={[2]}
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: hasMiniPlayer ? 140 : 80 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing || feedRefreshing}
            onRefresh={() => {
              if (__DEV__) console.info('[MyMusic] pull-refresh', { activeTab });
              if (activeTab === 'music') { fetchTracks(true); fetchAlbums(); }
              else fetchFeeds(true);
            }}
            tintColor={colors.accent.primary}
          />
        }
      >
      {/* 성장 카드 */}
      <View style={styles.growthWrap}>
        <LinearGradient
          colors={[...colors.gradient.twilight] as any}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.growthCard}
        >
          <View style={styles.growthHeaderRow}>
            <View style={{ flex: 1 }}>
              <AppText style={styles.growthCompany} numberOfLines={1}>{companyLabel}</AppText>
              <AppText style={styles.growthName} numberOfLines={1}>{displayLabel}님</AppText>
            </View>
            {/* v3.115: LV 배지 제거 — 레벨 표시는 마이페이지에서 뺀다(대표 지시) */}
          </View>
          {/* v3.115: 지표 5종 — 발매곡/앨범/재생/팔로워/팔로잉 (레벨 지표 제거). 5열이라 라벨은 짧게 */}
          <View style={styles.growthStatsRow}>
            <View style={styles.growthStat}>
              <AppText style={styles.growthStatValue}>{tracks.length}</AppText>
              <AppText style={styles.growthStatLabel}>발매곡</AppText>
            </View>
            <View style={styles.growthStatDivider} />
            <View style={styles.growthStat}>
              <AppText style={styles.growthStatValue}>{albums.length}</AppText>
              <AppText style={styles.growthStatLabel}>앨범</AppText>
            </View>
            <View style={styles.growthStatDivider} />
            <View style={styles.growthStat}>
              <AppText style={styles.growthStatValue}>{totalPlays.toLocaleString()}</AppText>
              <AppText style={styles.growthStatLabel}>재생</AppText>
            </View>
            <View style={styles.growthStatDivider} />
            <View style={styles.growthStat}>
              <AppText style={styles.growthStatValue}>{followerCount == null ? '-' : followerCount.toLocaleString()}</AppText>
              <AppText style={styles.growthStatLabel}>팔로워</AppText>
            </View>
            <View style={styles.growthStatDivider} />
            <View style={styles.growthStat}>
              <AppText style={styles.growthStatValue}>{followingCount == null ? '-' : followingCount.toLocaleString()}</AppText>
              <AppText style={styles.growthStatLabel}>팔로잉</AppText>
            </View>
          </View>
          {bestTrack && (
            <View style={styles.bestTrackRow}>
              <AppText style={styles.bestTrackLabel}>★ 베스트</AppText>
              <AppText style={styles.bestTrackTitle} numberOfLines={1}>{bestTrack.title}</AppText>
              <AppText style={styles.bestTrackPlay}>▶ {bestTrack.play_count ?? 0}</AppText>
            </View>
          )}
        </LinearGradient>
      </View>

      {/* v3.117: 내 아티스트 요약 행 — 대표 아티스트 썸네일+이름(여러 명이면 '외 N명'),
          탭 시 작업실 > 내 아티스트(MyArtists)로. list 빈 배열이면 /me 레거시 폴백 표시. */}
      <View style={styles.artistSection}>
        <AppText style={styles.artistSectionLabel}>내 아티스트</AppText>
        {artistView ? (
          <TouchableOpacity
            style={styles.artistCard}
            activeOpacity={0.85}
            onPress={handleOpenArtist}
            accessibilityLabel="내 아티스트 목록 보기"
          >
            {artistView.thumb ? (
              <Image source={{ uri: artistView.thumb }} style={styles.artistCardImage} />
            ) : (
              <View style={[styles.artistCardImage, { justifyContent: 'center', alignItems: 'center' }]}>
                <Feather name="user" size={22} color={colors.text.muted} />
              </View>
            )}
            <View style={styles.artistCardBody}>
              <AppText style={styles.artistCardTitle} numberOfLines={1}>
                {artistView.name}
                {artistView.extra > 0 ? <AppText style={styles.artistCardHint}>{`  외 ${artistView.extra}명`}</AppText> : null}
              </AppText>
              <AppText style={styles.artistCardHint}>탭하여 작업실 · 내 아티스트로</AppText>
            </View>
            <AppText style={styles.artistCardArrow}>{'›'}</AppText>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.artistEmpty}
            activeOpacity={0.85}
            onPress={handleOpenArtist}
            accessibilityLabel="아티스트 만들러 가기"
          >
            <View style={{ flex: 1 }}>
              <AppText style={styles.artistEmptyTitle}>아직 만든 아티스트가 없어요</AppText>
              <AppText style={styles.artistEmptyHint}>아티스트 디렉터에서 만들어보세요</AppText>
            </View>
            <AppText style={styles.artistEmptyButton}>아티스트 만들러 가기</AppText>
          </TouchableOpacity>
        )}
        {/* v3.179(대표): '내 목소리' 카드 제거 — 목소리는 아티스트 생성/상세의 목소리 연결에서
            관리(중복 진입점 정리). VoiceManage 라우트·화면은 보존(ArtistResult 등에서 사용). */}
      </View>

      {/* 탭 바 — v3.115 3탭. v3.179: sticky 블록(칩 포함) — 스크롤해도 상단 고정 */}
      <View style={styles.stickyTabs}>
        <View style={styles.tabBar}>
          {([
            { key: 'music', label: '곡·앨범' },
            { key: 'feed', label: '피드' },
            { key: 'community', label: '커뮤니티' },
          ] as { key: MyMusicTab; label: string }[]).map((t) => (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, activeTab === t.key && styles.tabActive]}
              onPress={() => setActiveTab(t.key)}
            >
              <AppText style={[styles.tabText, activeTab === t.key && styles.tabTextActive]} numberOfLines={1}>{t.label}</AppText>
            </TouchableOpacity>
          ))}
        </View>

        {/* v3.115: 곡·앨범 하위 칩(곡/앨범/작사) — 차트의 Tag 칩 필터 관행 재사용 */}
        {activeTab === 'music' && (
          <View style={styles.subTabRow}>
            {([
              { key: 'tracks', label: '곡' },
              { key: 'albums', label: '앨범' },
              { key: 'lyrics', label: '작사' },
            ] as { key: MusicSubTab; label: string }[]).map((s) => (
              <Tag key={s.key} label={s.label} selected={musicSub === s.key} onPress={() => setMusicSub(s.key)} />
            ))}
          </View>
        )}
      </View>

      {/* 곡(작곡) — v3.115: '곡·앨범 > 곡' 하위 칩으로 재배치(콘텐츠는 기존 작곡 탭 그대로) */}
      {/* v3.114: '음원 파일 올리기' dashed 진입 버튼 제거 — 레퍼런스 업로드는 작곡 대화에 이미 있어
          마이페이지에 둘 성격이 아님(대표 지시). TrackUploadScreen·trackService·라우트는 보존(진입점만 제거). */}
      {activeTab === 'music' && musicSub === 'tracks' && (
        <View>
          {tracks.length === 0 ? (
            <EmptyState title="아직 생성한 곡이 없어요." hint="작업실에서 곡을 만들어보세요!" />
          ) : (
            // v3.179: 부모 ScrollView inline 렌더 (당겨새로고침은 부모가 담당)
            tracks.map((item) => <View key={String(item.id)}>{renderTrack({ item })}</View>)
          )}
        </View>
      )}

      {/* v3.114: 피드/커뮤니티 탭 — 내가 쓴 글(비공개 포함) + 당겨새로고침. 카드 탭 시 상세로 */}
      {/* v3.115: 상단 [새 피드 작성]/[새 공지 작성] — FeedCompose로(공지는 kind='community'), 복귀 시 focus 재조회로 갱신 */}
      {(activeTab === 'feed' || activeTab === 'community') && (() => {
        const list = activeTab === 'feed' ? feeds : notices;
        return (
          <View style={styles.feedList}>
            <TouchableOpacity
              style={styles.composeBtn}
              activeOpacity={0.8}
              accessibilityLabel={activeTab === 'feed' ? '새 피드 작성' : '새 공지 작성'}
              onPress={() => {
                const kind = activeTab === 'community' ? 'community' : 'feed';
                if (__DEV__) console.info('[MyMusic] 새 글 작성 진입', { kind });
                navigation.getParent()?.navigate('FeedCompose', kind === 'community' ? { kind } : undefined);
              }}
            >
              <Feather name="edit-3" size={16} color={colors.accent.primary} />
              <AppText style={styles.albumCreateText}>{activeTab === 'feed' ? '새 피드 작성' : '새 공지 작성'}</AppText>
            </TouchableOpacity>
            {list.length === 0 ? (
              feedLoading ? (
                <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginTop: 24 }} />
              ) : activeTab === 'feed' ? (
                <EmptyState title="아직 작성한 피드가 없어요." hint="[새 피드 작성]으로 내 곡과 소식을 알려보세요!" />
              ) : (
                <EmptyState title="아직 커뮤니티 글이 없어요." hint="[새 공지 작성]으로 구독자에게 소식을 전해보세요!" />
              )
            ) : (
              list.map((item: any, i: number) => <View key={String(item.id ?? i)}>{renderFeed({ item })}</View>)
            )}
          </View>
        );
      })()}

      {/* v3.96(A-2): 앨범 — 내 앨범 목록 + 새 앨범 만들기. 탭하면 앨범 상세(관리 포함)로 */}
      {/* v3.115: '커버 보관함' 진입 버튼 제거(대표 지시) — 커버는 앨범 상세(관리)에서 다시 만들 수 있어
          마이페이지 중복 진입점 정리. CoverLibraryScreen·CoverLibrary 라우트는 보존(앨범 관리 내 커버 선택 등에서 사용). */}
      {activeTab === 'music' && musicSub === 'albums' && (
        <View style={{ paddingHorizontal: 16 }}>
          <TouchableOpacity style={styles.albumCreateBtn} activeOpacity={0.8} onPress={() => setShowAlbumCreate(true)}>
            <Feather name="plus" size={16} color={colors.accent.primary} />
            <AppText style={styles.albumCreateText}>새 앨범 만들기</AppText>
          </TouchableOpacity>
          {albumsLoading && albums.length === 0 ? (
            <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginTop: 24 }} />
          ) : albums.length === 0 ? (
            <EmptyState title="아직 만든 앨범이 없어요." hint="발매한 곡들을 묶어 앨범으로 소개해보세요!" />
          ) : (
            albums.map((a) => (
              <TouchableOpacity
                key={a.id} style={styles.albumRow} activeOpacity={0.75}
                // v3.220 ①: AlbumDetail이 MainTabs 숨김 탭이 되어 getParent 불필요 — 탭 형제 navigate + from
                onPress={() => navigation.navigate('AlbumDetail', { albumId: String(a.id), from: 'MyMusic' })}
                accessibilityLabel={`앨범 ${a.title}`}
              >
                <View style={styles.albumRowCover}>
                  {albumCoverUri(a.cover_image)
                    ? <Image source={{ uri: albumCoverUri(a.cover_image)! }} style={styles.albumRowCoverImg} />
                    : <AppText style={{ fontSize: 20, color: colors.text.muted }}>♪</AppText>}
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <AppText style={styles.albumRowTitle} numberOfLines={1}>{a.title}</AppText>
                  <AppText style={styles.albumRowMeta}>
                    {`${a.track_count ?? 0}곡${a.is_public === false ? ' · 비공개' : ''}`}
                  </AppText>
                </View>
                <Feather name="chevron-right" size={18} color={colors.text.muted} />
              </TouchableOpacity>
            ))
          )}
        </View>
      )}

      {/* 작사 — v3.115: '곡·앨범 > 작사' 하위 칩으로 재배치. DB에 저장된 트랙의 가사 + 현재 작업 중인 가사 */}
      {activeTab === 'music' && musicSub === 'lyrics' && (
        <View style={{ padding: 20 }}>
          {/* 현재 작업 중인 가사 - 완성된 곡이 없을 때만 표시 */}
          {lyricsStore.generatedLyrics && tracks.length === 0 ? (
            <TouchableOpacity
              style={styles.lyricsCard}
              activeOpacity={0.8}
              onPress={() => {
                setExpandedLyrics((prev) => {
                  const next = new Set(prev);
                  next.has('draft') ? next.delete('draft') : next.add('draft');
                  return next;
                });
              }}
            >
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <AppText style={{ fontSize: 11, color: colors.accent.primary, fontWeight: '600' }}>작업 중</AppText>
                <AppText style={{ fontSize: 12, color: colors.text.muted }}>{expandedLyrics.has('draft') ? '접기' : '펼치기'}</AppText>
              </View>
              {lyricsStore.generatedTitle ? (
                <AppText style={{ fontSize: 16, fontWeight: 'bold', color: colors.text.primary, marginTop: 6, marginBottom: 4 }}>{lyricsStore.generatedTitle}</AppText>
              ) : null}
              <View style={styles.lyricsTagRow}>
                {lyricsStore.genre ? <View style={styles.tag}><AppText style={styles.tagText}>{lyricsStore.genre}</AppText></View> : null}
                {lyricsStore.mood ? <View style={[styles.tag, styles.moodTag]}><AppText style={styles.tagText}>{lyricsStore.mood}</AppText></View> : null}
              </View>
              <AppText style={styles.lyricsPreview} numberOfLines={expandedLyrics.has('draft') ? undefined : 3}>{lyricsStore.generatedLyrics}</AppText>
              {!expandedLyrics.has('draft') && <AppText style={styles.lyricsHint}>탭하여 전체 가사 보기</AppText>}
            </TouchableOpacity>
          ) : null}

          {/* DB에 저장된 트랙의 가사 (곡 완성된 것) */}
          {tracks.filter((t) => t.lyrics).map((track) => {
            const key = String(track.id);
            const isExpanded = expandedLyrics.has(key);
            return (
              <TouchableOpacity
                key={key}
                style={[styles.lyricsCard, { marginBottom: 12 }]}
                activeOpacity={0.8}
                onPress={() => {
                  setExpandedLyrics((prev) => {
                    const next = new Set(prev);
                    next.has(key) ? next.delete(key) : next.add(key);
                    return next;
                  });
                }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <AppText style={{ fontSize: 16, fontWeight: 'bold', color: colors.text.primary }}>{track.title}</AppText>
                  <AppText style={{ fontSize: 12, color: colors.text.muted }}>{isExpanded ? '접기' : '펼치기'}</AppText>
                </View>
                <View style={[styles.lyricsTagRow, { marginTop: 6 }]}>
                  {(track.genre || []).map((g, i) => (
                    <View key={`g-${i}`} style={styles.tag}><AppText style={styles.tagText}>{g}</AppText></View>
                  ))}
                  {(track.mood || []).map((m, i) => (
                    <View key={`m-${i}`} style={[styles.tag, styles.moodTag]}><AppText style={styles.tagText}>{m}</AppText></View>
                  ))}
                </View>
                <AppText style={styles.lyricsPreview} numberOfLines={isExpanded ? undefined : 3}>{track.lyrics}</AppText>
              </TouchableOpacity>
            );
          })}

          {/* 완성된 곡도 없고 작업 중도 없으면 빈 상태 */}
          {tracks.filter((t) => t.lyrics).length === 0 && !lyricsStore.generatedLyrics ? (
            <EmptyState title="아직 작사한 기록이 없어요." hint="작업실에서 작사 디렉터와 대화해보세요!" />
          ) : null}
        </View>
      )}
      </ScrollView>

      {/* v3.96(A-2): 앨범 생성 모달 — 생성 성공 시 목록 갱신 + 상세로 이동 */}
      <AlbumCreateModal
        visible={showAlbumCreate}
        onClose={() => setShowAlbumCreate(false)}
        onCreated={(album) => {
          fetchAlbums();
          // v3.220 ①: 탭 형제 navigate + from — 생성 직후 상세에서 ← 시 마이페이지 복귀
          navigation.navigate('AlbumDetail', { albumId: String(album.id), from: 'MyMusic' });
        }}
      />

      {/* 공유·다운로드 선택지 (쇼츠/릴스/틱톡·화질별 영상·mp3) */}
      <TrackShareDownloadSheet
        visible={!!sdTrack}
        mode={sdMode}
        track={sdTrack ? { id: sdTrack.id, title: sdTrack.title } : null}
        onClose={() => setSdTrack(null)}
      />

      {/* 곡 더보기(⋮) — 공용 시트 + 내 곡 고유 기능(공유·다운로드·차트 업로드·삭제) */}
      <TrackActionSheet
        track={actionTrack ? { ...actionTrack, id: String(actionTrack.id) } : null}
        onClose={() => setActionTrack(null)}
        onPlay={(t) => navigation.getParent()?.navigate('Player', { track: t })}
        onLikeChanged={(trackId, delta) => setTracks((prev) => prev.map((t) =>
          String(t.id) === trackId ? { ...t, like_count: Math.max(0, (t.like_count ?? 0) + delta) } : t))}
        extraItems={actionTrack ? [
          // v3.221: 공유 항목 임시 숨김(사용자 지시 — 기능·시트는 보존, 항목만 미노출).
          // 다운로드 = [영상, 음원] 2택 다이얼로그 — 영상은 영상 디렉터로 연결(선곡 프리셋).
          { icon: 'download', label: '다운로드', onPress: () => handleDownloadChoice(actionTrack) },
          // v3.210 ③: AI 곡(suno) 한정 Inst. 버전 생성 — (Inst.) 곡·진행 중 곡 제외
          ...(canMakeInstrumental(actionTrack)
            ? [{ icon: 'disc' as const, label: 'Inst. 버전 만들기', onPress: () => handleCreateInstrumental(actionTrack) }]
            : []),
          // v3.217 ②: 공개↔숨김 양방향 — 공개곡="차트에서 숨기기", 비공개곡="차트에 업로드"(상호 배타)
          ...(actionTrack.is_public
            ? [{ icon: 'eye-off' as const, label: '차트에서 숨기기', onPress: () => handleHideFromChart(String(actionTrack.id), actionTrack.title) }]
            : [{ icon: 'upload-cloud' as const, label: '차트에 업로드', onPress: () => handlePublishToChart(String(actionTrack.id), actionTrack.title) }]),
          { icon: 'trash-2', label: '삭제', danger: true, onPress: () => handleDeleteTrack(String(actionTrack.id), actionTrack.title) },
        ] : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
  },
  // v3.179: sticky 탭 블록 — 스크롤 시 아래 콘텐츠가 비치지 않도록 배경 필수
  stickyTabs: {
    backgroundColor: colors.bg.deepest,
    zIndex: 10,
  },
  tabBar: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: colors.bg.surface1,
    marginBottom: 12,
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: colors.accent.primary,
  },
  tabText: {
    fontSize: 15, // v3.115: 상위 탭이 3개로 줄어 원래 크기 복원
    color: colors.text.muted,
    fontWeight: '600',
  },
  // v3.115: 곡·앨범 하위 칩(곡/앨범/작사) — 차트 chipRow 관행(가로 나열·gap 8)
  subTabRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  // v3.115: [새 피드 작성]/[새 공지 작성] — '새 앨범 만들기'와 동일한 dashed 버튼 관행
  composeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, marginBottom: 12, marginHorizontal: 4,
    borderWidth: 1, borderColor: colors.accent.primary, borderStyle: 'dashed' as any,
    borderRadius: 12,
  },
  tabTextActive: {
    color: colors.accent.primary,
  },
  userInfo: {
    paddingHorizontal: 20,
    marginBottom: 12,
  },
  userText: {
    fontSize: 16,
    color: colors.accent.primary,
    fontWeight: '600',
  },
  growthWrap: {
    paddingHorizontal: 16,
    paddingTop: 12,
    marginBottom: 12,
  },
  growthCard: {
    borderRadius: 16,
    padding: 16,
  },
  growthHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  growthCompany: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.75)',
    fontWeight: '600',
    marginBottom: 2,
  },
  growthName: {
    fontSize: 18,
    color: colors.text.primary,
    fontWeight: '700',
  },
  // v3.115: levelBadge* 스타일 제거(레벨 표시 삭제와 짝)
  growthStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(13,8,32,0.25)',
    borderRadius: 12,
    padding: 10,
  },
  growthStat: {
    flex: 1,
    alignItems: 'center',
  },
  growthStatDivider: {
    width: 1,
    height: 28,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  growthStatValue: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 2,
  },
  growthStatLabel: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.75)',
  },
  bestTrackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.15)',
    gap: 8,
  },
  bestTrackLabel: {
    fontSize: 11,
    color: colors.accent.secondary,
    fontWeight: '700',
  },
  bestTrackTitle: {
    flex: 1,
    fontSize: 13,
    color: colors.text.primary,
    fontWeight: '600',
  },
  bestTrackPlay: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
  },
  artistSection: {
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  artistSectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text.secondary,
    marginBottom: 8,
    marginLeft: 2,
  },
  artistCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface1,
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.accent.primary,
  },
  artistCardImage: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: colors.bg.surface2,
    marginRight: 12,
  },
  artistCardBody: {
    flex: 1,
  },
  artistCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 2,
  },
  artistCardHint: {
    fontSize: 11,
    color: colors.text.muted,
  },
  artistCardArrow: {
    fontSize: 28,
    color: colors.text.muted,
    marginLeft: 8,
  },
  artistEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface1,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderStyle: 'dashed' as any,
  },
  artistEmptyIcon: {
    fontSize: 28,
    marginRight: 12,
  },
  artistEmptyTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text.primary,
    marginBottom: 2,
  },
  artistEmptyHint: {
    fontSize: 11,
    color: colors.text.muted,
  },
  artistEmptyButton: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.accent.primary,
    marginLeft: 8,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingBottom: 100,
  },
  emptyIcon: {
    fontSize: 64,
    color: colors.border.subtle,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 16,
    color: colors.text.muted,
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 13,
    color: colors.border.default,
  },
  listContent: {
    // 행(TrackRow)이 자체 좌우 패딩을 가지므로 여기선 넣지 않는다(플레이리스트·차트와 동일 정렬)
    paddingBottom: 100,
  },
  trackItem: {
    flexDirection: 'row',
    backgroundColor: colors.bg.surface1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  coverImage: {
    width: 60,
    height: 60,
    borderRadius: 8,
  },
  coverPlaceholder: {
    backgroundColor: colors.bg.surface2,
    justifyContent: 'center',
    alignItems: 'center',
  },
  coverPlaceholderText: {
    fontSize: 24,
    color: colors.text.muted,
  },
  trackInfo: {
    flex: 1,
    marginLeft: 12,
    justifyContent: 'center',
  },
  trackTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.text.primary,
    marginBottom: 4,
  },
  tagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 4,
  },
  tag: {
    backgroundColor: 'rgba(168, 85, 247, 0.18)',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 4,
    marginBottom: 2,
  },
  moodTag: {
    backgroundColor: 'rgba(251, 191, 36, 0.15)',
  },
  tagText: {
    fontSize: 11,
    color: colors.text.secondary,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  statText: {
    fontSize: 12,
    color: colors.text.muted,
  },
  ownActionsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  ownActionBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 5, paddingHorizontal: 10,
    backgroundColor: colors.bg.surface2, borderRadius: 8,
  },
  ownActionText: { fontSize: 12, color: colors.text.secondary, fontWeight: '600' },
  // v3.96(A-2): 앨범 탭
  albumCreateBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, marginBottom: 12,
    borderWidth: 1, borderColor: colors.accent.primary, borderStyle: 'dashed' as any,
    borderRadius: 12,
  },
  albumCreateText: { fontSize: 13, fontWeight: '700', color: colors.accent.primary },
  albumRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 12, marginBottom: 10,
  },
  albumRowCover: {
    width: 56, height: 56, borderRadius: 8, overflow: 'hidden',
    backgroundColor: colors.bg.surface2, justifyContent: 'center', alignItems: 'center',
  },
  albumRowCoverImg: { width: 56, height: 56 },
  albumRowTitle: { fontSize: 15, fontWeight: '600', color: colors.text.primary, marginBottom: 3 },
  albumRowMeta: { fontSize: 12, color: colors.text.muted },
  // v3.114: 피드/커뮤니티 탭 — FeedScreen 리스트 여백(12) 관행. 트랙/아이템 블록은 인셋 배경
  feedList: { paddingHorizontal: 12, paddingBottom: 100 },
  feedBody: { marginTop: 8, fontSize: 14, lineHeight: 21, color: colors.text.secondary },
  feedTrackWrap: { marginTop: 10, backgroundColor: colors.bg.deepest, borderRadius: 12, overflow: 'hidden' },
  feedItemCard: {
    marginTop: 10, backgroundColor: colors.bg.deepest, borderRadius: 12,
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10,
  },
  lyricsSection: { paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: colors.text.primary, marginBottom: 10 },
  lyricsCard: { backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: colors.border.subtle },
  lyricsTagRow: { flexDirection: 'row', gap: 6, marginBottom: 8 },
  lyricsPreview: { color: colors.text.secondary, fontSize: 14, lineHeight: 22, marginBottom: 8 },
  lyricsHint: { color: colors.text.muted, fontSize: 12, fontStyle: 'italic' },
});
