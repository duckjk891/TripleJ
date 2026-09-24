import { useState, useEffect } from 'react';
import { getFeatureUsage, getRetention, getScreenAnalytics } from '../api';
import Journeys from './Journeys';

const DAYS_OPTS = [7, 14, 30];

// 앱 라우트명 → 화면 이름 (없으면 라우트명 그대로)
const SCREEN_LABELS = {
  MainTabs: '메인 탭', Studio: '작업실', Chart: '차트', Feed: '피드', MyMusic: '마이페이지',
  Search: '검색', Settings: '설정', Player: '플레이어', Playlist: '플레이리스트', AlbumDetail: '앨범 상세',
  Map: '작업실 맵', Dialogue: '대화', LyricsInput: '가사 입력', LyricsPromptReview: '가사 프롬프트 확인',
  LyricsLoading: '가사 생성 중', LyricsResult: '가사 결과', ComposerSelect: '작곡가 선택',
  MusicGeneration: '곡 생성', MusicLoading: '곡 생성 중', InstLoading: '반주 생성 중', MusicResult: '곡 결과',
  GenerationHistory: '생성 기록', CoverGeneration: '커버 촬영', CoverLibrary: '커버 보관함',
  VideoDirector: '뮤직비디오', AlbumCoverGeneration: '앨범 커버', ArtistInput: '아티스트 만들기',
  ArtistLoading: '아티스트 생성 중', ArtistResult: '아티스트 결과', FaceVerify: '얼굴 인증',
  MyArtists: '내 아티스트', ArtistCody: '착장(코디)', ArtistDetail: '아티스트 상세',
  VoiceManage: '내 목소리 관리', VoiceCloneWizard: '내 목소리 만들기', LyricsBook: '가사집',
  ComposeLyricsPick: '가사 선택', DmInbox: '메시지', DmChat: '메시지 대화', Notifications: '알림',
  MyReports: '내 신고', FeedCompose: '피드 작성', FeedDetail: '피드 상세', TrackUpload: '음원 파일 올리기',
  UserChannel: '채널', AgencyProfile: '소속사 프로필', DirectorLineup: '디렉터 라인업',
};
export const screenLabel = (s) => SCREEN_LABELS[s] || s;
const label = screenLabel;

function fmtSec(sec) {
  if (sec == null) return '-';
  if (sec < 60) return `${Math.round(sec)}초`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s ? `${m}분 ${s}초` : `${m}분`;
}

export default function AnalyticsPage() {
  const [days, setDays] = useState(7);
  const [features, setFeatures] = useState(null);
  const [screens, setScreens] = useState(null);
  const [retention, setRetention] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setFeatures(null);
    setScreens(null);
    setError('');
    getFeatureUsage(days).then((r) => setFeatures(r.data)).catch(() => setError('사용 분석 데이터를 불러오지 못했습니다.'));
    getScreenAnalytics(days).then((r) => setScreens(r.data)).catch(() => {});
  }, [days]);

  useEffect(() => {
    getRetention(30).then((r) => setRetention(r.data)).catch(() => {});
  }, []);

  const maxCount = Math.max(1, ...(features?.features || []).map((f) => f.count));
  const ss = screens?.summary;
  const hasScreens = ss && ss.sessions > 0;
  const rs = retention?.summary;

  return (
    <div>
      <h2 className="page-title">사용 분석</h2>
      <div className="filters">
        <div className="filter-group">
          {DAYS_OPTS.map((d) => (
            <button key={d} className={`filter-btn ${days === d ? 'active' : ''}`} onClick={() => setDays(d)}>
              최근 {d}일
            </button>
          ))}
        </div>
      </div>
      {error && <p className="error-msg">{error}</p>}

      {/* ---------- 화면 체류·이탈 ---------- */}
      <div className="card">
        <h3 className="section-title">화면별 체류시간 · 이탈</h3>
        {!screens ? <p className="loading">로딩 중…</p> : !hasScreens ? (
          <p className="cell-sub">
            아직 수집된 데이터가 없습니다. 화면 추적은 다음 앱 업데이트(새 빌드)부터 수집됩니다 — 설치된 앱이
            업데이트되면 이 영역이 채워집니다.
          </p>
        ) : (
          <>
            <div className="stats-grid">
              <div className="stat-card"><span className="stat-label">세션</span><span className="stat-value">{ss.sessions.toLocaleString()}</span><span className="cell-sub">앱을 연 횟수 (30분 넘게 떠났다 오면 새 세션) · 기기 {ss.devices} · 로그인 {ss.logged_in_sessions}</span></div>
              <div className="stat-card"><span className="stat-label">평균 세션 시간</span><span className="stat-value">{fmtSec(ss.avg_session_sec)}</span><span className="cell-sub">한 번 열었을 때 평균 사용 시간</span></div>
              <div className="stat-card"><span className="stat-label">세션당 화면 수</span><span className="stat-value">{ss.avg_screens}</span><span className="cell-sub">한 번 열었을 때 평균 몇 화면을 보는지</span></div>
              <div className="stat-card"><span className="stat-label">이탈률 (바운스)</span><span className={`stat-value ${ss.bounce_rate >= 50 ? 'warn' : ''}`}>{ss.bounce_rate}%</span><span className="cell-sub">화면 1개만 보거나 10초 안에 종료</span></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>화면</th><th>총 체류</th><th>평균 체류</th><th>조회</th><th>방문 기기</th><th>여기서 종료</th><th>종료율</th></tr>
                </thead>
                <tbody>
                  {screens.screens.map((s) => (
                    <tr key={s.screen}>
                      <td><div className="cell-main">{label(s.screen)}</div><div className="cell-sub">{s.screen}</div></td>
                      <td>{s.total_min.toLocaleString()}분</td>
                      <td>{fmtSec(s.avg_sec)}</td>
                      <td>{s.views.toLocaleString()}</td>
                      <td>{s.visitors.toLocaleString()}</td>
                      <td>{s.exits.toLocaleString()}</td>
                      <td>{s.exit_rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="cell-sub" style={{ marginTop: 8 }}>
              총 체류 순 정렬. 종료율 = 그 화면 조회 중 세션(앱 사용)이 거기서 끝난 비율. 한 화면 체류는 최대 30분으로 계산.
            </p>
          </>
        )}
      </div>

      <Journeys days={days} />

      {/* ---------- 기능 사용량 ---------- */}
      <div className="card">
        <h3 className="section-title">기능별 사용량 (최근 {days}일)</h3>
        {!features ? <p className="loading">로딩 중…</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>기능</th><th style={{ width: '45%' }}>사용 횟수</th><th>사용자 수</th></tr></thead>
              <tbody>
                {features.features.map((f) => (
                  <tr key={f.key}>
                    <td className="cell-main">{f.label}</td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ height: 8, borderRadius: 4, background: 'var(--primary)', width: `${(f.count / maxCount) * 100}%`, minWidth: f.count ? 2 : 0 }} />
                        <span>{f.count.toLocaleString()}</span>
                      </div>
                    </td>
                    <td>{f.users == null ? '-' : `${f.users.toLocaleString()}명`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="cell-sub" style={{ marginTop: 8 }}>서버에 남는 기능 기록 기준 (검색은 사용자 식별 없음).</p>
      </div>

      {/* ---------- 리텐션 ---------- */}
      <div className="card">
        <h3 className="section-title">가입 후 재방문 (최근 30일 가입자)</h3>
        {!retention ? <p className="loading">로딩 중…</p> : (
          <>
            <div className="stats-grid">
              <div className="stat-card"><span className="stat-label">다음날 재방문 (D1)</span><span className="stat-value">{rs.d1_rate == null ? '-' : `${rs.d1_rate}%`}</span><span className="cell-sub">대상 {rs.d1_base}명</span></div>
              <div className="stat-card"><span className="stat-label">7일 후 재방문 (D7)</span><span className="stat-value">{rs.d7_rate == null ? '-' : `${rs.d7_rate}%`}</span><span className="cell-sub">대상 {rs.d7_base}명</span></div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>가입일</th><th>가입자</th><th>D1 재방문</th><th>D7 재방문</th></tr></thead>
                <tbody>
                  {[...retention.cohorts].reverse().map((c) => (
                    <tr key={c.date}>
                      <td className="nowrap">{c.date}</td>
                      <td>{c.signups}</td>
                      <td>{c.d1 == null ? <span className="cell-sub">대기</span> : `${c.d1}명 (${Math.round((c.d1 / c.signups) * 100)}%)`}</td>
                      <td>{c.d7 == null ? <span className="cell-sub">대기</span> : `${c.d7}명 (${Math.round((c.d7 / c.signups) * 100)}%)`}</td>
                    </tr>
                  ))}
                  {retention.cohorts.length === 0 && <tr><td colSpan={4} className="td-empty">최근 가입자가 없습니다</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="cell-sub" style={{ marginTop: 8 }}>
              테스트 계정 {retention.excluded_test_accounts}개 제외. 재방문 = 그날 로그인 상태로 앱을 사용.
              9/24 이전은 활동 기록으로 복원한 값이라 실제보다 낮을 수 있습니다.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
