// v3.410 [StorySong] 낙서·사진 → 노래 — 서버 /api/story-song/* 계약(대표 확정 SP-1, 10-23).
// 사진은 story_src/{uid}/ 에 올라가 24시간 뒤 지워지고, '낙서장에도 남기기'면 keep-photos 로 낙서 사진(feeds/)이 된다.
import { Platform } from 'react-native';
import api from './api';
import { genRequestHeaders } from './genJobsService';
import { getGuestDeviceId } from '../utils/guestTrial';

export type StoryPhotoKind = 'daily' | 'book' | 'capture';

export interface StoryPick {
  id: string; // p1 | p2 | p3 | twist
  genre: string;
  mood: string;
  tempo: string;
  style_text: string;
  reason: string;
}

export interface StoryAnalysis {
  analysis_id: string;
  read: {
    summary: string;
    emotions: { label: string; strength: number }[];
    keywords: string[];
    stuck: string;
    release: string;
  };
  photos: { index: number; kind: StoryPhotoKind; caption: string }[];
  book: { title: string; author: string; themes: string[] } | null;
  picks: StoryPick[];
  twist: StoryPick;
  brief: { title_idea: string; topic: string; keywords: string; perspective: string; reference: string };
  care: boolean;
  age_hint: string;
  weather: { label: string; source: string } | null;
  guest?: boolean;
  replayed?: boolean;
}

export interface StoryAnalyzeBody {
  source: 'diary' | 'paste' | 'blank';
  feed_id?: string | null;
  text: string;
  photos: { object_name: string; kind: StoryPhotoKind }[];
  weather?: { city?: string; manual?: string } | null;
  mood?: string | null;
  diary_date?: string | null;
}

export const newStoryRequestId = (): string =>
  Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

export async function uploadStoryPhoto(localUri: string, name: string, mime: string): Promise<string> {
  const formData = new FormData();
  if (Platform.OS === 'web') {
    const blob = await (await fetch(localUri)).blob();
    formData.append('file', blob, name);
  } else {
    formData.append('file', { uri: localUri, name, type: mime } as any);
  }
  const res = await api.post('/story-song/photo', formData, {
    headers: Platform.OS === 'web' ? undefined : { 'Content-Type': 'multipart/form-data' },
    timeout: 120000,
  });
  const objectName = res.data?.object_name;
  if (!objectName) throw new Error('object_name 누락');
  return String(objectName);
}

/** '낙서장에도 남기기' — 사진을 낙서 사진(feeds/{uid}/ 새 이름)으로 복사. 순서대로 새 object_name */
export async function keepStoryPhotos(objectNames: string[]): Promise<string[]> {
  if (!objectNames.length) return [];
  const res = await api.post('/story-song/keep-photos', { object_names: objectNames });
  return (res.data?.photos || []).map((p: any) => String(p.object_name));
}

export async function getStoryCities(): Promise<{ cities: { id: string; name: string }[]; manual: { id: string; name: string }[] }> {
  const res = await api.get('/story-song/cities');
  return { cities: res.data?.cities || [], manual: res.data?.manual || [] };
}

export async function getStoryWeather(city: string): Promise<{ name: string; label: string; source: string }> {
  const res = await api.get('/story-song/weather', { params: { city } });
  return res.data;
}

export async function analyzeStory(body: StoryAnalyzeBody, requestId: string, guest: boolean): Promise<StoryAnalysis> {
  const headers: Record<string, string> = { ...genRequestHeaders(requestId) };
  if (guest) headers['X-Guest-Device-Id'] = await getGuestDeviceId();
  // 실제 읽기는 20초 안팎 — 넉넉히 기다린다(서버는 같은 요청 번호 재전송을 10분 동안 무료 재생)
  const res = await api.post(guest ? '/story-song/analyze/guest' : '/story-song/analyze', body, { headers, timeout: 150000 });
  return res.data as StoryAnalysis;
}

/** 완성곡을 낙서에 붙이기 — 낙서 블록을 그대로 다시 보내고 곡 블록만 더한다(이미 곡이 있으면 손대지 않음). */
export async function attachSongToDiary(feedId: string, trackId: string): Promise<'attached' | 'already'> {
  const { data: feed } = await api.get(`/feeds/${feedId}`);
  const blocks: any[] = [];
  let hasTrack = false;
  for (const b of feed?.blocks || []) {
    if (b?.type === 'text') blocks.push({ type: 'text', text: b.text });
    else if (b?.type === 'image' && b.object_name) blocks.push({ type: 'image', object_name: b.object_name });
    else if (b?.type === 'track' && (b.track_id || b.track?.id)) {
      hasTrack = true;
      blocks.push({ type: 'track', track_id: String(b.track_id || b.track.id) });
    }
  }
  if (hasTrack) return 'already';
  // 글 바로 아래(사진 위)에 곡 — 낙서 쓰기 화면이 저장하는 순서와 같게
  const firstNonText = blocks.findIndex((b) => b.type !== 'text');
  blocks.splice(firstNonText === -1 ? blocks.length : firstNonText, 0, { type: 'track', track_id: String(trackId) });
  await api.put(`/feeds/${feedId}`, {
    title: feed?.title ?? null,
    blocks,
    is_public: !!feed?.is_public,
    bgm_track_id: feed?.bgm_track_id ?? null,
    ...(feed?.visibility ? { visibility: feed.visibility } : {}),
  });
  return 'attached';
}
