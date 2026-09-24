import { useState, useEffect, useCallback, useRef } from 'react';
import { getExternalHealth } from '../api';
import { formatDate } from './Dashboard';

// v3.217 [HealthCheck] — 외부 API·내부 인프라 상태 (GET /api/admin/health/external)
// 서버가 10분 Redis 캐시를 갖고 있어 60s 폴링해도 실제 프로브는 10분에 1회.
// "새로고침" 버튼만 force=true 로 즉시 재프로브.

const POLL_MS = 60 * 1000;

const STATUS_BADGE = {
  ok: { cls: 'badge--green', label: '정상' },
  fail: { cls: 'badge--red', label: '실패' },
  unknown: { cls: 'badge--gray', label: '미확인' },
};

const TIER_LABEL = {
  active: '실측',
  passive: '수동',
};

const SERVICE_LABEL = {
  suno: 'Suno (sunoapi.org)',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Google Gemini',
  xai: 'xAI (Grok)',
  replicate: 'Replicate',
  s3: 'AWS S3 (미디어)',
  ses: 'AWS SES (메일)',
  postgres: 'PostgreSQL',
  mongodb: 'MongoDB',
  redis: 'Redis',
  elasticsearch: 'Elasticsearch',
  kling: 'Kling (MV 영상)',
  kits: 'KITS',
  fal_seedance: 'fal.ai (Seedance)',
  sync_labs: 'Sync Labs (립싱크)',
  rekognition: 'AWS Rekognition (얼굴인증)',
  suno_voice_validate: 'Suno voice/validate (보이스)',
};

function StatusBadge({ status }) {
  const b = STATUS_BADGE[status] || STATUS_BADGE.unknown;
  return <span className={`badge ${b.cls}`}>{b.label}</span>;
}

export default function HealthPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const timerRef = useRef(null);

  const load = useCallback((force = false) => {
    if (force) setRefreshing(true);
    return getExternalHealth(force)
      .then((res) => {
        setData(res.data);
        setError('');
      })
      .catch(() => setError('헬스체크 데이터를 불러오지 못했습니다.'))
      .finally(() => setRefreshing(false));
  }, []);

  useEffect(() => {
    load(false);
    timerRef.current = setInterval(() => load(false), POLL_MS);
    return () => clearInterval(timerRef.current);
  }, [load]);

  if (error && !data) return <div className="error-msg">{error}</div>;
  if (!data) return <div className="loading">로딩 중…</div>;

  const results = data.results || [];
  const active = results.filter((r) => r.tier === 'active');
  const passive = results.filter((r) => r.tier === 'passive');
  const failCount = results.filter((r) => r.status === 'fail').length;

  const renderRows = (rows) =>
    rows.map((r) => (
      <tr key={r.service}>
        <td className="cell-main">{SERVICE_LABEL[r.service] || r.service}</td>
        <td><StatusBadge status={r.status} /></td>
        <td className="nowrap">{r.latency_ms == null ? '-' : `${r.latency_ms}ms`}</td>
        <td>{r.detail || '-'}</td>
        <td className="nowrap">{formatDate(r.checked_at)}</td>
      </tr>
    ));

  return (
    <div>
      <h2 className="page-title">시스템</h2>

      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">점검 항목</span>
          <span className="stat-value">{results.length}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">실패</span>
          <span className={`stat-value ${failCount > 0 ? 'warn' : ''}`}>{failCount}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">기준 시각</span>
          <span className="stat-value" style={{ fontSize: '0.95rem' }}>
            {formatDate(data.checked_at)}{data.cached ? ' (캐시)' : ''}
          </span>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <h3 className="section-title" style={{ marginBottom: 0 }}>
            외부 API·인프라 (실측 프로브)
          </h3>
          <button className="btn btn--primary btn--sm" disabled={refreshing} onClick={() => load(true)}>
            {refreshing ? '점검 중…' : '새로고침(즉시 재점검)'}
          </button>
        </div>
        {error && <div className="error-msg" style={{ padding: '8px 0' }}>{error}</div>}
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>서비스</th><th>상태</th><th>지연</th><th>상세</th><th>점검 시각</th></tr>
            </thead>
            <tbody>{renderRows(active)}</tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3 className="section-title">수동 감시 (키 설정·최근 24h 사용 집계)</h3>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>서비스</th><th>상태</th><th>지연</th><th>상세</th><th>점검 시각</th></tr>
            </thead>
            <tbody>{renderRows(passive)}</tbody>
          </table>
        </div>
        <p style={{ marginTop: 10, fontSize: '0.8rem', color: 'var(--text-sub)' }}>
          수동(passive) 항목은 무과금 헬스 엔드포인트가 확인되지 않아 실호출하지 않습니다.
          상태는 키 설정 여부와 최근 24시간 실사용 성공/실패 집계 기준입니다. 서버는 결과를
          10분간 캐시하며, 이 페이지는 열려 있는 동안 60초마다 갱신합니다.
        </p>
      </div>
    </div>
  );
}
