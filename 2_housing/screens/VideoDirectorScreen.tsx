// [VideoDirector] v3.171(대표) — 영상 디렉터 대화: 공유영상(기본 뮤비) 생성·내보내기.
// 백엔드 share-video(v129/v137 이식 완료)를 대화형 UI로 노출 — 곡 선택 → 형식 선택(비율
// 미리보기 카드) → 생성 → 미리보기 + 저장/공유. 서버 무변경(공개 곡 전용·무과금·워터마크 번인).
// 대화 관행은 CoverGenerationScreen(이미지 디렉터)과 동일.
import { useEffect, useRef, useState } from 'react';
import {
  StyleSheet, View, ScrollView, TouchableOpacity, Image, ActivityIndicator, Platform, Linking,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Feather } from '@expo/vector-icons';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import { colors } from '../theme/colors';
import api, { BACKEND_BASE_URL } from '../services/api';

const VIDEO_PORTRAIT = require('../assets/portraits/video_director.png');

interface MyTrack {
  id: string; title: string; cover_image?: string | null; cover_image_url?: string | null;
  is_public?: boolean;
}

interface ChatMessage { type: 'director' | 'user'; text: string }

// 형식 3종 — 서버 share-video format과 1:1. ratioW/H는 미리보기 도식용.
const FORMATS: { key: 'sns' | 'wide' | 'kakao'; label: string; desc: string; ratioW: number; ratioH: number }[] = [
  { key: 'sns', label: 'SNS용 세로', desc: '9:16 · 릴스/쇼츠/틱톡', ratioW: 36, ratioH: 64 },
  { key: 'wide', label: '와이드 가로', desc: '16:9 · 유튜브/PC', ratioW: 64, ratioH: 36 },
  { key: 'kakao', label: '카톡 프로필 배경', desc: '15초 · 프로필 배경용', ratioW: 42, ratioH: 64 },
];

const coverUri = (t: MyTrack): string | null => {
  const img = t.cover_image || t.cover_image_url;
  return img ? `${BACKEND_BASE_URL}/api/upload/cover-preview/${encodeURIComponent(img)}` : null;
};

export default function VideoDirectorScreen({ navigation }: any) {
  const [chat, setChat] = useState<ChatMessage[]>([
    { type: 'director', text: '안녕하세요! 영상 디렉터예요. 🎬\n곡을 고르면 커버와 가사가 어우러진 공유 영상을 만들어 드릴게요. 어떤 곡으로 만들까요?' },
  ]);
  const [tracks, setTracks] = useState<MyTrack[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(true);
  const [selected, setSelected] = useState<MyTrack | null>(null);
  const [step, setStep] = useState<'pick' | 'format' | 'making' | 'done'>('pick');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [madeFormat, setMadeFormat] = useState<'sns' | 'wide' | 'kakao' | null>(null);
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120);
  }, [chat, step]);

  useEffect(() => {
    (async () => {
      try {
        console.info('[VideoDirector] calling /tracks/my');
        const res = await api.get('/tracks/my');
        const list: MyTrack[] = (res.data?.tracks || res.data || []).map((t: any) => ({
          id: String(t.id), title: t.title, cover_image: t.cover_image,
          cover_image_url: t.cover_image_url, is_public: t.is_public !== false,
        }));
        setTracks(list);
      } catch (err: any) {
        console.error('[VideoDirector] 내 곡 로드 실패', { status: err?.response?.status });
      } finally {
        setLoadingTracks(false);
      }
    })();
  }, []);

  const pushDirector = (text: string) => setChat((p) => [...p, { type: 'director', text }]);
  const pushUser = (text: string) => setChat((p) => [...p, { type: 'user', text }]);

  const handlePickTrack = (t: MyTrack) => {
    if (t.is_public === false) {
      // share-video는 공개 곡 전용(서버 정책) — 비공개는 안내
      showAlert('공개 곡만 가능해요', '공유 영상은 차트에 공개된 곡으로만 만들 수 있어요.\n마이페이지에서 곡을 공개로 전환한 뒤 다시 시도해주세요.');
      return;
    }
    setSelected(t);
    pushUser(t.title);
    pushDirector('좋아요! 어떤 형태의 영상으로 만들까요?\n어느 것이든 가사 자막과 AI 생성 표시가 함께 들어가요.');
    setStep('format');
  };

  const handlePickFormat = async (fmt: 'sns' | 'wide' | 'kakao') => {
    if (!selected || step === 'making') return;
    const f = FORMATS.find((x) => x.key === fmt)!;
    pushUser(f.label);
    pushDirector('영상을 만들고 있어요! 커버와 가사를 엮는 중… 잠시만 기다려주세요. 🎞️');
    setStep('making');
    console.info('[VideoDirector] share-video 생성', { trackId: selected.id, fmt });
    try {
      const res = await api.post(`/tracks/${selected.id}/share-video`, null, {
        params: { format: fmt }, timeout: 300000,
      });
      const path = res.data?.video_url;
      if (!path) throw new Error('video_url 없음');
      const url = path.startsWith('http') ? path : `${BACKEND_BASE_URL}${path}`;
      setVideoUrl(url);
      setMadeFormat(fmt);
      pushDirector('완성됐어요! 아래에서 미리 보고, 저장하거나 공유해보세요. 🎉');
      setStep('done');
    } catch (err: any) {
      const status = err?.response?.status;
      console.error('[VideoDirector] share-video 실패', { trackId: selected.id, fmt, status });
      pushDirector(
        status === 404 ? '이 곡은 공개 상태가 아니라 영상을 만들 수 없었어요. 공개로 전환 후 다시 시도해주세요.'
        : status === 400 ? '커버 이미지가 없어 영상을 만들 수 없었어요. 이미지 디렉터에게 커버를 먼저 부탁해보세요!'
        : '영상 생성에 실패했어요. 잠시 후 다시 시도해주세요.'
      );
      setStep('format');
    }
  };

  // TrackShareDownloadSheet 관행 — 네이티브는 기기 저장+OS 공유 시트, 웹은 링크 열기
  const handleSave = async () => {
    if (!videoUrl || !selected || saving) return;
    setSaving(true);
    try {
      if (Platform.OS === 'web') {
        await Linking.openURL(videoUrl);
      } else {
        const dest = `${FileSystem.cacheDirectory}${selected.title.replace(/[^\w가-힣]/g, '_')}_${madeFormat}.mp4`;
        console.info('[VideoDirector] 기기 저장 시작', { dest: dest.slice(-40) });
        const res = await FileSystem.downloadAsync(videoUrl, dest);
        if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(res.uri);
        else showAlert('저장 완료', '영상이 저장되었습니다.');
      }
    } catch (err: any) {
      console.error('[VideoDirector] 저장/공유 실패', { message: err?.message });
      showAlert('오류', '영상을 저장하지 못했어요. 잠시 후 다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  };

  const handleAnotherFormat = () => {
    setVideoUrl(null);
    pushDirector('다른 형태로도 만들어 볼까요? 형식을 골라주세요!');
    setStep('format');
  };

  const handleAnotherTrack = () => {
    setSelected(null);
    setVideoUrl(null);
    pushDirector('다른 곡으로 만들어 볼까요? 곡을 골라주세요!');
    setStep('pick');
  };

  return (
    <View style={styles.container}>
      <ScrollView ref={scrollRef} style={styles.chatArea} contentContainerStyle={{ paddingBottom: 16 }}>
        {chat.map((m, i) => (
          <View key={i} style={[styles.msgRow, m.type === 'user' && styles.msgRowUser]}>
            {m.type === 'director' && <Image source={VIDEO_PORTRAIT} style={styles.portrait} />}
            <View style={[styles.bubble, m.type === 'user' ? styles.bubbleUser : styles.bubbleDirector]}>
              <AppText style={m.type === 'user' ? styles.bubbleUserText : styles.bubbleText}>{m.text}</AppText>
            </View>
          </View>
        ))}
        {step === 'making' && (
          <View style={styles.makingRow}>
            <ActivityIndicator size="small" color={colors.accent.primary} />
            <AppText variant="caption" tone="muted">영상 합성 중… (최대 몇 분 걸릴 수 있어요)</AppText>
          </View>
        )}
        {step === 'done' && videoUrl ? (
          <View style={styles.resultBox}>
            <Video
              source={{ uri: videoUrl }}
              style={madeFormat === 'wide' ? styles.previewWide : styles.previewTall}
              useNativeControls
              resizeMode={ResizeMode.CONTAIN}
              onError={(e: any) => console.error('[VideoDirector] 미리보기 실패', { message: e?.message || String(e) })}
            />
            <TouchableOpacity style={styles.primaryBtn} onPress={handleSave} disabled={saving} activeOpacity={0.8}>
              {saving ? <ActivityIndicator size="small" color={colors.text.primary} />
                : <AppText style={styles.primaryBtnText}>기기에 저장 / 공유하기</AppText>}
            </TouchableOpacity>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <TouchableOpacity style={[styles.outlineBtn, { flex: 1 }]} onPress={handleAnotherFormat} activeOpacity={0.8}>
                <AppText style={styles.outlineBtnText}>다른 형식으로</AppText>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.outlineBtn, { flex: 1 }]} onPress={handleAnotherTrack} activeOpacity={0.8}>
                <AppText style={styles.outlineBtnText}>다른 곡으로</AppText>
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* 입력 영역 — 단계별 선택지 */}
      <View style={styles.inputArea}>
        {step === 'pick' && (
          loadingTracks ? <ActivityIndicator size="small" color={colors.accent.primary} />
          : tracks.length === 0 ? (
            <AppText variant="footnote" tone="muted" center>아직 발매한 곡이 없어요. 작곡 디렉터에게 먼저 곡을 부탁해보세요!</AppText>
          ) : (
            <ScrollView style={{ maxHeight: 240 }}>
              {tracks.map((t) => (
                <TouchableOpacity key={t.id} style={styles.trackRow} onPress={() => handlePickTrack(t)} activeOpacity={0.75}>
                  {coverUri(t)
                    ? <Image source={{ uri: coverUri(t)! }} style={styles.trackCover} />
                    : <View style={[styles.trackCover, styles.trackCoverPh]}><AppText tone="muted">♪</AppText></View>}
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <AppText style={styles.trackTitle} numberOfLines={1}>{t.title}</AppText>
                    {t.is_public === false ? <AppText variant="caption" tone="muted">비공개 — 공유 영상 불가</AppText> : null}
                  </View>
                  <Feather name="chevron-right" size={16} color={colors.text.muted} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          )
        )}
        {step === 'format' && (
          <View style={styles.formatRow}>
            {FORMATS.map((f) => (
              <TouchableOpacity key={f.key} style={styles.formatCard} onPress={() => handlePickFormat(f.key)} activeOpacity={0.8}>
                {/* 비율 도식 — 어떤 모양의 영상인지 눈으로 보이게 */}
                <View style={styles.ratioBoxWrap}>
                  <View style={[styles.ratioBox, { width: f.ratioW, height: f.ratioH }]}>
                    <Feather name="music" size={12} color={colors.accent.primary} />
                  </View>
                </View>
                <AppText style={styles.formatLabel}>{f.label}</AppText>
                <AppText style={styles.formatDesc}>{f.desc}</AppText>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  chatArea: { flex: 1, paddingHorizontal: 14, paddingTop: 12 },
  msgRow: { flexDirection: 'row', marginBottom: 10, alignItems: 'flex-end' },
  msgRowUser: { justifyContent: 'flex-end' },
  portrait: { width: 40, height: 40, borderRadius: 20, marginRight: 8 },
  bubble: { maxWidth: '78%', borderRadius: 14, paddingHorizontal: 13, paddingVertical: 9 },
  bubbleDirector: { backgroundColor: colors.bg.surface1 },
  bubbleUser: { backgroundColor: colors.accent.primary },
  bubbleText: { color: colors.text.primary, fontSize: 14, lineHeight: 20 },
  bubbleUserText: { color: '#fff', fontSize: 14, lineHeight: 20 },
  makingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 48, marginBottom: 10 },
  resultBox: { paddingLeft: 48, gap: 10, marginBottom: 12 },
  previewTall: { width: 200, height: 356, borderRadius: 12, backgroundColor: colors.bg.surface1 },
  previewWide: { width: 300, height: 169, borderRadius: 12, backgroundColor: colors.bg.surface1 },
  primaryBtn: {
    backgroundColor: colors.accent.primary, borderRadius: 12, paddingVertical: 12,
    alignItems: 'center', width: 300, maxWidth: '100%',
  },
  primaryBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  outlineBtn: {
    borderWidth: 1, borderColor: colors.accent.primary, borderRadius: 12,
    paddingVertical: 10, alignItems: 'center',
  },
  outlineBtnText: { color: colors.accent.primary, fontWeight: '700', fontSize: 13 },
  inputArea: { borderTopWidth: 1, borderTopColor: colors.border.subtle, padding: 12, paddingBottom: 20 },
  trackRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
  },
  trackCover: { width: 40, height: 40, borderRadius: 8 },
  trackCoverPh: { backgroundColor: colors.bg.surface2, alignItems: 'center', justifyContent: 'center' },
  trackTitle: { color: colors.text.primary, fontSize: 14, fontWeight: '600' },
  formatRow: { flexDirection: 'row', gap: 8 },
  formatCard: {
    flex: 1, backgroundColor: colors.bg.surface1, borderRadius: 12, padding: 10,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border.subtle,
  },
  ratioBoxWrap: { height: 70, justifyContent: 'center', marginBottom: 6 },
  ratioBox: {
    borderWidth: 1.5, borderColor: colors.accent.primary, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.surface2,
  },
  formatLabel: { color: colors.text.primary, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  formatDesc: { color: colors.text.muted, fontSize: 10, marginTop: 2, textAlign: 'center' },
});
