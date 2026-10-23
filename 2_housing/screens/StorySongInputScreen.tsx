// v3.410 [StorySong] 재료 담기 — 글(붙여넣기·내 낙서 불러오기) + 사진 2장(일상·책 표지·캡처) + 날씨 → '내 마음 들여다보기'.
// 대표 확정(SP-1, 10-23): 작업실 '내 낙서로 노래 만들기'·낙서장 '이 낙서로 노래 만들기'에서 들어온다.
// 그 자리에서 쓴 글·사진은 '낙서장에도 남기기'(켜면 분석 성공 직후 나만 보기 낙서로 등록, 사진은 낙서 사진으로 보관).
// 게스트는 글만 1번(사진·날씨는 로그인 후), 어린이 계정은 사진 없이. 팝업은 모두 앱 안 창(showAlert).
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Switch, TouchableOpacity, View } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { AppText, Tag } from '../components/ui';
import AppModal from '../components/AppModal';
import KeyboardAvoid from '../components/KeyboardAvoid';
import { LinedTextInput } from '../components/diary/LinedPaper';
import { feedImageUri } from '../components/feed/FeedImageBlock';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { useAuthStore } from '../stores/authStore';
import api from '../services/api';
import {
  analyzeStory, getStoryCities, getStoryWeather, keepStoryPhotos, newStoryRequestId, uploadStoryPhoto,
  type StoryPhotoKind,
} from '../services/storySongService';
import { consumeStoryInput, setStoryAnalysis, STORY_TEXT, type StoryInput } from '../utils/storySong';
import { pickImages, takePhoto } from '../utils/pickImage';
import { showAlert } from '../utils/appAlert';
import { openLoginModal } from '../utils/loginModal';
import { useIsChild } from '../utils/kidsMode';
import { useNakseoFont } from '../utils/nakseoFont';
import { fmtDiaryDate, kstToday } from '../utils/diary';
import { isGuestNow } from '../utils/guestTrial';
import type { StudioStackParamList } from '../App';

type Props = NativeStackScreenProps<StudioStackParamList, 'StorySongInput'>;

const TEXT_MAX = 2000;
const PHOTO_MAX = 2;
const CITY_KEY = 'maidol_story_city_v1';
const KIND_LABEL: Record<StoryPhotoKind, string> = { daily: '일상', book: '책 표지', capture: '캡처' };

interface Photo {
  key: string;
  uri: string | null;
  name?: string;
  mime?: string;
  objectName?: string;
  status: 'uploading' | 'done' | 'failed';
  kind: StoryPhotoKind;
  fromDiary: boolean; // 이미 낙서에 있던 사진(feeds/) — 다시 올리지 않음
}

export default function StorySongInputScreen({ navigation }: Props) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const guest = isGuestNow();
  const isChild = useIsChild();
  const nakseoFont = useNakseoFont();
  const initial = useRef<StoryInput | null>(consumeStoryInput()).current;

  const [text, setText] = useState(initial?.text || '');
  const [feedId, setFeedId] = useState<string | null>(initial?.feedId || null);
  const [mood, setMood] = useState<string | null>(initial?.mood || null);
  const [diaryDate, setDiaryDate] = useState<string | null>(initial?.diaryDate || null);
  const [photos, setPhotos] = useState<Photo[]>(() =>
    (initial?.photos || []).slice(0, PHOTO_MAX).map((p, i) => ({
      key: `d${i}-${p.objectName}`, uri: p.uri || feedImageUri({ object_name: p.objectName }), objectName: p.objectName,
      status: 'done', kind: p.kind || 'daily', fromDiary: true,
    })));
  const extraDiaryPhotos = Math.max(0, (initial?.photos?.length || 0) - PHOTO_MAX);
  // 낙서 쓰기 화면에서 온 글(아직 저장 전)·작업실에서 새로 쓴 글이면 남기기 선택지 — 저장된 낙서에서 왔으면 숨김
  const [keepDiary, setKeepDiary] = useState<boolean>(!!initial?.draftKey);
  const draftKey = initial?.draftKey || null;

  const [weatherOn, setWeatherOn] = useState(false);
  const [cities, setCities] = useState<{ id: string; name: string }[]>([]);
  const [manualList, setManualList] = useState<{ id: string; name: string }[]>([]);
  const [city, setCity] = useState<string>('seoul');
  const [weatherLabel, setWeatherLabel] = useState<string | null>(null);
  const [weatherLoading, setWeatherLoading] = useState(false);
  const [manual, setManual] = useState<string | null>(null); // 직접 고른 날씨
  const [showCities, setShowCities] = useState(false);

  const [diaryPickerOpen, setDiaryPickerOpen] = useState(false);
  const [diaryList, setDiaryList] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string>(newStoryRequestId());

  const pastDiary = !!diaryDate && diaryDate !== kstToday();
  const showKeep = !guest && !feedId;
  const canPhoto = !guest && !isChild;

  // 날씨 도시 목록 + 마지막 도시
  useEffect(() => {
    getStoryCities().then((r) => { setCities(r.cities); setManualList(r.manual); }).catch(() => {});
    AsyncStorage.getItem(CITY_KEY).then((c) => { if (c) setCity(c); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!weatherOn || guest || manual) return;
    let alive = true;
    setWeatherLoading(true);
    getStoryWeather(city)
      .then((w) => { if (alive) setWeatherLabel(`${w.name} · ${w.label}`); })
      .catch(() => { if (alive) setWeatherLabel(null); })
      .finally(() => { if (alive) setWeatherLoading(false); });
    return () => { alive = false; };
  }, [weatherOn, city, manual, guest]);

  const chooseCity = (id: string) => {
    setCity(id);
    setManual(null);
    setShowCities(false);
    AsyncStorage.setItem(CITY_KEY, id).catch(() => {});
  };

  const toggleWeather = (on: boolean) => {
    if (on && guest) { openLoginModal({ reason: 'story_weather' }); return; }
    setWeatherOn(on);
    if (on && pastDiary) setManual(null); // 지난 날 낙서 — 그날 날씨를 직접 고르게
  };

  const pasteText = async () => {
    try {
      const s = await Clipboard.getStringAsync();
      if (!s?.trim()) { showAlert('붙여넣기', '복사한 글이 없어요. 글을 복사한 뒤 다시 눌러 주세요.'); return; }
      setText((prev) => (prev ? `${prev}\n${s}` : s).slice(0, TEXT_MAX));
      console.info('[StorySong] 붙여넣기', { len: s.length });
    } catch {
      showAlert('붙여넣기', '글 칸을 길게 눌러 붙여넣어 주세요.');
    }
  };

  const openDiaryPicker = async () => {
    if (guest) { openLoginModal({ reason: 'story_diary' }); return; }
    setDiaryPickerOpen(true);
    if (diaryList) return;
    try {
      const res = await api.get(`/feeds/user/${user?.id}`, { params: { kind: 'feed', limit: 30 } });
      const items: any[] = Array.isArray(res.data) ? res.data : (res.data?.feeds || res.data?.items || res.data?.posts || []);
      setDiaryList(items.filter((f) => (f.kind || 'feed') === 'feed'));
    } catch (err: any) {
      console.error('[StorySong] 내 낙서 불러오기 실패', { status: err?.response?.status });
      setDiaryList([]);
    }
  };

  const applyDiary = (f: any) => {
    const blocks: any[] = f.blocks || [];
    const body = blocks.filter((b) => b.type === 'text' && b.text && !String(b.text).startsWith('[item]')).map((b) => b.text).join('\n');
    const imgs = blocks.filter((b) => b.type === 'image' && b.object_name);
    setText(body.slice(0, TEXT_MAX));
    setFeedId(String(f.id || f._id));
    setMood(f.mood || null);
    setDiaryDate(f.diary_date || null);
    setKeepDiary(false);
    setPhotos(imgs.slice(0, PHOTO_MAX).map((b, i) => ({
      key: `f${i}-${b.object_name}`, uri: feedImageUri(b), objectName: b.object_name, status: 'done', kind: 'daily', fromDiary: true,
    })));
    setDiaryPickerOpen(false);
    console.info('[StorySong] 내 낙서 불러옴', { len: body.length, images: imgs.length });
  };

  const uploadOne = async (p: Photo) => {
    try {
      const objectName = await uploadStoryPhoto(p.uri as string, p.name || 'photo.jpg', p.mime || 'image/jpeg');
      setPhotos((prev) => prev.map((x) => (x.key === p.key ? { ...x, status: 'done', objectName } : x)));
    } catch (err: any) {
      console.error('[StorySong] 사진 올리기 실패', { status: err?.response?.status });
      setPhotos((prev) => prev.map((x) => (x.key === p.key ? { ...x, status: 'failed' } : x)));
      if (err?.response?.status !== 403) showAlert('사진', err?.response?.data?.message || '사진을 올리지 못했어요. 사진을 눌러 다시 해 주세요.');
    }
  };

  const addPhotos = async (camera: boolean) => {
    if (!canPhoto) {
      if (guest) openLoginModal({ reason: 'story_photo' });
      else showAlert('사진', '어린이 계정에서는 사진 없이 글과 날씨로 만들어요.');
      return;
    }
    const room = PHOTO_MAX - photos.length;
    if (room <= 0) { showAlert('사진', `사진은 ${PHOTO_MAX}장까지 넣을 수 있어요.`); return; }
    const res: any = camera ? await takePhoto() : await pickImages({ multiple: true, limit: room });
    if (res?.denied) { showAlert('카메라', '카메라 권한이 필요해요. 설정에서 카메라를 허용해 주세요.'); return; }
    if (res?.canceled || !res?.assets?.length) return;
    const fresh: Photo[] = res.assets.slice(0, room).map((a: any, i: number) => ({
      key: `n${Date.now()}-${i}`, uri: a.uri, name: a.name, mime: a.mimeType || 'image/jpeg', status: 'uploading', kind: 'daily', fromDiary: false,
    }));
    setPhotos((prev) => [...prev, ...fresh]);
    fresh.forEach((p) => { void uploadOne(p); });
  };

  const setKind = (key: string, kind: StoryPhotoKind) =>
    setPhotos((prev) => prev.map((p) => (p.key === key ? { ...p, kind } : p)));
  const removePhoto = (key: string) => setPhotos((prev) => prev.filter((p) => p.key !== key));

  const weatherBody = useMemo(() => {
    if (!weatherOn) return null;
    if (manual) return { manual };
    if (weatherLabel) return { city };
    return null;
  }, [weatherOn, manual, weatherLabel, city]);

  const registerDiary = async (): Promise<string | null> => {
    // 분석이 끝난 뒤 — 글·사진을 나만 보기 낙서로 남기고 사진은 낙서 사진(feeds/)으로 보관
    const ready = photos.filter((p) => p.status === 'done' && p.objectName);
    const kept = await keepStoryPhotos(ready.map((p) => p.objectName as string));
    const blocks: any[] = [];
    if (text.trim()) blocks.push({ type: 'text', text: text.trim() });
    kept.forEach((o) => blocks.push({ type: 'image', object_name: o }));
    const res = await api.post('/feeds/', {
      title: null, blocks, is_public: false, visibility: 'private', kind: 'feed',
      diary_date: kstToday(), ...(mood ? { mood } : {}),
    });
    const id = res.data?.id || res.data?._id || res.data?.feed_id;
    if (draftKey) AsyncStorage.removeItem(draftKey).catch(() => {});
    console.info('[StorySong] 낙서장에 남김', { photos: kept.length, reward: res.data?.diary_reward?.awarded ?? 0 });
    return id ? String(id) : null;
  };

  const onRead = async () => {
    if (busy) return;
    const body = text.trim();
    if (!body && !photos.length) { showAlert('재료 담기', '글이나 사진을 하나 이상 넣어 주세요.'); return; }
    if (photos.some((p) => p.status === 'uploading')) { showAlert('사진', '사진을 올리는 중이에요. 잠시만 기다려 주세요.'); return; }
    if (photos.some((p) => p.status === 'failed')) { showAlert('사진', '올리지 못한 사진이 있어요. 사진을 눌러 다시 올리거나 빼 주세요.'); return; }
    setBusy(true);
    try {
      const analysis = await analyzeStory({
        source: feedId ? 'diary' : body ? 'paste' : 'blank',
        feed_id: feedId,
        text: body,
        photos: guest ? [] : photos.map((p) => ({ object_name: p.objectName as string, kind: p.kind })),
        weather: guest ? null : weatherBody,
        mood, diary_date: diaryDate,
      }, requestId.current, guest);
      let targetFeed = feedId;
      if (showKeep && keepDiary) {
        try {
          targetFeed = await registerDiary();
        } catch (err: any) {
          console.error('[StorySong] 낙서장에 남기기 실패', { status: err?.response?.status });
          showAlert('낙서장', err?.response?.data?.message || err?.response?.data?.error || '낙서장에 남기지 못했어요. 노래는 이어서 만들 수 있어요.');
        }
      }
      setStoryAnalysis(analysis);
      requestId.current = newStoryRequestId();
      navigation.navigate('StorySongRead', { feedId: targetFeed || undefined, guest });
    } catch (err: any) {
      const st = err?.response?.status;
      const data = err?.response?.data || {};
      console.error('[StorySong] 들여다보기 실패', { status: st, error: data.error });
      if (data.error === 'image_unsafe') {
        setPhotos((prev) => prev.filter((p) => p.fromDiary)); // 서버가 새 사진은 지웠다
        showAlert('사진', data.message);
      } else if (data.error === 'photo_expired') {
        setPhotos((prev) => prev.map((p) => (p.fromDiary ? p : { ...p, status: 'failed' })));
        showAlert('사진', data.message);
      } else if (st === 429 && data.error === 'guest_trial_used') {
        showAlert('체험은 1번이에요', '가입하면 사진과 날씨까지 넣어 계속 만들 수 있어요.', [
          { text: '나중에', style: 'cancel' },
          { text: '가입하기', onPress: () => openLoginModal({ reason: 'story_guest_used' }) },
        ]);
      } else if (data.message) {
        showAlert('잠깐만요', data.message);
      } else {
        showAlert('잠깐만요', '잠깐 문제가 생겼어요. 다시 눌러 주세요(무료).');
      }
    } finally {
      setBusy(false);
    }
  };

  const cityName = cities.find((c) => c.id === city)?.name || '서울';

  return (
    <KeyboardAvoid style={styles.container} iosOffset={120}>
      <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.lg }]} keyboardShouldPersistTaps="handled">
        <View style={styles.headRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} accessibilityLabel="뒤로">
            <Feather name="chevron-left" size={24} color={colors.text.secondary} />
          </TouchableOpacity>
          <AppText variant="headline">무엇으로 만들까요</AppText>
        </View>
        <AppText variant="footnote" tone="muted" style={{ marginBottom: spacing.md }}>
          글이나 사진 하나만 있어도 돼요. MAIDOL이 마음을 들여다보고 어울리는 노래를 골라 드려요.
        </AppText>

        {/* 글 */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <AppText variant="caption" tone="muted">
              글 · {text.length.toLocaleString()} / {TEXT_MAX.toLocaleString()}자{feedId && diaryDate ? ` · ${fmtDiaryDate(diaryDate)} 낙서` : ''}
            </AppText>
          </View>
          <LinedTextInput
            minLines={5}
            style={nakseoFont ? { fontFamily: nakseoFont } : null}
            placeholder="오늘 있었던 일, 마음에 걸린 말, 예전에 쓴 일기… 무엇이든 적거나 붙여넣어 보세요."
            value={text}
            onChangeText={(v) => setText(v.slice(0, TEXT_MAX))}
            maxLength={TEXT_MAX}
            accessibilityLabel="노래로 만들 글"
          />
          <View style={styles.chipRow}>
            <Tag size="sm" label="붙여넣기" onPress={pasteText} />
            <Tag size="sm" label="내 낙서 불러오기" onPress={openDiaryPicker} />
          </View>
          {showKeep ? (
            <View style={styles.switchRow}>
              <View style={{ flex: 1 }}>
                <AppText variant="footnote">이 글·사진 낙서장에도 남기기</AppText>
                <AppText variant="caption" tone="muted">나만 보기 낙서로 남고, 사진도 낙서 사진으로 보관돼요</AppText>
              </View>
              <Switch value={keepDiary} onValueChange={setKeepDiary} trackColor={{ true: colors.accent.primary, false: colors.border.default }} />
            </View>
          ) : null}
        </View>

        {/* 사진 */}
        <View style={styles.card}>
          <View style={styles.cardHead}>
            <AppText variant="caption" tone="muted">사진 · 최대 {PHOTO_MAX}장 · 일상 / 책 표지 / 캡처</AppText>
          </View>
          {photos.map((p) => (
            <View key={p.key} style={styles.photoRow}>
              <TouchableOpacity
                onPress={() => { if (p.status === 'failed') { setPhotos((prev) => prev.map((x) => (x.key === p.key ? { ...x, status: 'uploading' } : x))); void uploadOne(p); } }}
                accessibilityLabel={p.status === 'failed' ? '사진 다시 올리기' : '사진'}
              >
                {p.uri ? <Image source={{ uri: p.uri }} style={styles.thumb} /> : <View style={[styles.thumb, styles.thumbEmpty]} />}
                {p.status !== 'done' ? (
                  <View style={styles.thumbOverlay}>
                    {p.status === 'uploading' ? <ActivityIndicator color="#fff" /> : <Feather name="refresh-cw" size={18} color="#fff" />}
                  </View>
                ) : null}
              </TouchableOpacity>
              <View style={{ flex: 1, gap: spacing.xs }}>
                <View style={styles.chipRow}>
                  {(Object.keys(KIND_LABEL) as StoryPhotoKind[]).map((k) => (
                    <Tag key={k} size="sm" label={KIND_LABEL[k]} selected={p.kind === k} onPress={() => setKind(p.key, k)} />
                  ))}
                </View>
                <AppText variant="caption" tone="muted">
                  {p.kind === 'book' ? '책 제목과 분위기만 봐요. 책 속 문장은 가사에 넣지 않아요.'
                    : p.kind === 'capture' ? '프로필 메시지 같은 글만 봐요. 이름·번호는 보지 않아요.'
                      : '사진 속 분위기만 봐요. 사람 얼굴은 알아보지 않아요.'}
                </AppText>
              </View>
              <TouchableOpacity onPress={() => removePhoto(p.key)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }} accessibilityLabel="사진 빼기">
                <Feather name="x" size={18} color={colors.text.muted} />
              </TouchableOpacity>
            </View>
          ))}
          {extraDiaryPhotos > 0 ? (
            <AppText variant="caption" tone="muted">낙서 사진 중 앞의 {PHOTO_MAX}장만 넣었어요. 빼고 다른 사진을 넣을 수 있어요.</AppText>
          ) : null}
          {photos.length < PHOTO_MAX ? (
            <View style={styles.chipRow}>
              <Tag size="sm" label="사진첩에서 고르기" onPress={() => { void addPhotos(false); }} />
              <Tag size="sm" label="사진 찍기" onPress={() => { void addPhotos(true); }} />
            </View>
          ) : null}
          {!canPhoto ? (
            <AppText variant="caption" tone="muted">{guest ? '사진은 로그인하면 넣을 수 있어요.' : '어린이 계정은 사진 없이 만들어요.'}</AppText>
          ) : null}
        </View>

        {/* 날씨 */}
        <View style={styles.card}>
          <View style={styles.switchRow}>
            <AppText variant="footnote" style={{ flex: 1 }}>날씨 붙이기</AppText>
            <Switch value={weatherOn} onValueChange={toggleWeather} trackColor={{ true: colors.accent.primary, false: colors.border.default }} />
          </View>
          {weatherOn ? (
            <>
              {!manual && !pastDiary ? (
                <View style={styles.switchRow}>
                  <AppText variant="body" style={{ flex: 1 }}>
                    {weatherLoading ? `${cityName} 날씨 가져오는 중…` : weatherLabel || `${cityName} 날씨를 가져오지 못했어요. 아래에서 골라 주세요.`}
                  </AppText>
                  <Tag size="sm" label="도시 바꾸기" onPress={() => setShowCities((v) => !v)} />
                </View>
              ) : null}
              {showCities ? (
                <View style={styles.chipRow}>
                  {cities.map((c) => <Tag key={c.id} size="sm" label={c.name} selected={c.id === city} onPress={() => chooseCity(c.id)} />)}
                </View>
              ) : null}
              {(pastDiary || manual || (!weatherLoading && !weatherLabel)) ? (
                <>
                  <AppText variant="caption" tone="muted">{pastDiary ? '그날 날씨를 골라 주세요' : '직접 고르기'}</AppText>
                  <View style={styles.chipRow}>
                    {manualList.map((m) => (
                      <Tag key={m.id} size="sm" label={m.name} selected={manual === m.id} onPress={() => setManual((v) => (v === m.id ? null : m.id))} />
                    ))}
                  </View>
                </>
              ) : (
                <TouchableOpacity onPress={() => setManual(manualList[0]?.id || 'clear')}>
                  <AppText variant="caption" tone="accent">직접 고르기</AppText>
                </TouchableOpacity>
              )}
              <AppText variant="caption" tone="muted">출처: 기상청 · 위치 권한은 쓰지 않아요</AppText>
            </>
          ) : null}
        </View>

        <TouchableOpacity style={[styles.cta, busy && { opacity: 0.7 }]} onPress={onRead} disabled={busy} accessibilityLabel={STORY_TEXT.readButton}>
          {busy ? (
            <View style={{ alignItems: 'center', gap: spacing.xs }}>
              <ActivityIndicator color="#fff" />
              <AppText style={styles.ctaText}>{STORY_TEXT.reading}</AppText>
              <AppText style={styles.ctaSub}>{STORY_TEXT.readingSub}</AppText>
            </View>
          ) : (
            <>
              <AppText style={styles.ctaText}>{STORY_TEXT.readButton}</AppText>
              <AppText style={styles.ctaSub}>{guest ? '무료 체험 1번' : STORY_TEXT.readButtonSub}</AppText>
            </>
          )}
        </TouchableOpacity>
        <View style={{ height: insets.bottom + 80 }} />
      </ScrollView>

      {/* 내 낙서 불러오기 */}
      <AppModal visible={diaryPickerOpen} transparent animationType="fade" onRequestClose={() => setDiaryPickerOpen(false)}>
        <View style={styles.modalBack}>
          <View style={styles.modalCard}>
            <View style={styles.switchRow}>
              <AppText variant="subtitle" style={{ flex: 1 }}>내 낙서 불러오기</AppText>
              <TouchableOpacity onPress={() => setDiaryPickerOpen(false)} accessibilityLabel="닫기"><Feather name="x" size={20} color={colors.text.muted} /></TouchableOpacity>
            </View>
            <ScrollView style={{ maxHeight: 420 }}>
              {diaryList === null ? <ActivityIndicator color={colors.accent.primary} style={{ margin: spacing.lg }} /> : null}
              {diaryList?.length === 0 ? <AppText tone="muted" style={{ margin: spacing.lg }}>아직 남긴 낙서가 없어요.</AppText> : null}
              {diaryList?.map((f) => {
                const first = (f.blocks || []).find((b: any) => b.type === 'text' && b.text)?.text || '(사진만 있는 낙서)';
                const nImg = (f.blocks || []).filter((b: any) => b.type === 'image').length;
                return (
                  <TouchableOpacity key={String(f.id || f._id)} style={styles.diaryRow} onPress={() => applyDiary(f)}>
                    <AppText variant="caption" tone="muted">{fmtDiaryDate(f.diary_date) || ''}{nImg ? ` · 사진 ${nImg}장` : ''}</AppText>
                    <AppText variant="body" numberOfLines={2}>{String(first)}</AppText>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </AppModal>
    </KeyboardAvoid>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md },
  headRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xs },
  card: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.xl, borderWidth: 1, borderColor: colors.border.default,
    padding: spacing.md, gap: spacing.sm,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  photoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thumb: { width: 64, height: 64, borderRadius: radius.md, backgroundColor: colors.bg.surface2 },
  thumbEmpty: { borderWidth: 1, borderColor: colors.border.default },
  thumbOverlay: { ...StyleSheet.absoluteFillObject, borderRadius: radius.md, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  cta: {
    marginTop: spacing.sm, borderRadius: radius.xl, paddingVertical: spacing.md, alignItems: 'center',
    backgroundColor: colors.accent.primaryDim,
  },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '800' },
  ctaSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 2 },
  modalBack: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', padding: spacing.lg },
  modalCard: { backgroundColor: colors.bg.surface1, borderRadius: radius.xl, padding: spacing.lg, gap: spacing.sm },
  diaryRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border.subtle, gap: 2 },
});
