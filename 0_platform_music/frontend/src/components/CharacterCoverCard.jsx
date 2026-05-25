import { useEffect } from 'react';
import * as api from '../api';
import './CharacterCoverCard.css';

/**
 * CharacterCoverCard
 *
 * v68 — PlayerPage 의 우측 영역 아래에 노출되는 "이 곡의 주인공 캐릭터" 카드.
 *
 * Props:
 *   character: {
 *     name, age, personality_tags[], personality_text,
 *     sheet_preview_path,
 *     used_items: [{ id, name, image_object_name, product_url, category }]
 *   } | null
 *
 * 부모(PlayerPage)에서 truthy null-guard 후 렌더되므로 내부에서 또 가드하지 않음.
 * 단, 개별 필드는 모두 옵셔널이라 falsy 면 해당 부분 미노출.
 *
 * PII (name/age/personality_text) 콘솔 출력 금지 — 길이/카운트/존재여부만 로깅.
 * MyMusicPage 의 마크업은 시각 참고이며, 컴포넌트/state 공유 없음 (새 prefix).
 */
export default function CharacterCoverCard({ character }) {
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.info('[CharCoverCard] mount', {
        empty: !character,
        items: character?.used_items?.length ?? 0,
        hasSheet: !!character?.sheet_preview_path,
        hasName: !!character?.name,
        hasAge: !!character?.age,
        tags: character?.personality_tags?.length ?? 0,
        hasText: !!character?.personality_text,
      });
    }
  }, [character]);

  // v68-pre3 — MV 만들었지만 '내캐릭터 포함' 안 한 경우: "캐릭터 미사용" 표시
  if (!character) {
    return (
      <div className="character-cover-card character-cover-card--empty">
        <div className="character-cover-card__header">
          <h3>이 곡의 주인공 캐릭터</h3>
        </div>
        <p className="character-cover-card__empty-msg">캐릭터 미사용</p>
        <p className="character-cover-card__empty-hint">
          이 곡은 '내 캐릭터 포함' 옵션 없이 생성되었습니다.
        </p>
      </div>
    );
  }

  // 카테고리별 lookup (백엔드에서 받은 used_items)
  const byCategory = {};
  if (Array.isArray(character?.used_items)) {
    for (const it of character.used_items) {
      if (it?.category) byCategory[it.category] = it;
    }
  }
  const outfitSlots = [
    { label: '상의', data: byCategory['상의'] || null },
    { label: '하의', data: byCategory['하의'] || null },
    { label: '신발', data: byCategory['신발'] || null },
  ];

  const handleItemClick = (item) => (e) => {
    if (!item?.product_url) {
      // product_url 없으면 동작 없음
      return;
    }
    e.preventDefault();
    if (import.meta.env.DEV) {
      console.info('[CharCoverCard] adClick', { id: item.id ?? null });
    }
    if (item.id) {
      api.recordAdClick(item.id).catch(() => {});
    }
    window.open(item.product_url, '_blank', 'noopener,noreferrer');
  };

  const handleSheetError = (e) => {
    console.warn('[CharCoverCard] image load failed', {
      kind: 'sheet',
      object_name: character?.sheet_preview_path ?? null,
    });
    if (e?.currentTarget) e.currentTarget.style.display = 'none';
  };

  const handleItemImgError = (slot) => () => {
    console.warn('[CharCoverCard] image load failed', {
      kind: 'item',
      object_name: slot?.data?.image_object_name ?? null,
    });
  };

  const tags = Array.isArray(character?.personality_tags)
    ? character.personality_tags.filter(Boolean)
    : [];

  return (
    <div className="character-cover-card">
      <div className="character-cover-card__header">
        <h3>이 곡의 주인공 캐릭터</h3>
      </div>

      {/* 시트 이미지 */}
      <div className="character-cover-card__sheet">
        {character?.sheet_preview_path ? (
          <img
            src={api.characterPreviewUrl(character.sheet_preview_path)}
            alt="주인공 캐릭터 시트"
            className="character-cover-card__sheet-img"
            onError={handleSheetError}
          />
        ) : (
          <div className="character-cover-card__sheet-empty">시트 없음</div>
        )}
      </div>

      {/* 프로필 요약 행 */}
      {(character?.name || character?.age || tags.length > 0 || character?.personality_text) && (
        <div className="character-cover-card__profile-row">
          {(character?.name || character?.age) && (
            <div className="character-cover-card__profile-line">
              {character?.name && (
                <span className="character-cover-card__profile-name">{character.name}</span>
              )}
              {character?.age && (
                <span className="character-cover-card__profile-age">{character.age}세</span>
              )}
            </div>
          )}
          {tags.length > 0 && (
            <div className="character-cover-card__chips">
              {tags.map((tag, i) => (
                <span key={`${tag}-${i}`} className="character-cover-card__chip">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {character?.personality_text && (
            <p className="character-cover-card__profile-text">{character.personality_text}</p>
          )}
        </div>
      )}

      {/* 착용 아이템 — 항상 3 슬롯 */}
      <p className="character-cover-card__outfit-hint">착용 아이템</p>
      <div className="character-cover-card__outfit-row">
        {outfitSlots.map((slot) => {
          const data = slot.data;
          const hasImg = !!data?.image_object_name;
          const hasUrl = !!data?.product_url;
          return (
            <div key={slot.label} className="character-cover-card__outfit-box">
              {data ? (
                <>
                  <div
                    className={
                      'character-cover-card__outfit-image' +
                      (hasUrl ? ' character-cover-card__outfit-image--clickable' : '')
                    }
                    onClick={hasUrl ? handleItemClick(data) : undefined}
                    role={hasUrl ? 'button' : undefined}
                    tabIndex={hasUrl ? 0 : undefined}
                    onKeyDown={
                      hasUrl
                        ? (e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              handleItemClick(data)(e);
                            }
                          }
                        : undefined
                    }
                  >
                    {hasImg ? (
                      <img
                        src={api.adImageUrl(data.image_object_name)}
                        alt={data.name || slot.label}
                        className="character-cover-card__outfit-preview"
                        onError={handleItemImgError(slot)}
                      />
                    ) : (
                      <div className="character-cover-card__outfit-empty">{slot.label} 미선택</div>
                    )}
                  </div>
                  {data.name && (
                    <div
                      className={
                        'character-cover-card__outfit-name' +
                        (hasUrl ? ' character-cover-card__outfit-name--clickable' : '')
                      }
                      onClick={hasUrl ? handleItemClick(data) : undefined}
                    >
                      {data.name}
                    </div>
                  )}
                  {hasUrl && (
                    <a
                      href={data.product_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="character-cover-card__outfit-link"
                      onClick={handleItemClick(data)}
                    >
                      쇼핑몰에서 보기 ▶
                    </a>
                  )}
                </>
              ) : (
                <div className="character-cover-card__outfit-image">
                  <div className="character-cover-card__outfit-empty">{slot.label} 미선택</div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
