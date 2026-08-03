import { Fragment, useState, useEffect, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import * as api from '../api';
import './BusinessPage.css';

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/* ── 회사 정보 탭 ── */
function CompanyInfoTab() {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getBusinessProfile();
      setProfile(res.data);
      setForm(res.data);
    } catch {
      setError('회사 정보를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await api.updateBusinessProfile(form);
      setProfile(res.data);
      setEditing(false);
    } catch {
      alert('저장에 실패했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="biz-loading">로딩 중...</p>;
  if (error) return <p className="biz-error">{error}</p>;

  const fields = [
    { key: 'company_name', label: '회사명' },
    { key: 'industry', label: '업종' },
    { key: 'contact_name', label: '담당자' },
    { key: 'contact_phone', label: '연락처' },
  ];

  return (
    <div className="biz-info">
      <div className="biz-info__header">
        <h3 className="biz-section-title">회사 정보</h3>
        {!editing && (
          <button className="biz-btn biz-btn--primary" onClick={() => setEditing(true)}>
            정보 수정
          </button>
        )}
      </div>

      <div className="biz-info__card">
        {fields.map((f) => (
          <div key={f.key} className="biz-info__row">
            <span className="biz-info__label">{f.label}</span>
            {editing ? (
              <input
                className="biz-input"
                value={form[f.key] || ''}
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
              />
            ) : (
              <span className="biz-info__value">{profile?.[f.key] || '-'}</span>
            )}
          </div>
        ))}

        {editing && (
          <div className="biz-info__actions">
            <button className="biz-btn biz-btn--secondary" onClick={() => { setEditing(false); setForm(profile); }}>
              취소
            </button>
            <button className="biz-btn biz-btn--primary" onClick={handleSave} disabled={saving}>
              {saving ? '저장 중...' : '저장하기'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── 광고 관리 탭 ── */
const CATEGORY_OPTIONS = ['상의', '하의', '신발', '장소'];
const GENDER_OPTIONS = ['남성용', '여성용', '공용'];

function AdManageTab({ pendingEditId, onClearPendingEdit }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [zoomImage, setZoomImage] = useState(null);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [formData, setFormData] = useState({ image: null, name: '', brand: '', product_name: '', color: '', product_url: '', category: '', gender: '', existingImage: null });
  const [submitting, setSubmitting] = useState(false);
  const [filterCategory, setFilterCategory] = useState('전체');
  const [statsMap, setStatsMap] = useState({});

  const fetchItems = useCallback(async () => {
    try {
      setLoading(true);
      const [itemsRes, dashRes] = await Promise.all([
        api.getAdItems(),
        api.getBusinessDashboard('monthly').catch(() => null),
      ]);
      setItems(itemsRes.data?.items || itemsRes.data || []);
      if (dashRes?.data?.items) {
        const map = {};
        dashRes.data.items.forEach((d) => {
          map[d.item_id] = { impressions: d.impressions ?? 0, clicks: d.clicks ?? 0 };
        });
        setStatsMap(map);
      }
    } catch {
      setError('광고 아이템을 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  /* pendingEditId가 전달되면 해당 아이템 수정 폼 자동 열기 */
  useEffect(() => {
    if (pendingEditId && items.length > 0) {
      const target = items.find((item) => item.id === pendingEditId);
      if (target) {
        setEditingId(target.id);
        setFormData({
          image: null,
          name: target.name || '',
          brand: target.brand || '',
          product_name: target.product_name || '',
          color: target.color || '',
          product_url: target.product_url || '',
          category: target.category || '',
          gender: target.gender || '',
          existingImage: target.image_object_name || null,
        });
        setShowForm(true);
      }
      onClearPendingEdit?.();
    }
  }, [pendingEditId, items, onClearPendingEdit]);

  const resetForm = () => {
    setFormData({ image: null, name: '', brand: '', product_name: '', color: '', product_url: '', category: '', gender: '', existingImage: null });
    setShowForm(false);
    setEditingId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const fd = new FormData();
      if (formData.image) fd.append('image', formData.image);
      // 아이템명(name) 비우면 제품명 - 색상 조합으로 자동 생성
      const composedName = formData.name.trim()
        || [formData.product_name, formData.color].filter(Boolean).join(' - ');
      fd.append('name', composedName);
      fd.append('brand', formData.brand);
      fd.append('product_name', formData.product_name);
      fd.append('color', formData.color);
      fd.append('product_url', formData.product_url);
      fd.append('category', formData.category);
      fd.append('gender', formData.gender);
      if (import.meta.env.DEV) {
        console.info('[BusinessPage] submit ad', {
          brand: formData.brand,
          product_name: formData.product_name,
          color: formData.color,
          category: formData.category,
          gender: formData.gender,
        });
      }

      if (editingId) {
        await api.updateAdItem(editingId, fd);
      } else {
        await api.createAdItem(fd);
      }
      resetForm();
      fetchItems();
    } catch {
      alert(editingId ? '수정에 실패했습니다.' : '등록에 실패했습니다.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = (item) => {
    setEditingId(item.id);
    setFormData({ image: null, name: item.name || '', brand: item.brand || '', product_name: item.product_name || '', color: item.color || '', product_url: item.product_url || '', category: item.category || '', gender: item.gender || '', existingImage: item.image_object_name || null });
    setShowForm(true);
  };

  const handleDelete = async (itemId) => {
    if (!window.confirm('정말 삭제하시겠습니까?')) return;
    try {
      await api.deleteAdItem(itemId);
      fetchItems();
    } catch {
      alert('삭제에 실패했습니다.');
    }
  };

  const handleToggle = async (itemId) => {
    try {
      await api.toggleAdItem(itemId);
      fetchItems();
    } catch {
      alert('상태 변경에 실패했습니다.');
    }
  };

  if (loading) return <p className="biz-loading">로딩 중...</p>;
  if (error) return <p className="biz-error">{error}</p>;

  return (
    <div className="biz-ads">
      <div className="biz-ads__header">
        <h3 className="biz-section-title">광고 아이템 목록</h3>
        {!showForm && (
          <button className="biz-btn biz-btn--primary" onClick={() => setShowForm(true)}>
            + 새 아이템 등록
          </button>
        )}
      </div>

      {showForm && (
        <form className="biz-ads__form" onSubmit={handleSubmit}>
          <h4 className="biz-form-title">{editingId ? '아이템 수정' : '새 아이템 등록'}</h4>
          <div className="biz-form-group">
            <label className="biz-form-label">브랜드</label>
            <input
              type="text"
              className="biz-input"
              value={formData.brand}
              onChange={(e) => setFormData({ ...formData, brand: e.target.value })}
              placeholder="브랜드명 입력"
              required
            />
          </div>
          <div className="biz-form-group">
            <label className="biz-form-label">제품명</label>
            <input
              type="text"
              className="biz-input"
              value={formData.product_name}
              onChange={(e) => setFormData({ ...formData, product_name: e.target.value })}
              placeholder="제품명 입력"
              required
            />
          </div>
          <div className="biz-form-group">
            <label className="biz-form-label">색상</label>
            <input
              type="text"
              className="biz-input"
              value={formData.color}
              onChange={(e) => setFormData({ ...formData, color: e.target.value })}
              placeholder="색상 입력"
              required
            />
          </div>
          <div className="biz-form-group">
            <label className="biz-form-label">아이템명 (선택 — 비우면 자동 생성)</label>
            <input
              type="text"
              className="biz-input"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="비우면 '제품명 - 색상'으로 자동 생성"
            />
          </div>
          <div className="biz-form-group">
            <label className="biz-form-label">카테고리</label>
            <select
              className="biz-input"
              value={formData.category}
              onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              required
            >
              <option value="" disabled>카테고리 선택</option>
              {CATEGORY_OPTIONS.map((cat) => (
                <option key={cat} value={cat}>{cat}</option>
              ))}
            </select>
          </div>
          <div className="biz-form-group">
            <label className="biz-form-label">성별</label>
            <select
              className="biz-input"
              value={formData.gender}
              onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
              required
            >
              <option value="" disabled>성별 선택</option>
              {GENDER_OPTIONS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </div>
          <div className="biz-form-group">
            <label className="biz-form-label">이미지 (jpg, png, webp)</label>
            {formData.existingImage && !formData.image && (
              <div className="biz-form-preview">
                <img src={api.adImageUrl(formData.existingImage)} alt="현재 이미지" className="biz-form-preview__img" />
                <span className="biz-form-preview__label">현재 등록된 이미지 (새 파일 선택 시 교체됩니다)</span>
              </div>
            )}
            <input
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              className="biz-file-input"
              onChange={(e) => setFormData({ ...formData, image: e.target.files[0] })}
            />
          </div>
          <div className="biz-form-group">
            <label className="biz-form-label">제품 URL</label>
            <input
              type="url"
              className="biz-input"
              placeholder="https://..."
              value={formData.product_url}
              onChange={(e) => setFormData({ ...formData, product_url: e.target.value })}
              required
            />
          </div>
          <div className="biz-form-actions">
            <button type="button" className="biz-btn biz-btn--secondary" onClick={resetForm}>
              취소
            </button>
            <button type="submit" className="biz-btn biz-btn--primary" disabled={submitting}>
              {submitting ? '처리 중...' : editingId ? '수정하기' : '등록하기'}
            </button>
          </div>
        </form>
      )}

      <div className="biz-category-tabs">
        {['전체', ...CATEGORY_OPTIONS].map((cat) => (
          <button
            key={cat}
            className={`biz-category-tab ${filterCategory === cat ? 'biz-category-tab--active' : ''}`}
            onClick={() => setFilterCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {(() => {
        const filtered = filterCategory === '전체'
          ? items
          : items.filter((item) => item.category === filterCategory);

        return filtered.length === 0 ? (
          <p className="biz-empty">
            {items.length === 0 ? '등록된 광고 아이템이 없습니다.' : '해당 카테고리의 아이템이 없습니다.'}
          </p>
        ) : (
          <div className="biz-ads__table-wrap">
            <table className="biz-ads__table">
              <thead>
                <tr>
                  <th>이미지</th>
                  <th>아이템명</th>
                  <th>브랜드</th>
                  <th>색상</th>
                  <th>카테고리</th>
                  <th>성별</th>
                  <th>등록일</th>
                  <th>이용 수</th>
                  <th>방문 수</th>
                  <th>상태</th>
                  <th>액션</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className={!item.is_active ? 'biz-ads__row--inactive' : ''}>
                    <td>
                      <div className="biz-ads__thumb" onClick={() => item.image_object_name && setZoomImage(api.adImageUrl(item.image_object_name))} style={{ cursor: item.image_object_name ? 'pointer' : 'default' }}>
                        {item.image_object_name ? (
                          <img src={api.adImageUrl(item.image_object_name)} alt="" onError={(e) => { e.target.style.display = 'none'; }} />
                        ) : <span className="biz-ads__no-image">-</span>}
                      </div>
                    </td>
                    <td><strong>{item.name || '-'}</strong></td>
                    <td>{item.brand || '-'}</td>
                    <td>{item.color || '-'}</td>
                    <td>{item.category ? <span className="biz-category-badge">{item.category}</span> : '-'}</td>
                    <td>{item.gender ? <span className="biz-gender-badge">{item.gender}</span> : '-'}</td>
                    <td>{formatDate(item.created_at)}</td>
                    <td>{(statsMap[item.id]?.impressions ?? 0).toLocaleString()}</td>
                    <td>{(statsMap[item.id]?.clicks ?? 0).toLocaleString()}</td>
                    <td>
                      <span className={`biz-ads__status ${item.is_active ? 'biz-ads__status--active' : ''}`}>
                        {item.is_active ? '활성' : '비활성'}
                      </span>
                    </td>
                    <td>
                      <div className="biz-ads__actions">
                        <button className="biz-btn biz-btn--small" onClick={() => handleEdit(item)}>수정</button>
                        <button className="biz-btn biz-btn--small biz-btn--toggle" onClick={() => handleToggle(item.id)}>
                          {item.is_active ? '비활성화' : '활성화'}
                        </button>
                        <button className="biz-btn biz-btn--small biz-btn--danger" onClick={() => handleDelete(item.id)}>삭제</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}
      {zoomImage && (
        <div className="biz-zoom-overlay" onClick={() => setZoomImage(null)}>
          <div className="biz-zoom-content" onClick={(e) => e.stopPropagation()}>
            <img src={zoomImage} alt="확대 이미지" />
            <button className="biz-zoom-close" onClick={() => setZoomImage(null)}>✕</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 대시보드 탭 ── */
const DASH_CATEGORY_OPTIONS = ['전체', '상의', '하의', '신발', '장소'];
const WEEKDAY_LABELS = ['월', '화', '수', '목', '금', '토', '일'];
// v123 — insights demographics nationalities 키 → 표시 라벨
const NATIONALITY_LABELS = { domestic: '내국인', foreign: '외국인' };
const INSIGHT_DIM_OPTIONS = [
  { key: 'genre', label: '장르별' },
  { key: 'mood', label: '느낌별' },
];

function DashboardTab({ onNavigateToEdit }) {
  const [period, setPeriod] = useState('daily');
  const [dashCategory, setDashCategory] = useState('전체');
  // 본인인증 회원만 집계 필터 — 기본 false(전체)
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // 스타별 성과 — 펼쳐진 아이템 id 1개 + itemId별 { loading, error, data } 캐시
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [starsState, setStarsState] = useState({});
  // 인사이트 — itemId별 { loading, error, data } 캐시 (스타 패턴 준용) + 장르/느낌 토글
  const [insightsState, setInsightsState] = useState({});
  const [insightDim, setInsightDim] = useState('genre');

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      if (import.meta.env.DEV) {
        console.info('[BusinessPage] getBusinessDashboard start', { period, dashCategory, verifiedOnly });
      }
      const res = await api.getBusinessDashboard(period, dashCategory, verifiedOnly);
      setData(res.data);
      if (import.meta.env.DEV) {
        console.info('[BusinessPage] getBusinessDashboard done', {
          items: res.data?.items?.length ?? 0,
        });
      }
    } catch (err) {
      console.error('[BusinessPage] getBusinessDashboard failed', { err, period, dashCategory, verifiedOnly });
      setError('대시보드 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [period, dashCategory, verifiedOnly]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

  // period/카테고리/인증 필터 변경 시: 펼쳐진 스타 패널 접기 + 캐시 초기화 (리프레시 대신 접기 — 단순한 쪽)
  useEffect(() => {
    setExpandedItemId(null);
    setStarsState({});
    setInsightsState({});
  }, [period, dashCategory, verifiedOnly]);

  const fetchStars = useCallback(async (itemId) => {
    setStarsState((m) => ({ ...m, [itemId]: { loading: true } }));
    if (import.meta.env.DEV) {
      console.info('[BusinessPage] getAdItemStars start', { itemId, period, verifiedOnly });
    }
    try {
      const res = await api.getAdItemStars(itemId, period, verifiedOnly);
      if (!Array.isArray(res.data?.stars)) {
        console.warn('[BusinessPage] getAdItemStars unexpected shape: stars not array', { itemId });
      }
      setStarsState((m) => ({ ...m, [itemId]: { loading: false, data: res.data } }));
      if (import.meta.env.DEV) {
        console.info('[BusinessPage] getAdItemStars done', {
          itemId,
          stars: res.data?.stars?.length ?? 0,
          untracked: res.data?.untracked_clicks ?? 0,
        });
      }
    } catch (err) {
      console.error('[BusinessPage] getAdItemStars failed', { err, itemId, period, verifiedOnly });
      setStarsState((m) => ({ ...m, [itemId]: { loading: false, error: true } }));
    }
  }, [period, verifiedOnly]);

  const fetchInsights = useCallback(async (itemId) => {
    setInsightsState((m) => ({ ...m, [itemId]: { loading: true } }));
    if (import.meta.env.DEV) {
      console.info('[BusinessPage] getAdItemInsights start', { itemId, period, verifiedOnly });
    }
    try {
      const res = await api.getAdItemInsights(itemId, period, verifiedOnly);
      setInsightsState((m) => ({ ...m, [itemId]: { loading: false, data: res.data } }));
      if (import.meta.env.DEV) {
        // 인구통계는 값 미출력 — 행 개수만 로깅
        const demo = res.data?.demographics;
        console.info('[BusinessPage] getAdItemInsights done', {
          itemId,
          by_genre: res.data?.by_genre?.length ?? 0,
          by_mood: res.data?.by_mood?.length ?? 0,
          by_hour: res.data?.by_hour?.length ?? 0,
          by_weekday: res.data?.by_weekday?.length ?? 0,
          demographics: {
            age_bands: demo?.age_bands?.length ?? 0,
            genders: demo?.genders?.length ?? 0,
            regions: demo?.regions?.length ?? 0,
            nationalities: demo?.nationalities?.length ?? 0,
          },
        });
      }
    } catch (err) {
      console.error('[BusinessPage] getAdItemInsights failed', { err, itemId, period, verifiedOnly });
      setInsightsState((m) => ({ ...m, [itemId]: { loading: false, error: true } }));
    }
  }, [period, verifiedOnly]);

  // 토글 — lazy: 처음 펼칠 때만 조회, 이미 캐시 있으면 재사용 (스타/인사이트 병렬)
  const handleToggleStars = (itemId) => {
    if (expandedItemId === itemId) {
      setExpandedItemId(null);
      return;
    }
    setExpandedItemId(itemId);
    const cached = starsState[itemId];
    if (!cached || cached.error) fetchStars(itemId);
    const cachedInsights = insightsState[itemId];
    if (!cachedInsights || cachedInsights.error) fetchInsights(itemId);
  };

  const renderStarsPanel = (itemId) => {
    const st = starsState[itemId];
    if (!st || st.loading) {
      return <p className="biz-dashboard__stars-loading">스타 데이터 로딩 중...</p>;
    }
    if (st.error) {
      return <p className="biz-dashboard__stars-error">스타별 성과를 불러오지 못했습니다.</p>;
    }
    const stars = Array.isArray(st.data?.stars) ? st.data.stars : [];
    const untracked = st.data?.untracked_clicks ?? 0;
    return (
      <div className="biz-dashboard__stars-box">
        {stars.length === 0 ? (
          <p className="biz-dashboard__stars-empty">
            아직 집계된 스타 데이터가 없습니다. 위시·클릭 스타 귀속은 오늘부터 수집됩니다.
          </p>
        ) : (
          <table className="biz-dashboard__stars-table">
            <thead>
              <tr>
                <th>순위</th>
                <th>스타</th>
                <th>착장</th>
                <th>위시</th>
                <th>쇼핑몰 클릭</th>
                <th>팔로워</th>
                <th>재생수</th>
                <th>반응률</th>
              </tr>
            </thead>
            <tbody>
              {stars.map((s, i) => (
                <tr key={s.user_id ?? i}>
                  <td>{i + 1}</td>
                  <td>{s.nickname || '-'}</td>
                  <td>{(s.worn_count ?? 0).toLocaleString()}</td>
                  <td>{(s.wish_count ?? 0).toLocaleString()}</td>
                  <td>{(s.click_count ?? 0).toLocaleString()}</td>
                  <td>{(s.follower_count ?? 0).toLocaleString()}</td>
                  <td>{(s.total_plays ?? 0).toLocaleString()}</td>
                  <td>{s.engagement_rate == null ? '-' : `${Number(s.engagement_rate).toFixed(2)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {untracked > 0 && (
          <p className="biz-dashboard__untracked-note">
            스타 미귀속 클릭 {untracked.toLocaleString()}건 (곡 페이지 외 경로)
          </p>
        )}
      </div>
    );
  };

  const renderInsightsPanel = (itemId) => {
    const st = insightsState[itemId];
    if (!st || st.loading) {
      return <p className="biz-dashboard__insights-loading">인사이트 로딩 중...</p>;
    }
    if (st.error) {
      return <p className="biz-dashboard__insights-error">인사이트를 불러오지 못했습니다.</p>;
    }
    const ins = st.data || {};
    const conv = ins.wish_to_click || {};
    const dimSource = insightDim === 'genre' ? ins.by_genre : ins.by_mood;
    const dimRows = Array.isArray(dimSource) ? dimSource : [];
    const dimMax = Math.max(...dimRows.map((r) => Math.max(r.wishes || 0, r.clicks || 0)), 1);
    const byWeekday = Array.isArray(ins.by_weekday) ? ins.by_weekday : [];
    const weekdayMax = Math.max(...byWeekday.map((r) => r.count || 0), 1);
    const byHour = Array.isArray(ins.by_hour) ? ins.by_hour : [];
    const hourMax = Math.max(...byHour.map((r) => r.count || 0), 1);
    const demo = ins.demographics || {};
    const demoGroups = [
      { title: '연령대', rows: (Array.isArray(demo.age_bands) ? demo.age_bands : []).map((r) => ({ key: r.band, count: r.count })) },
      { title: '성별', rows: Array.isArray(demo.genders) ? demo.genders : [] },
      { title: '지역', rows: Array.isArray(demo.regions) ? demo.regions : [] },
      // v123 — 내/외국인 분포 (domestic/foreign → 한글 라벨, 그 외("미입력" 등)는 그대로)
      {
        title: '내/외국인',
        rows: (Array.isArray(demo.nationalities) ? demo.nationalities : []).map((r) => ({
          key: NATIONALITY_LABELS[r.key] || r.key,
          count: r.count,
        })),
      },
    ];

    return (
      <div className="biz-dashboard__insights-box">
        <h5 className="biz-dashboard__insights-title">인사이트</h5>

        <div className="biz-dashboard__insights-conv">
          위시 {(conv.wishes ?? 0).toLocaleString()} → 클릭 {(conv.clicks ?? 0).toLocaleString()}
          {' '}(전환율 {conv.rate == null ? '측정불가' : `${conv.rate}%`})
        </div>

        <div className="biz-dashboard__insights-section">
          <div className="biz-dashboard__insights-dim-head">
            <div className="biz-dashboard__insights-dim-tabs">
              {INSIGHT_DIM_OPTIONS.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className={`biz-dashboard__insights-dim-tab ${insightDim === d.key ? 'biz-dashboard__insights-dim-tab--active' : ''}`}
                  onClick={() => setInsightDim(d.key)}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <div className="biz-dashboard__insights-legend">
              <span><span className="biz-dashboard__insights-legend-color biz-dashboard__insights-legend-color--wish" /> 위시</span>
              <span><span className="biz-dashboard__insights-legend-color biz-dashboard__insights-legend-color--click" /> 클릭</span>
            </div>
          </div>
          {dimRows.length === 0 ? (
            <p className="biz-dashboard__insights-empty">데이터가 없습니다</p>
          ) : (
            <div className="biz-dashboard__insights-hbars">
              {dimRows.map((r, i) => (
                <div key={r.key ?? i} className="biz-dashboard__insights-hrow">
                  <span className="biz-dashboard__insights-hlabel">{r.key || '미입력'}</span>
                  <div className="biz-dashboard__insights-htrack">
                    <div
                      className="biz-dashboard__insights-hbar biz-dashboard__insights-hbar--wish"
                      style={{ width: `${((r.wishes || 0) / dimMax) * 100}%` }}
                    />
                    <div
                      className="biz-dashboard__insights-hbar biz-dashboard__insights-hbar--click"
                      style={{ width: `${((r.clicks || 0) / dimMax) * 100}%` }}
                    />
                  </div>
                  <span className="biz-dashboard__insights-hvals">
                    {(r.wishes ?? 0).toLocaleString()} / {(r.clicks ?? 0).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="biz-dashboard__insights-charts">
          <div className="biz-dashboard__insights-chart">
            <h6 className="biz-dashboard__insights-subtitle">요일별</h6>
            {byWeekday.length === 0 ? (
              <p className="biz-dashboard__insights-empty">데이터가 없습니다</p>
            ) : (
              <div className="biz-dashboard__insights-vbars">
                {byWeekday.map((r, i) => (
                  <div key={r.weekday ?? i} className="biz-dashboard__insights-vwrap">
                    <span className="biz-dashboard__insights-vval">{r.count ?? 0}</span>
                    <div
                      className="biz-dashboard__insights-vbar"
                      style={{ height: `${((r.count || 0) / weekdayMax) * 100}%` }}
                    />
                    <span className="biz-dashboard__insights-vlabel">
                      {WEEKDAY_LABELS[r.weekday] ?? r.weekday}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="biz-dashboard__insights-chart biz-dashboard__insights-chart--hours">
            <h6 className="biz-dashboard__insights-subtitle">시간대별</h6>
            {byHour.length === 0 ? (
              <p className="biz-dashboard__insights-empty">데이터가 없습니다</p>
            ) : (
              <div className="biz-dashboard__insights-vbars">
                {byHour.map((r, i) => (
                  <div
                    key={r.hour ?? i}
                    className="biz-dashboard__insights-vwrap biz-dashboard__insights-vwrap--hour"
                    title={`${r.hour ?? i}시 ${r.count ?? 0}건`}
                  >
                    <div
                      className="biz-dashboard__insights-vbar"
                      style={{ height: `${((r.count || 0) / hourMax) * 100}%` }}
                    />
                    <span className="biz-dashboard__insights-vlabel">
                      {(r.hour ?? i) % 3 === 0 ? `${r.hour ?? i}` : ' '}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="biz-dashboard__insights-demo">
          {demoGroups.map((g) => {
            const groupMax = Math.max(...g.rows.map((r) => r.count || 0), 1);
            return (
              <div key={g.title} className="biz-dashboard__insights-demo-col">
                <h6 className="biz-dashboard__insights-subtitle">{g.title}</h6>
                {g.rows.length === 0 ? (
                  <p className="biz-dashboard__insights-empty">데이터가 없습니다</p>
                ) : (
                  g.rows.map((r, i) => (
                    <div key={r.key ?? i} className="biz-dashboard__insights-demo-row">
                      <span className="biz-dashboard__insights-demo-label">{r.key || '미입력'}</span>
                      <div className="biz-dashboard__insights-demo-track">
                        <div
                          className="biz-dashboard__insights-demo-bar"
                          style={{ width: `${((r.count || 0) / groupMax) * 100}%` }}
                        />
                      </div>
                      <span className="biz-dashboard__insights-demo-count">{(r.count ?? 0).toLocaleString()}</span>
                    </div>
                  ))
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const periodOptions = [
    { value: 'daily', label: '일간' },
    { value: 'weekly', label: '주간' },
    { value: 'monthly', label: '월간' },
  ];

  if (error) return <p className="biz-error">{error}</p>;

  return (
    <div className="biz-dashboard">
      <div className="biz-dashboard__header">
        <h3 className="biz-section-title">광고 성과</h3>
        <div className="biz-dashboard__controls">
          <div className="biz-period-btns">
            {periodOptions.map((opt) => (
              <button
                key={opt.value}
                className={`biz-period-btn ${period === opt.value ? 'biz-period-btn--active' : ''}`}
                onClick={() => setPeriod(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {/* 본인인증 회원 필터 — 기본 전체. 변경 시 대시보드 리프레시 + 스타/인사이트 캐시 초기화 */}
          <div className="biz-period-btns" role="group" aria-label="회원 인증 필터">
            <button
              className={`biz-period-btn ${verifiedOnly ? 'biz-period-btn--active' : ''}`}
              onClick={() => setVerifiedOnly(true)}
            >
              ✅ 인증 회원만
            </button>
            <button
              className={`biz-period-btn ${!verifiedOnly ? 'biz-period-btn--active' : ''}`}
              onClick={() => setVerifiedOnly(false)}
            >
              전체
            </button>
          </div>
        </div>
      </div>

      <div className="biz-category-tabs">
        {DASH_CATEGORY_OPTIONS.map((cat) => (
          <button
            key={cat}
            className={`biz-category-tab ${dashCategory === cat ? 'biz-category-tab--active' : ''}`}
            onClick={() => setDashCategory(cat)}
          >
            {cat}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="biz-loading">로딩 중...</p>
      ) : (
        <>
          <div className="biz-dashboard__summary">
            <div className="biz-stat-card">
              <span className="biz-stat-label">전체 착장 선택</span>
              <span className="biz-stat-value">{(data?.total_impressions ?? 0).toLocaleString()}</span>
            </div>
            <div className="biz-stat-card">
              <span className="biz-stat-label">전체 방문 수</span>
              <span className="biz-stat-value">{(data?.total_clicks ?? 0).toLocaleString()}</span>
            </div>
            <div className="biz-stat-card">
              <span className="biz-stat-label">클릭율(클릭/착장 선택)</span>
              <span className="biz-stat-value">{data?.ctr ?? '0.00'}%</span>
            </div>
            <div className="biz-stat-card">
              <span className="biz-stat-label">사용자 수</span>
              <span className="biz-stat-value">{(data?.total_users ?? 0).toLocaleString()}</span>
            </div>
            <div className="biz-stat-card">
              <span className="biz-stat-label">위시 담김</span>
              <span className="biz-stat-value">{(data?.total_wishes ?? 0).toLocaleString()}</span>
            </div>
            <div className="biz-stat-card">
              <span className="biz-stat-label">착장</span>
              <span className="biz-stat-value">{(data?.total_worn ?? 0).toLocaleString()}</span>
            </div>
          </div>

          {/* 통계 그래프 */}
          {data?.chart_data && data.chart_data.length > 0 && (() => {
            const chartData = data.chart_data;
            const maxBar = Math.max(...chartData.map(d => Math.max(d.impressions || 0, d.clicks || 0, d.users || 0)), 1);
            return (
              <div className="biz-chart">
                <h4 className="biz-subsection-title">일별 통계</h4>
                <div className="biz-chart__legend">
                  <span className="biz-chart__legend-item"><span className="biz-chart__legend-color biz-chart__legend-color--impressions" /> 착장 선택</span>
                  <span className="biz-chart__legend-item"><span className="biz-chart__legend-color biz-chart__legend-color--clicks" /> 방문 수</span>
                  <span className="biz-chart__legend-item"><span className="biz-chart__legend-color biz-chart__legend-color--ctr" /> CTR %</span>
                  <span className="biz-chart__legend-item"><span className="biz-chart__legend-color biz-chart__legend-color--users" /> 사용자 수</span>
                </div>
                <div className="biz-chart__container">
                  {chartData.map((d, i) => (
                    <div key={i} className="biz-chart__group">
                      <div className="biz-chart__bars">
                        <div className="biz-chart__bar-wrap">
                          <span className="biz-chart__bar-value">{d.impressions ?? 0}</span>
                          <div
                            className="biz-chart__bar biz-chart__bar--impressions"
                            style={{ height: `${((d.impressions || 0) / maxBar) * 100}%` }}
                          />
                        </div>
                        <div className="biz-chart__bar-wrap">
                          <span className="biz-chart__bar-value">{d.clicks ?? 0}</span>
                          <div
                            className="biz-chart__bar biz-chart__bar--clicks"
                            style={{ height: `${((d.clicks || 0) / maxBar) * 100}%` }}
                          />
                        </div>
                      </div>
                      <span className="biz-chart__label">{d.label}</span>
                      <div className="biz-chart__line-values">
                        <span className="biz-chart__line-val biz-chart__line-val--ctr">{d.ctr ?? 0}%</span>
                        <span className="biz-chart__line-val biz-chart__line-val--users">{d.users ?? 0}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="biz-dashboard__table-section">
            <h4 className="biz-subsection-title">아이템별 성과</h4>
            <div className="biz-table-wrap">
              <table className="biz-table">
                <thead>
                  <tr>
                    <th>이미지</th>
                    <th>아이템명</th>
                    <th>착장 선택</th>
                    <th>방문 수</th>
                    <th>클릭율(클릭/착장 선택)</th>
                    <th>위시</th>
                    <th>착장</th>
                    <th>스타별</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items || []).map((item) => (
                    <Fragment key={item.item_id}>
                      <tr>
                        <td>
                          <div className="biz-table-thumb">
                            {item.image_object_name ? (
                              <img src={api.adImageUrl(item.image_object_name)} alt="" />
                            ) : (
                              <span>-</span>
                            )}
                          </div>
                        </td>
                        <td>
                          <button
                            className="biz-link-btn"
                            onClick={() => onNavigateToEdit?.(item.item_id)}
                          >
                            {item.name || '-'}
                          </button>
                        </td>
                        <td>{(item.impressions ?? 0).toLocaleString()}</td>
                        <td>{(item.clicks ?? 0).toLocaleString()}</td>
                        <td>{item.ctr ?? '0.00'}%</td>
                        <td>{(item.wish_count ?? 0).toLocaleString()}</td>
                        <td>{(item.worn_count ?? 0).toLocaleString()}</td>
                        <td>
                          <button
                            type="button"
                            className="biz-dashboard__stars-toggle"
                            onClick={() => handleToggleStars(item.item_id)}
                            aria-expanded={expandedItemId === item.item_id}
                          >
                            스타별 성과 {expandedItemId === item.item_id ? '▲' : '▼'}
                          </button>
                        </td>
                      </tr>
                      {expandedItemId === item.item_id && (
                        <tr className="biz-dashboard__stars-row">
                          <td colSpan={8}>
                            {renderStarsPanel(item.item_id)}
                            {renderInsightsPanel(item.item_id)}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                  {(!data?.items || data.items.length === 0) && (
                    <tr><td colSpan={8} className="biz-table-empty">데이터가 없습니다</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ── 메인 BusinessPage ── */
const TABS = [
  { key: 'info', label: '회사 정보' },
  { key: 'ads', label: '광고 관리' },
  { key: 'dashboard', label: '대시보드' },
];

export default function BusinessPage() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('info');
  const [pendingEditId, setPendingEditId] = useState(null);

  const handleNavigateToEdit = useCallback((itemId) => {
    setPendingEditId(itemId);
    setActiveTab('ads');
  }, []);

  const handleClearPendingEdit = useCallback(() => {
    setPendingEditId(null);
  }, []);

  return (
    <div className="biz-page">
      <div className="biz-page__inner">
        <h2 className="biz-page__title">회사관리</h2>
        {user && <p className="biz-page__user">{user.nickname} 님</p>}

        <div className="biz-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              className={`biz-tab ${activeTab === tab.key ? 'biz-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="biz-tab-content">
          {activeTab === 'info' && <CompanyInfoTab />}
          {activeTab === 'ads' && (
            <AdManageTab
              pendingEditId={pendingEditId}
              onClearPendingEdit={handleClearPendingEdit}
            />
          )}
          {activeTab === 'dashboard' && (
            <DashboardTab onNavigateToEdit={handleNavigateToEdit} />
          )}
        </div>
      </div>
    </div>
  );
}
