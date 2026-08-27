import { useEffect, useRef, useState } from 'react';
import * as api from '../api';
import './ArtistPicker.css';

// v212 F3 — 공용 아티스트 선택 카드.
// 중복 3벌 수렴: UploadPage/CoverEditModal 의 variant 라디오 2벌 + MVStudioTab 하드 스텁.
//
// 계약 (PLAN v212 D3/D7):
//  - 데이터: GET /character/list → { characters:[{character_id, kind, is_default, name, age, gender,
//      personality_tags, personality_text, sheet_object_name, used_items, art_style, ...}], slots }
//  - 선택 결과: onChange(artist|null) — 소비처는 character_id + sheet_object_name (+스냅샷용 프로필 필드)
//  - 카드 키: character_id || kind (legacy 합성 카드는 character_id 가 없음)
//
// B3/F1(api.getCharacterList) 배선 전 폴백: legacy getMyCharacter 단건을 real/virtual 카드로 합성
// (character_id null) — 기존 variant 라디오와 동등 동작을 보장하고, list 가 생기면 자동 확장된다.
export const artistKey = (a) => a?.character_id || a?.kind || null;

// legacy 단건 응답 → 합성 아티스트 카드 (real/virtual 각각)
export function synthesizeLegacyArtists(c) {
  if (!c) return [];
  const base = {
    name: c.name || '',
    age: c.age || '',
    gender: c.gender || '',
    personality_tags: Array.isArray(c.personality_tags) ? c.personality_tags : [],
    personality_text: c.personality_text || '',
  };
  const out = [];
  if (c.sheet_object_name) {
    out.push({
      ...base,
      character_id: c.character_id || null,
      kind: 'real',
      is_default: true,
      sheet_object_name: c.sheet_object_name,
      used_items: Array.isArray(c.used_items) ? c.used_items : [],
      art_style: '',
    });
  }
  if (c.virtual_sheet_object_name) {
    out.push({
      ...base,
      character_id: null,
      kind: 'virtual',
      is_default: !c.sheet_object_name,
      sheet_object_name: c.virtual_sheet_object_name,
      used_items: Array.isArray(c.virtual_used_items) ? c.virtual_used_items : [],
      art_style: c.virtual_art_style || '',
    });
  }
  return out;
}

// 아티스트 목록 로드 (list 우선, legacy 폴백) — CharacterSection 과 공유
export async function loadArtists() {
  if (typeof api.getCharacterList === 'function') {
    const { data } = await api.getCharacterList();
    return {
      artists: Array.isArray(data?.characters) ? data.characters : [],
      slots: data?.slots || null,
      source: 'list',
    };
  }
  const { data } = await api.getMyCharacter();
  return { artists: synthesizeLegacyArtists(data?.character), slots: null, source: 'legacy' };
}

// artists prop 주입 시 자체 로드 생략(부모가 loadArtists 로 목록 소유 — 토글 disabled 판단 등),
// 미주입 시 자체 로드 (MVStudioTab 등 단독 사용처).
export default function ArtistPicker({ artists: externalArtists, selectedKey, onChange, disabled = false, emptyHint }) {
  const external = Array.isArray(externalArtists);
  const [ownArtists, setOwnArtists] = useState([]);
  const [ownLoaded, setOwnLoaded] = useState(false);
  const autoSelectedRef = useRef(false);

  useEffect(() => {
    if (external) return undefined; // 외부 주입 모드 — 자체 로드 생략
    let alive = true;
    (async () => {
      try {
        const { artists: list, source } = await loadArtists();
        if (!alive) return;
        setOwnArtists(list);
        if (import.meta.env.DEV) console.debug('[ArtistPicker] loaded', { count: list.length, source });
      } catch (err) {
        console.error('[ArtistPicker] load failed', { status: err?.response?.status, message: err?.message });
        if (alive) setOwnArtists([]);
      } finally {
        if (alive) setOwnLoaded(true);
      }
    })();
    return () => { alive = false; };
    // 마운트 1회 — 저장/삭제 후 갱신은 부모가 key 재마운트 or 재선택으로 처리
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const artists = external ? externalArtists : ownArtists;
  const loaded = external ? true : ownLoaded;

  // 자동 기본 선택 — 선택이 비었거나 목록에 없으면 기본(is_default 우선) 1회 통지
  // (구 variant 라디오의 "한쪽만 있으면 그쪽으로 강제" 자동 보정 동작 승계)
  useEffect(() => {
    if (!loaded || autoSelectedRef.current || artists.length === 0) return;
    const valid = selectedKey && artists.some((a) => artistKey(a) === selectedKey);
    if (!valid) {
      const def = artists.find((a) => a.is_default) || artists[0];
      autoSelectedRef.current = true;
      if (import.meta.env.DEV) console.debug('[ArtistPicker] auto-select', { key: artistKey(def) });
      if (onChange) onChange(def);
    } else {
      autoSelectedRef.current = true;
    }
  }, [loaded, artists, selectedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loaded) {
    return <div className="artist-picker__empty">아티스트 불러오는 중...</div>;
  }

  if (artists.length === 0) {
    return (
      <div className="artist-picker__empty">
        {emptyHint || '등록된 아티스트가 없습니다. 마이뮤직 → 내 캐릭터 탭에서 먼저 아티스트를 만들어주세요.'}
      </div>
    );
  }

  return (
    <div className="artist-picker">
      {artists.map((a) => {
        const key = artistKey(a);
        const selected = selectedKey === key;
        const kindLabel = a.kind === 'virtual' ? '🎨 가상' : '📷 실사';
        return (
          <button
            key={key}
            type="button"
            className={`artist-picker__card${selected ? ' is-selected' : ''}${a.kind === 'virtual' ? ' artist-picker__card--virtual' : ''}`}
            disabled={disabled}
            onClick={() => {
              if (import.meta.env.DEV) console.debug('[ArtistPicker] pick', { key, kind: a.kind });
              if (onChange) onChange(a);
            }}
          >
            <img
              src={api.characterPreviewUrl(a.sheet_object_name)}
              alt={a.name || kindLabel}
              className="artist-picker__thumb"
              onError={(e) => { if (e?.currentTarget) e.currentTarget.style.visibility = 'hidden'; }}
            />
            <span className="artist-picker__meta">
              <span className="artist-picker__name">
                {a.name || (a.kind === 'virtual' ? '가상 아티스트' : '실사 아티스트')}
                {a.is_default && <em className="artist-picker__default" title="기본 아티스트">⭐</em>}
              </span>
              <span className="artist-picker__kind">
                {kindLabel}
                {a.kind === 'virtual' && a.art_style ? ` · ${a.art_style}` : ''}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
