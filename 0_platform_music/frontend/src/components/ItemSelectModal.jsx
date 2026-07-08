import { useState, useEffect } from 'react';
import { FiCheck, FiLoader, FiX } from 'react-icons/fi';
import * as api from '../api';
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
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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
    <div className="item-select-modal-overlay" onClick={onClose}>
      <div className="item-select-modal" onClick={(e) => e.stopPropagation()}>
        <div className="item-select-modal__header">
          <h2 className="item-select-modal__title">{categoryLabel} 선택</h2>
          <button className="item-select-modal__close-btn" onClick={onClose} title="닫기">
            <FiX />
          </button>
        </div>

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

          {!loading && !error && Object.keys(grouped).length > 0 && (
            <div className="item-select-modal__groups">
              {Object.entries(grouped).map(([advertiser, advertiserItems]) => (
                <div key={advertiser} className="item-select-modal__group">
                  <h3 className="item-select-modal__group-title">
                    <span className="item-select-modal__group-marker">&#9632;</span>
                    {advertiser}
                  </h3>
                  <div className="item-select-modal__grid">
                    {advertiserItems.map((item) => (
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
                            alt={item.name}
                            className="item-select-modal__card-image"
                          />
                          <span className="item-select-modal__card-shop">쇼핑몰에서 보기 ▶</span>
                        </a>
                        <div className="item-select-modal__card-name">{item.name}</div>
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
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
