import { Fragment, useState, useEffect } from 'react';
import { FiCheck, FiLoader, FiX } from 'react-icons/fi';
import * as api from '../api';
import { useAuth } from '../contexts/AuthContext';
import './ItemSelectModal.css';

const CATEGORY_LABELS = {
  '상의': '상의',
  '하의': '하의',
  '신발': '신발',
};

// 캐릭터 생성 흐름 내 아이템(광고상품) 선택 모달.
// 페이지 이동 없이 MyMusicPage 안에서 떠서 업로드 사진/기존 선택/화풍 state 를 보존한다.
// navigate 절대 사용 금지.
export default function ItemSelectModal({ category, onSelect, onClose }) {
  const { user } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 위시리스트 탭 상태 — 'all'(기본, 기존 동작 불변) | 'wish'
  const [tab, setTab] = useState('all');
  // v147 — 전체 탭 5단계 드릴다운: 플랫폼 › 브랜드 › 성별 › 제품 › 색상(leaf)
  const [drill, setDrill] = useState({ platform: null, brand: null, gender: null, product: null });
  const [wishItems, setWishItems] = useState([]);
  const [wishLoaded, setWishLoaded] = useState(false);
  const [wishError, setWishError] = useState(null); // 'auth' | 'load' | null

  // 비로그인은 로드 자체를 스킵하므로 파생값으로 처리 (state 아님)
  const wishAuthBlocked = !user || wishError === 'auth';
  const wishLoading = !wishAuthBlocked && !wishLoaded;

  const categoryLabel = CATEGORY_LABELS[category] || category;

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.info('[ItemSelectModal] load', { category });
    }
    if (!category || !CATEGORY_LABELS[category]) {
      setError('유효하지 않은 카테고리입니다.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setDrill({ platform: null, brand: null, gender: null, product: null });
    api.getActiveAds(category)
      .then(({ data }) => {
        setItems(data.items || []);
      })
      .catch((err) => {
        console.error('[ItemSelectModal] load failed', { err, category });
        setError('아이템을 불러오지 못했습니다.');
      })
      .finally(() => setLoading(false));
  }, [category]);

  // '내 위시리스트' 탭 최초 진입 시 lazy 로드 (비로그인은 스킵 — 렌더에서 안내)
  useEffect(() => {
    if (tab !== 'wish' || wishLoaded) return undefined;
    if (!user) {
      console.warn('[ItemSelectModal] wishlist load skipped: not logged in');
      return undefined;
    }
    let cancelled = false;
    if (import.meta.env.DEV) {
      console.info('[ItemSelectModal] getWishlist start', { category });
    }
    api.getWishlist(category)
      .then(({ data }) => {
        if (cancelled) return;
        setWishItems(data.items || []);
        if (import.meta.env.DEV) {
          console.info('[ItemSelectModal] getWishlist done', {
            category,
            count: (data.items || []).length,
          });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[ItemSelectModal] getWishlist failed', { err, category });
        setWishError(err?.response?.status === 401 ? 'auth' : 'load');
      })
      .finally(() => {
        if (cancelled) return;
        setWishLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, wishLoaded, user, category]);

  // 위시리스트 탭에서 ♥ 클릭 = 해제 → 목록에서 제거 (낙관적, 실패 시 복원)
  const handleUnwish = (item) => (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!item?.id) return;
    const prevItems = wishItems;
    setWishItems((list) => list.filter((it) => it.id !== item.id));
    if (import.meta.env.DEV) {
      console.info('[ItemSelectModal] unwish start', { id: item.id });
    }
    api.toggleWishlist(item.id)
      .then(({ data }) => {
        if (data?.wishlisted === true) {
          console.warn('[ItemSelectModal] unwish returned wishlisted=true, restoring', {
            id: item.id,
          });
          setWishItems(prevItems);
          return;
        }
        if (import.meta.env.DEV) {
          console.info('[ItemSelectModal] unwish done', { id: item.id });
        }
      })
      .catch((err) => {
        console.error('[ItemSelectModal] unwish failed', { err, id: item.id });
        setWishItems(prevItems);
        if (err?.response?.status === 401) {
          alert('로그인 후 이용할 수 있습니다.');
        }
      });
  };

  const handleSelect = (item) => {
    api.recordAdImpression(item.id).catch(() => {});
    if (import.meta.env.DEV) {
      console.info('[ItemSelectModal] select', { category });
    }
    onSelect({
      id: item.id,
      name: item.name,
      image_object_name: item.image_object_name,
      product_url: item.product_url,
      advertiser_nickname: item.advertiser_nickname,
    });
    onClose();
  };

  // ── v147 5단계 드릴다운 파생값 ──
  const platformOf = (item) => item.advertiser_nickname || '기타';
  const brandOf = (item) => item.brand || item.advertiser_nickname || '기타';
  const productOf = (item) => item.product_name || item.name || '기타';
  // 성별 멤버십: 공용은 남/여 모두에 포함
  const genderMatches = (item, g) => {
    if (item.gender === '공용') return true;
    if (g === '남') return item.gender === '남성용';
    if (g === '여') return item.gender === '여성용';
    return false;
  };

  const byPlatform = drill.platform ? items.filter((i) => platformOf(i) === drill.platform) : items;
  const byBrand = drill.brand ? byPlatform.filter((i) => brandOf(i) === drill.brand) : byPlatform;
  const byGender = drill.gender ? byBrand.filter((i) => genderMatches(i, drill.gender)) : byBrand;
  const byProduct = drill.product ? byGender.filter((i) => productOf(i) === drill.product) : byGender;

  const currentLevel = !drill.platform
    ? 'platform'
    : !drill.brand
      ? 'brand'
      : !drill.gender
        ? 'gender'
        : !drill.product
          ? 'product'
          : 'color';

  const platformOptions = [...new Set(items.map(platformOf))];
  const brandOptions = [...new Set(byPlatform.map(brandOf))];
  const genderOptions = ['남', '여'].filter((g) => byBrand.some((i) => genderMatches(i, g)));
  const productOptions = [...new Set(byGender.map(productOf))];

  const genderLabel = (g) => (g === '남' ? '남성' : '여성');

  const crumbs = [];
  if (drill.platform) crumbs.push({ level: 'platform', label: drill.platform });
  if (drill.brand) crumbs.push({ level: 'brand', label: drill.brand });
  if (drill.gender) crumbs.push({ level: 'gender', label: genderLabel(drill.gender) });
  if (drill.product) crumbs.push({ level: 'product', label: drill.product });

  const selectLevel = (level, value) => {
    const next = { ...drill, [level]: value };
    if (import.meta.env.DEV) console.info('[ItemSelectModal] drill', next);
    setDrill(next);
  };

  const jumpTo = (level) => {
    if (level === 'platform') setDrill({ platform: null, brand: null, gender: null, product: null });
    else if (level === 'brand') setDrill((d) => ({ ...d, brand: null, gender: null, product: null }));
    else if (level === 'gender') setDrill((d) => ({ ...d, gender: null, product: null }));
    else if (level === 'product') setDrill((d) => ({ ...d, product: null }));
  };

  const goBack = () => {
    setDrill((d) => {
      if (d.product) return { ...d, product: null };
      if (d.gender) return { ...d, gender: null, product: null };
      if (d.brand) return { ...d, brand: null, gender: null, product: null };
      if (d.platform) return { platform: null, brand: null, gender: null, product: null };
      return d;
    });
  };

  const drillActive = Boolean(drill.platform || drill.brand || drill.gender || drill.product);

  return (
    <div className="item-select-modal-overlay" onClick={onClose}>
      <div className="item-select-modal" onClick={(e) => e.stopPropagation()}>
        <div className="item-select-modal__header">
          <h2 className="item-select-modal__title">아이템 스토어 · {categoryLabel}</h2>
          <button className="item-select-modal__close-btn" onClick={onClose} title="닫기">
            <FiX />
          </button>
        </div>

        <div className="item-select-modal__tabs">
          <button
            type="button"
            className={
              'item-select-modal__tab' +
              (tab === 'all' ? ' item-select-modal__tab--active' : '')
            }
            onClick={() => setTab('all')}
          >
            전체
          </button>
          <button
            type="button"
            className={
              'item-select-modal__tab' +
              (tab === 'wish' ? ' item-select-modal__tab--active' : '')
            }
            onClick={() => setTab('wish')}
          >
            ♥ 내 위시리스트{wishLoaded && !wishError ? ` (${wishItems.length})` : ''}
          </button>
        </div>

        {tab === 'all' && (
        <div className="item-select-modal__body">
          {loading && (
            <div className="item-select-modal__loading">
              <FiLoader className="item-select-modal__spinner" />
              <span>아이템을 불러오는 중...</span>
            </div>
          )}

          {error && (
            <div className="item-select-modal__error">{error}</div>
          )}

          {!loading && !error && items.length === 0 && (
            <div className="item-select-modal__empty">
              등록된 {categoryLabel} 아이템이 없습니다.
            </div>
          )}

          {!loading && !error && items.length > 0 && (
            <div className="item-select-modal__drill">
              <div className="item-select-modal__breadcrumb">
                <button
                  type="button"
                  className="item-select-modal__crumb"
                  onClick={() => jumpTo('platform')}
                  disabled={!drillActive}
                >
                  전체
                </button>
                {crumbs.map((c) => (
                  <Fragment key={c.level}>
                    <span className="item-select-modal__crumb-sep">›</span>
                    <button
                      type="button"
                      className="item-select-modal__crumb"
                      onClick={() => jumpTo(c.level)}
                    >
                      {c.label}
                    </button>
                  </Fragment>
                ))}
                {drillActive && (
                  <button
                    type="button"
                    className="item-select-modal__drill-back"
                    onClick={goBack}
                  >
                    ◀ 뒤로
                  </button>
                )}
              </div>

              {currentLevel !== 'color' && (
                <div className="item-select-modal__facet">
                  <span className="item-select-modal__facet-label">
                    {currentLevel === 'platform' && '플랫폼'}
                    {currentLevel === 'brand' && '브랜드'}
                    {currentLevel === 'gender' && '성별'}
                    {currentLevel === 'product' && '제품'}
                    {' 선택'}
                  </span>
                  <div className="item-select-modal__tiles">
                    {currentLevel === 'platform' && platformOptions.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="item-select-modal__tile"
                        onClick={() => selectLevel('platform', p)}
                      >
                        {p}
                      </button>
                    ))}
                    {currentLevel === 'brand' && brandOptions.map((b) => (
                      <button
                        key={b}
                        type="button"
                        className="item-select-modal__tile"
                        onClick={() => selectLevel('brand', b)}
                      >
                        {b}
                      </button>
                    ))}
                    {currentLevel === 'gender' && genderOptions.map((g) => (
                      <button
                        key={g}
                        type="button"
                        className="item-select-modal__tile"
                        onClick={() => selectLevel('gender', g)}
                      >
                        {genderLabel(g)}
                      </button>
                    ))}
                    {currentLevel === 'product' && productOptions.map((p) => (
                      <button
                        key={p}
                        type="button"
                        className="item-select-modal__tile"
                        onClick={() => selectLevel('product', p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="item-select-modal__grid">
                {byProduct.map((item) => (
                  <div key={item.id} className="item-select-modal__card">
                    <a
                      href={item.product_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="item-select-modal__card-image-wrap item-select-modal__card-link"
                      onClick={() => api.recordAdClick(item.id).catch(() => {})}
                    >
                      <img
                        src={api.adImageUrl(item.image_object_name)}
                        alt={item.product_name || item.name}
                        className="item-select-modal__card-image"
                      />
                      {item.gender === '공용' && (
                        <span className="item-select-modal__unisex-badge">공용</span>
                      )}
                      <span className="item-select-modal__card-shop">쇼핑몰에서 보기 ▶</span>
                    </a>
                    <div className="item-select-modal__card-name">{item.product_name || item.name}</div>
                    {item.color && (
                      <div className="item-select-modal__card-color">{item.color}</div>
                    )}
                    <button
                      className="item-select-modal__card-select-btn"
                      onClick={() => handleSelect(item)}
                    >
                      <FiCheck /> 선택
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        )}

        {tab === 'wish' && (
        <div className="item-select-modal__body">
          {wishLoading && (
            <div className="item-select-modal__loading">
              <FiLoader className="item-select-modal__spinner" />
              <span>위시리스트를 불러오는 중...</span>
            </div>
          )}

          {wishAuthBlocked && (
            <div className="item-select-modal__empty">로그인 후 이용할 수 있습니다.</div>
          )}

          {!wishAuthBlocked && wishError === 'load' && (
            <div className="item-select-modal__error">위시리스트를 불러오지 못했습니다.</div>
          )}

          {!wishAuthBlocked && !wishError && wishLoaded && wishItems.length === 0 && (
            <div className="item-select-modal__empty">
              위시리스트에 담긴 {categoryLabel} 아이템이 없습니다.
            </div>
          )}

          {!wishAuthBlocked && !wishError && wishItems.length > 0 && (
            <div className="item-select-modal__grid">
              {wishItems.map((item) => {
                const inactive = item.is_active === false;
                return (
                  <div
                    key={item.id}
                    className={
                      'item-select-modal__card' +
                      (inactive ? ' item-select-modal__card--inactive' : '')
                    }
                  >
                    <div
                      className="item-select-modal__card-image-wrap item-select-modal__card-image-wrap--wish"
                      onClick={inactive ? undefined : () => handleSelect(item)}
                      role={inactive ? undefined : 'button'}
                      tabIndex={inactive ? undefined : 0}
                      onKeyDown={
                        inactive
                          ? undefined
                          : (e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleSelect(item);
                              }
                            }
                      }
                    >
                      <img
                        src={api.adImageUrl(item.image_object_name)}
                        alt={item.name}
                        className="item-select-modal__card-image"
                      />
                      {inactive && (
                        <span className="item-select-modal__card-badge">판매종료</span>
                      )}
                      <button
                        type="button"
                        className="item-select-modal__wish-remove-btn"
                        onClick={handleUnwish(item)}
                        title="위시리스트에서 제거"
                        aria-label="위시리스트에서 제거"
                      >
                        ♥
                      </button>
                    </div>
                    <div className="item-select-modal__card-name">{item.name}</div>
                    {item.advertiser_nickname && (
                      <div className="item-select-modal__card-advertiser">
                        {item.advertiser_nickname}
                      </div>
                    )}
                    <button
                      className="item-select-modal__card-select-btn"
                      disabled={inactive}
                      onClick={inactive ? undefined : () => handleSelect(item)}
                    >
                      <FiCheck /> {inactive ? '판매종료' : '선택'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}
