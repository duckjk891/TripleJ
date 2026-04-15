import { useState, useEffect, useCallback } from 'react';
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
  const [formData, setFormData] = useState({ image: null, name: '', product_url: '', category: '', gender: '', existingImage: null });
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
    setFormData({ image: null, name: '', product_url: '', category: '', gender: '', existingImage: null });
    setShowForm(false);
    setEditingId(null);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      const fd = new FormData();
      if (formData.image) fd.append('image', formData.image);
      fd.append('name', formData.name);
      fd.append('product_url', formData.product_url);
      fd.append('category', formData.category);
      fd.append('gender', formData.gender);

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
    setFormData({ image: null, name: item.name || '', product_url: item.product_url || '', category: item.category || '', gender: item.gender || '', existingImage: item.image_object_name || null });
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
            <label className="biz-form-label">아이템명</label>
            <input
              type="text"
              className="biz-input"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="아이템명 입력"
              required
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

function DashboardTab({ onNavigateToEdit }) {
  const [period, setPeriod] = useState('daily');
  const [dashCategory, setDashCategory] = useState('전체');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchDashboard = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.getBusinessDashboard(period, dashCategory);
      setData(res.data);
    } catch {
      setError('대시보드 데이터를 불러오지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }, [period, dashCategory]);

  useEffect(() => { fetchDashboard(); }, [fetchDashboard]);

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
              <span className="biz-stat-label">전체 이용 수</span>
              <span className="biz-stat-value">{(data?.total_impressions ?? 0).toLocaleString()}</span>
            </div>
            <div className="biz-stat-card">
              <span className="biz-stat-label">전체 방문 수</span>
              <span className="biz-stat-value">{(data?.total_clicks ?? 0).toLocaleString()}</span>
            </div>
            <div className="biz-stat-card">
              <span className="biz-stat-label">CTR (방문 전환율)</span>
              <span className="biz-stat-value">{data?.ctr ?? '0.00'}%</span>
            </div>
            <div className="biz-stat-card">
              <span className="biz-stat-label">사용자 수</span>
              <span className="biz-stat-value">{(data?.total_users ?? 0).toLocaleString()}</span>
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
                  <span className="biz-chart__legend-item"><span className="biz-chart__legend-color biz-chart__legend-color--impressions" /> 이용 수</span>
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
                    <th>이용 수</th>
                    <th>방문 수</th>
                    <th>CTR (방문 전환율)</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.items || []).map((item) => (
                    <tr key={item.item_id}>
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
                    </tr>
                  ))}
                  {(!data?.items || data.items.length === 0) && (
                    <tr><td colSpan={5} className="biz-table-empty">데이터가 없습니다</td></tr>
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
