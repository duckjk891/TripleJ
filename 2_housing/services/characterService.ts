import api, { BACKEND_BASE_URL } from './api';

// ── v3.103(B-1/B-3): 아티스트 N명 체제 — /api/character/* v216 정본 계약 ──────
// GET  /character/list → { characters: [ServerArtist...], slots: {used, max} }
//   (legacy 무cid 문서는 미노출 — characters:[] 인데 slots.used>=1 이면 마이그레이션
//    미실행 계정 → /character/me 구 shape로 폴백해 조립 카드를 만들어야 함)
// GET/PATCH/DELETE /character/{character_id}
//   PATCH body: {name?, age?, gender?, personality_tags?, personality_text?,
//                is_default?, persona_id?, persona_model?}
//   None(미전송)=유지 · 빈 문자열=클리어 · is_default:false 단독=400.
//   B-3: persona_id=클론의 clone_id (ready 클론만 — 서버 400 가드), 해제=빈 문자열.
//        곡 생성 주입은 persona_voice_id(서버가 조립) — 앱 기존 방식 유지.
// POST /points/spend {action:'extra_slot'} → {spent, balance, max_slots}
//   max_slots 영구 +1 (v216에서 효과 버그 수정 — 구매이력 dedupe 불필요). 402=잔액 부족.

export type ArtistKind = 'real' | 'virtual';

export interface ServerArtist {
  character_id: string;
  kind: ArtistKind;
  is_default: boolean;
  name: string | null;
  age: string | null;
  gender: string | null;
  personality_tags: string[];
  personality_text: string | null;
  sheet_object_name: string | null;
  sheet_url: string | null;
  art_style: string | null;
  used_items: any[];
  image_model: string | null;
  persona_id: string | null;
  persona_model: string | null;
  persona_name: string | null;
  persona_voice_id: string | null;
  /** 'ready' | 'missing'(연결된 클론 삭제됨 → 미연결 표시 + 재연결 유도) | null */
  persona_status: string | null;
  /** v3.143(서버 v231) 간편 목소리 프리셋 "male:소프트" | "" — persona와 상호 배타 */
  voice_preset: string;
  created_at?: string;
  updated_at?: string;
  [key: string]: any;
}

export interface ArtistSlots {
  used: number;
  max: number;
}

export interface PatchArtistBody {
  name?: string;
  age?: string;
  gender?: string;
  personality_tags?: string[];
  personality_text?: string;
  is_default?: boolean;
  persona_id?: string;
  persona_model?: string;
  /** v3.143: "male:소프트"=설정 · ""=해제 (서버가 persona와 배타 처리) */
  voice_preset?: string;
}

/** v3.143 — voice_preset 파싱: "male:소프트" → {gender:'남성', style:'소프트'} (무효면 null) */
export function parseVoicePreset(v?: string | null): { gender: '남성' | '여성'; style: string } | null {
  const raw = (v || '').trim();
  if (!raw) return null;
  const idx = raw.indexOf(':');
  if (idx <= 0) return null;
  const g = raw.slice(0, idx).trim().toLowerCase();
  const style = raw.slice(idx + 1).trim();
  if (!style || (g !== 'male' && g !== 'female')) return null;
  return { gender: g === 'male' ? '남성' : '여성', style };
}

/** v3.143 — 아티스트에 목소리(클론 ready 또는 간편 프리셋)가 연결되어 있는가 (필수 등록 판정) */
export function artistHasVoice(a: Pick<ServerArtist, 'persona_voice_id' | 'persona_status' | 'voice_preset'>): boolean {
  return (!!a.persona_voice_id && a.persona_status === 'ready') || !!parseVoicePreset(a.voice_preset);
}

function normalizeArtist(raw: any): ServerArtist {
  return {
    ...raw,
    character_id: String(raw?.character_id ?? ''),
    kind: raw?.kind === 'virtual' ? 'virtual' : 'real',
    is_default: !!raw?.is_default,
    name: raw?.name ?? null,
    age: raw?.age ?? null,
    gender: raw?.gender ?? null,
    personality_tags: Array.isArray(raw?.personality_tags) ? raw.personality_tags : [],
    personality_text: raw?.personality_text ?? null,
    sheet_object_name: raw?.sheet_object_name ?? null,
    sheet_url: raw?.sheet_url ?? null,
    art_style: raw?.art_style ?? null,
    used_items: Array.isArray(raw?.used_items) ? raw.used_items : [],
    image_model: raw?.image_model ?? null,
    persona_id: raw?.persona_id ?? null,
    persona_model: raw?.persona_model ?? null,
    persona_name: raw?.persona_name ?? null,
    persona_voice_id: raw?.persona_voice_id ?? null,
    persona_status: raw?.persona_status ?? null,
    voice_preset: typeof raw?.voice_preset === 'string' ? raw.voice_preset : '',
  };
}

/** 시트 미리보기 절대 URL (cache-buster 포함 — RN Image가 같은 URL이면 옛 캐시 사용) */
export function artistSheetUrl(objectName: string): string {
  return `${BACKEND_BASE_URL}/api/character/preview/${objectName}?t=${Date.now()}`;
}

/** GET /character/list — {characters, slots}. 방어 파싱 + 기본 slots {used:0,max:1} */
export const listArtists = async (): Promise<{ characters: ServerArtist[]; slots: ArtistSlots }> => {
  try {
    const res = await api.get('/character/list');
    const rawChars = Array.isArray(res.data?.characters) ? res.data.characters : [];
    const characters = rawChars.map(normalizeArtist).filter((a: ServerArtist) => a.character_id);
    const slots: ArtistSlots = {
      used: typeof res.data?.slots?.used === 'number' ? res.data.slots.used : characters.length,
      max: typeof res.data?.slots?.max === 'number' ? res.data.slots.max : Math.max(characters.length, 1),
    };
    if (__DEV__) {
      console.info('[characterService] listArtists:', characters.length, '명, slots', slots);
    }
    return { characters, slots };
  } catch (err: any) {
    console.error('[characterService] listArtists 실패:', err?.response?.status, err?.message);
    throw err;
  }
};

/** GET /character/{character_id} — 방어적으로 {character:...} 래핑도 수용 */
export const getArtist = async (characterId: string): Promise<ServerArtist> => {
  try {
    const res = await api.get(`/character/${characterId}`);
    const artist = normalizeArtist(res.data?.character ?? res.data);
    if (__DEV__) {
      console.info('[characterService] getArtist:', characterId, {
        kind: artist.kind, is_default: artist.is_default, persona_status: artist.persona_status,
      });
    }
    return artist;
  } catch (err: any) {
    console.error('[characterService] getArtist 실패:', characterId, err?.response?.status, err?.message);
    throw err;
  }
};

/** PATCH /character/{character_id} — 전송 필드만 수정(미전송=유지, 빈 문자열=클리어) */
export const patchArtist = async (characterId: string, body: PatchArtistBody): Promise<ServerArtist> => {
  try {
    if (__DEV__) console.info('[characterService] patchArtist 요청:', characterId, Object.keys(body));
    const res = await api.patch(`/character/${characterId}`, body);
    return normalizeArtist(res.data?.character ?? res.data);
  } catch (err: any) {
    console.error('[characterService] patchArtist 실패:', characterId, err?.response?.status, err?.response?.data, err?.message);
    throw err;
  }
};

/** DELETE /character/{character_id} — 개별 삭제(기본 삭제 시 잔여 중 자동 승계).
 *  주의: DELETE /character/me 는 전체 삭제 — 개별 삭제 UI에는 절대 쓰지 말 것. */
export const deleteArtist = async (characterId: string) => {
  try {
    const res = await api.delete(`/character/${characterId}`);
    if (__DEV__) console.info('[characterService] deleteArtist:', characterId, 'status=', res.status);
    return res.data;
  } catch (err: any) {
    console.error('[characterService] deleteArtist 실패:', characterId, err?.response?.status, err?.message);
    throw err;
  }
};

/** POST /points/spend {action:'extra_slot'} → {spent, balance, max_slots(영구 +1)} */
export const spendExtraSlot = async (): Promise<{ spent?: number; balance?: number; max_slots?: number }> => {
  try {
    const res = await api.post('/points/spend', { action: 'extra_slot' });
    if (__DEV__) console.info('[characterService] spendExtraSlot 성공:', res.data);
    return res.data ?? {};
  } catch (err: any) {
    console.error('[characterService] spendExtraSlot 실패:', err?.response?.status, err?.response?.data, err?.message);
    throw err;
  }
};

/** v3.230 A5-2: POST /points/spend {action:'hire_director', ref} → {spent, balance} (단가는 서버 POINT_COSTS) */
export const spendHireDirector = async (directorId: string): Promise<{ spent?: number; balance?: number }> => {
  try {
    const res = await api.post('/points/spend', { action: 'hire_director', ref: `hire:${directorId}` });
    console.info('[characterService] spendHireDirector 성공', { directorId, spent: res.data?.spent ?? null });
    return res.data ?? {};
  } catch (err: any) {
    console.error('[characterService] spendHireDirector 실패', { directorId, status: err?.response?.status ?? null });
    throw err;
  }
};

// ── v3.227 A-보완: 생성 job 추적 API — 서버 필드 접근은 이 매퍼 한 곳에서만 ─────────
// GET  /character/job/{job_id}           → {job_id, mode('real'|'cartoon'), status, object_name?, preview_url?,
//                                           original_object_name?, character_id?, art_style?, error?, created_at,
//                                           consumed?, dismissed?, refunded?}  (404 = 없음·타인·형식 오류)
// GET  /character/jobs/recoverable       → {jobs:[...], count, stale_fixed}  (v3.227 신규 — 구서버 404)
// POST /character/job/{job_id}/dismiss   → 본인 done/failed만, 환불 없음 (구서버 404 — 조용히 무시)
// 409  {error:'generation_in_progress', job_id, mode, character_id, created_at} — generate 4종 과금 전 차단
// 서버 datetime은 utcnow().isoformat()(오프셋 없음) → UTC로 해석해야 함(JS는 오프셋 없는 값을 로컬로 파싱).

export type CharacterJobStatus = 'processing' | 'done' | 'failed' | 'unknown';

export interface CharacterJobSnapshot {
  jobId: string;
  status: CharacterJobStatus;
  /** 서버 mode — 캐릭터 종류(real/cartoon). sheet/outfit 구분은 서버에 없음 */
  characterKind: 'real' | 'virtual' | null;
  characterId: string | null;
  objectName: string | null;
  previewUrl: string | null;
  originalObjectName: string | null;
  artStyle: string | null;
  error: string | null;
  refunded: boolean | null;
  consumed: boolean;
  dismissed: boolean;
  /** 서버 created_at(epoch ms) — elapsed_sec가 있으면 그 기준으로 역산 */
  createdAtMs: number | null;
  hasPhoto: boolean | null;
}

/** 서버 UTC(오프셋 없는 ISO) → epoch ms. 오프셋·Z가 있으면 그대로 */
export function parseServerUtc(v: unknown): number | null {
  if (typeof v !== 'string' || !v) return null;
  const hasOffset = /(Z|[+-]\d{2}:?\d{2})$/.test(v);
  const ms = Date.parse(hasOffset ? v : `${v}Z`);
  return Number.isFinite(ms) ? ms : null;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s ? s : null;
}

/** job 응답·recoverable 항목·409 본문 공용 매퍼 */
export function mapCharacterJob(raw: any): CharacterJobSnapshot | null {
  const jobId = strOrNull(raw?.job_id);
  if (!jobId) return null;
  const st = raw?.status;
  const status: CharacterJobStatus =
    st === 'processing' || st === 'done' || st === 'failed' ? st : 'unknown';
  const mode = raw?.mode;
  let createdAtMs = parseServerUtc(raw?.created_at);
  if (typeof raw?.elapsed_sec === 'number' && raw.elapsed_sec >= 0) {
    createdAtMs = Date.now() - raw.elapsed_sec * 1000;
  }
  return {
    jobId,
    status,
    characterKind: mode === 'cartoon' ? 'virtual' : mode === 'real' ? 'real' : null,
    characterId: strOrNull(raw?.character_id),
    objectName: strOrNull(raw?.object_name),
    previewUrl: strOrNull(raw?.preview_url),
    originalObjectName: strOrNull(raw?.original_object_name),
    // save의 art_style에는 기존 관행대로 잡 결과 art_style(라벨)을 그대로 보낸다
    artStyle: strOrNull(raw?.art_style ?? raw?.art_style_key),
    error: strOrNull(raw?.error),
    refunded: typeof raw?.refunded === 'boolean' ? raw.refunded : null,
    consumed: !!raw?.consumed,
    dismissed: !!raw?.dismissed,
    createdAtMs,
    hasPhoto: typeof raw?.has_photo === 'boolean' ? raw.has_photo : null,
  };
}

/** 409 generation_in_progress 응답이면 진행 중 job 스냅샷, 아니면 null */
export function parseGenerationInProgress(err: any): CharacterJobSnapshot | null {
  if (err?.response?.status !== 409) return null;
  const data = err?.response?.data;
  if (data?.error !== 'generation_in_progress') return null;
  const snap = mapCharacterJob({ ...data, status: 'processing' });
  return snap;
}

/** GET /character/job/{id} — 404는 null(없음·타인), 그 외 오류는 throw(추적기가 백오프) */
export const getCharacterJob = async (jobId: string): Promise<CharacterJobSnapshot | null> => {
  try {
    const res = await api.get(`/character/job/${encodeURIComponent(jobId)}`, { timeout: 20000 });
    return mapCharacterJob({ job_id: jobId, ...res.data });
  } catch (err: any) {
    if (err?.response?.status === 404) return null;
    throw err;
  }
};

/** GET /character/jobs/recoverable — supported=false면 구서버(404·405) */
export const listRecoverableJobs = async (): Promise<{ supported: boolean; jobs: CharacterJobSnapshot[] }> => {
  try {
    const res = await api.get('/character/jobs/recoverable', { timeout: 20000 });
    const raw = Array.isArray(res.data?.jobs) ? res.data.jobs : [];
    const jobs = raw.map(mapCharacterJob).filter((j: CharacterJobSnapshot | null): j is CharacterJobSnapshot => !!j);
    return { supported: true, jobs };
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404 || status === 405) return { supported: false, jobs: [] };
    throw err;
  }
};

/** POST /character/job/{id}/dismiss — 결과 버리기(환불 없음). 구서버·이미 없음(404)은 조용히 true */
export const dismissCharacterJob = async (jobId: string): Promise<boolean> => {
  try {
    await api.post(`/character/job/${encodeURIComponent(jobId)}/dismiss`, {}, { timeout: 20000 });
    return true;
  } catch (err: any) {
    const status = err?.response?.status;
    if (status === 404 || status === 405) return true;
    console.warn('[CharRecover] dismiss 실패', { status });
    return false;
  }
};
