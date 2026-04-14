import { useState, useEffect } from 'react';
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

  const categoryLabel = CATEGORY_LABELS[category] || category;

  useEffect(() => {
    if (!category || !CATEGORY_LABELS[category]) {
      setError('유효하지 않은 카테고리입니다.');
      setLoading(false);
      return;
    }

    setLoading(true);
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

  // Group items by advertiser_nickname
  const grouped = {};
  items.forEach((item) => {
    const advertiser = item.advertiser_nickname || '기타';
    if (!grouped[advertiser]) {
      grouped[advertiser] = [];
    }
    grouped[advertiser].push(item);
  });

  return (
    <div className="item-select-page">
      <div className="item-select-page__header">
        <button className="item-select-page__back-btn" onClick={handleBack}>
          <FiArrowLeft /> 돌아가기
        </button>
        <h2 className="item-select-page__title">{categoryLabel} 선택</h2>
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

      {!loading && !error && Object.keys(grouped).length > 0 && (
        <div className="item-select-page__groups">
          {Object.entries(grouped).map(([advertiser, advertiserItems]) => (
            <div key={advertiser} className="item-select-page__group">
              <h3 className="item-select-page__group-title">
                <span className="item-select-page__group-marker">&#9632;</span>
                {advertiser}
              </h3>
              <div className="item-select-page__grid">
                {advertiserItems.map((item) => (
                  <div key={item.id} className="item-select-page__card">
                    <a href={item.product_url} target="_blank" rel="noopener noreferrer" className="item-select-page__card-image-wrap item-select-page__card-link" onClick={() => api.recordAdClick(item.id).catch(() => {})}>
                      <img
                        src={api.adImageUrl(item.image_object_name)}
                        alt={item.name}
                        className="item-select-page__card-image"
                      />
                      <span className="item-select-page__card-shop">쇼핑몰에서 보기 ▶</span>
                    </a>
                    <div className="item-select-page__card-name">{item.name}</div>
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
          ))}
        </div>
      )}
    </div>
  );
}

export default ItemSelectPage;
