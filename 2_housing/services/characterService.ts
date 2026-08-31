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
