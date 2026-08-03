import { Fragment, useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { FiArrowLeft, FiCheck, FiLoader } from 'react-icons/fi';
import * as api from '../api';
import './ItemSelectPage.css';

const CATEGORY_LABELS = {
  '상의': '상의',
  '하의': '하의',
  '신발': '신발',
};

function ItemSelectPage() {
  const { category } = useParams();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // v147 — 5단계 드릴다운: 플랫폼 › 브랜드 › 성별 › 제품 › 색상(leaf)
  const [drill, setDrill] = useState({ platform: null, brand: null, gender: null, product: null });

  const categoryLabel = CATEGORY_LABELS[category] || category;

  useEffect(() => {
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
        console.error('Failed to fetch items:', err);
        setError('아이템을 불러오지 못했습니다.');
      })
      .finally(() => setLoading(false));
  }, [category]);

  const handleSelect = (item) => {
    api.recordAdImpression(item.id).catch(() => {});
    navigate('/my-music', {
      state: {
        selectedItem: {
          id: item.id,
          name: item.name,
          image_object_name: item.image_object_name,
          product_url: item.product_url,
          advertiser_nickname: item.advertiser_nickname,
        },
        category,
        tab: 'character',
      },
    });
  };

  const handleBack = () => {
    navigate('/my-music', { state: { tab: 'character' } });
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
    if (import.meta.env.DEV) console.info('[ItemSelectPage] drill', next);
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
    <div className="item-select-page">
      <div className="item-select-page__header">
        <button className="item-select-page__back-btn" onClick={handleBack}>
          <FiArrowLeft /> 돌아가기
        </button>
        <h2 className="item-select-page__title">아이템 스토어 · {categoryLabel}</h2>
      </div>

      {loading && (
        <div className="item-select-page__loading">
          <FiLoader className="item-select-page__spinner" />
          <span>아이템을 불러오는 중...</span>
        </div>
      )}

      {error && (
        <div className="item-select-page__error">{error}</div>
      )}

      {!loading && !error && items.length === 0 && (
        <div className="item-select-page__empty">
          등록된 {categoryLabel} 아이템이 없습니다.
        </div>
      )}

      {!loading && !error && items.length > 0 && (
        <div className="item-select-page__drill">
          <div className="item-select-page__breadcrumb">
            <button
              type="button"
              className="item-select-page__crumb"
              onClick={() => jumpTo('platform')}
              disabled={!drillActive}
            >
              전체
            </button>
            {crumbs.map((c) => (
              <Fragment key={c.level}>
                <span className="item-select-page__crumb-sep">›</span>
                <button
                  type="button"
                  className="item-select-page__crumb"
                  onClick={() => jumpTo(c.level)}
                >
                  {c.label}
                </button>
              </Fragment>
            ))}
            {drillActive && (
              <button
                type="button"
                className="item-select-page__drill-back"
                onClick={goBack}
              >
                ◀ 뒤로
              </button>
            )}
          </div>

          {currentLevel !== 'color' && (
            <div className="item-select-page__facet">
              <span className="item-select-page__facet-label">
                {currentLevel === 'platform' && '플랫폼'}
                {currentLevel === 'brand' && '브랜드'}
                {currentLevel === 'gender' && '성별'}
                {currentLevel === 'product' && '제품'}
                {' 선택'}
              </span>
              <div className="item-select-page__tiles">
                {currentLevel === 'platform' && platformOptions.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="item-select-page__tile"
                    onClick={() => selectLevel('platform', p)}
                  >
                    {p}
                  </button>
                ))}
                {currentLevel === 'brand' && brandOptions.map((b) => (
                  <button
                    key={b}
                    type="button"
                    className="item-select-page__tile"
                    onClick={() => selectLevel('brand', b)}
                  >
                    {b}
                  </button>
                ))}
                {currentLevel === 'gender' && genderOptions.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className="item-select-page__tile"
                    onClick={() => selectLevel('gender', g)}
                  >
                    {genderLabel(g)}
                  </button>
                ))}
                {currentLevel === 'product' && productOptions.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="item-select-page__tile"
                    onClick={() => selectLevel('product', p)}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="item-select-page__grid">
            {byProduct.map((item) => (
              <div key={item.id} className="item-select-page__card">
                <a href={item.product_url} target="_blank" rel="noopener noreferrer" className="item-select-page__card-image-wrap item-select-page__card-link" onClick={() => api.recordAdClick(item.id).catch(() => {})}>
                  <img
                    src={api.adImageUrl(item.image_object_name)}
                    alt={item.product_name || item.name}
                    className="item-select-page__card-image"
                  />
                  {item.gender === '공용' && (
                    <span className="item-select-page__unisex-badge">공용</span>
                  )}
                  <span className="item-select-page__card-shop">쇼핑몰에서 보기 ▶</span>
                </a>
                <div className="item-select-page__card-name">{item.product_name || item.name}</div>
                {item.color && (
                  <div className="item-select-page__card-color">{item.color}</div>
                )}
                <button
                  className="item-select-page__card-select-btn"
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
  );
}

export default ItemSelectPage;
