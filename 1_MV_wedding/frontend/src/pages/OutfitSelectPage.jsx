import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as api from '../api';
import './OutfitSelectPage.css';

const VALID_ROLES = ['groom', 'bride'];
const VALID_STYLES = ['casual', 'wedding'];
const VALID_CATEGORIES = ['top', 'bottom', 'shoes'];

const ROLE_LABEL = { groom: '신랑', bride: '신부' };
const STYLE_LABEL = { casual: '평상복', wedding: '웨딩 촬영복' };
const CATEGORY_LABEL = { top: '상의', bottom: '하의', shoes: '신발' };

export default function OutfitSelectPage() {
  const { role, style, category } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const valid =
    VALID_ROLES.includes(role) &&
    VALID_STYLES.includes(style) &&
    VALID_CATEGORIES.includes(category);

  useEffect(() => {
    if (!valid) {
      setError('유효하지 않은 카테고리입니다.');
      setLoading(false);
      return;
    }
    console.info('[OutfitSelectPage] fetching outfits', { role, style, category });
    setLoading(true);
    setError('');
    api
      .getWeddingOutfits({ role, style, category })
      .then(({ data }) => {
        const next = Array.isArray(data?.items) ? data.items : [];
        if (import.meta.env.DEV) {
          console.info('[OutfitSelectPage] outfits loaded', {
            role,
            style,
            category,
            count: next.length,
          });
        }
        setItems(next);
      })
      .catch((err) => {
        console.error('[OutfitSelectPage] fetch failed', {
          err,
          role,
          style,
          category,
        });
        setError('의상을 불러오지 못했습니다. 잠시 후 다시 시도해주세요.');
      })
      .finally(() => setLoading(false));
  }, [role, style, category, valid]);

  const handleBack = () => {
    navigate('/wizard');
  };

  const handleSelect = (item) => {
    if (import.meta.env.DEV) {
      console.info('[OutfitSelectPage] select outfit', {
        role,
        style,
        category,
        item_id: item.id,
      });
    }
    navigate('/wizard', {
      state: {
        selectedOutfit: {
          id: item.id,
          name: item.name,
          image_object_name: item.image_object_name,
          category,
        },
        role,
        style,
        category,
        returnStep: 1,
      },
    });
  };

  const title = valid
    ? `${ROLE_LABEL[role]} · ${STYLE_LABEL[style]} · ${CATEGORY_LABEL[category]}`
    : '의상 선택';

  return (
    <section className="outfit-select">
      <div className="outfit-select__head">
        <button type="button" className="btn-ghost" onClick={handleBack}>
          ← 돌아가기
        </button>
        <h1 className="outfit-select__title">{title}</h1>
      </div>

      {loading && (
        <div className="outfit-select__state muted">의상을 불러오는 중…</div>
      )}

      {!loading && error && (
        <div className="outfit-select__error" role="alert">
          {error}
        </div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="outfit-select__state muted">
          등록된 의상이 없습니다.
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="outfit-select__grid">
          {items.map((item) => (
            <div key={item.id} className="outfit-card">
              <div className="outfit-card__image-wrap">
                <img
                  className="outfit-card__image"
                  src={api.sheetPreviewUrl(item.image_object_name)}
                  alt={item.name}
                  loading="lazy"
                />
              </div>
              <div className="outfit-card__name">{item.name}</div>
              <button
                type="button"
                className="btn-primary outfit-card__btn"
                onClick={() => handleSelect(item)}
              >
                선택
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
