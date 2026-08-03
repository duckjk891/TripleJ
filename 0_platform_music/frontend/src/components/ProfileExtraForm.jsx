import { useState } from 'react';
import './ProfileExtraForm.css';

// 회원 인구통계(생년월일/성별/지역/내·외국인) 선택 입력 폼 — 가입/온보딩/내 정보 설정 공용.
//
// props:
//   initialValues : { birth_date?, gender?, region?, nationality? } (없으면 전부 미선택, birth_date 는 "YYYY-MM-DD")
//   onSubmit      : (values) => void|Promise — values 는 항상 4키 모두 포함, 미선택은 null
//   onSkip        : () => void — 있으면 "건너뛰기" 버튼 표시
//   onChange      : (values) => void — 임베드 모드용(버튼 없이 값만 상위로 전달)
//   submitLabel   : 저장 버튼 라벨(기본 '저장')
//   busy          : 저장 진행 중 여부(버튼 비활성)
//   lockedFields  : ['birth_date','gender'] 등 — 본인인증 완료 필드 잠금(disabled).
//                   잠긴 필드도 buildValues 에는 포함되므로, 미전송 처리는 호출측 책임.
//   hiddenFields  : ['birth_date','nationality'] 등 — 해당 필드 UI 자체를 숨김(v123 —
//                   RegisterPage STEP 0 게이트에서 이미 받은 값의 중복 입력 방지).
//                   숨긴 필드는 buildValues 에 null 로 포함 — 미전송 처리는 호출측 책임.
//
// onSubmit 없이 onChange 만 주면 버튼 없는 임베드 모드로 동작한다(RegisterPage 섹션용).
// birth_date 는 연/월/일 3개 select 모두 선택 시에만 "YYYY-MM-DD" 로 조합해 반환,
// 하나라도 미선택이면 null (부분 선택 상태는 폼 내부 state 로만 유지).
// nationality 는 'domestic' | 'foreign' | null (v123 — 내/외국인 자기신고).
// 주의: 개인정보 — birth_date/gender/region/nationality 값 자체는 절대 콘솔에 출력하지 않는다.

const CURRENT_YEAR = new Date().getFullYear();
const BIRTH_YEARS = [];
for (let y = CURRENT_YEAR; y >= 1900; y -= 1) BIRTH_YEARS.push(y);
const BIRTH_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

// 선택된 연·월 기준 말일 계산. 연 미선택 시 윤년 가능 기준(29일), 월 미선택 시 31일.
const daysInMonth = (year, month) => {
  if (month === '') return 31;
  const y = year === '' ? 2000 : parseInt(year, 10); // 2000 = 윤년 (연 미선택 시 2/29 허용)
  return new Date(y, parseInt(month, 10), 0).getDate();
};

// "YYYY-MM-DD" → { y, m, d } (내부 state 용 문자열, 무효 형식이면 전부 미선택)
const parseBirthDate = (s) => {
  const m = typeof s === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  if (!m) return { y: '', m: '', d: '' };
  return {
    y: String(parseInt(m[1], 10)),
    m: String(parseInt(m[2], 10)),
    d: String(parseInt(m[3], 10)),
  };
};

const pad2 = (v) => String(v).padStart(2, '0');

const GENDER_OPTIONS = [
  { value: 'male', label: '남성' },
  { value: 'female', label: '여성' },
  { value: 'other', label: '기타' },
  { value: '', label: '선택안함' },
];

// v123 — 내/외국인 자기신고 (백엔드 계약값: domestic | foreign)
const NATIONALITY_OPTIONS = [
  { value: 'domestic', label: '내국인' },
  { value: 'foreign', label: '외국인' },
  { value: '', label: '선택안함' },
];

const REGION_OPTIONS = [
  '서울', '부산', '대구', '인천', '광주', '대전', '울산', '세종',
  '경기', '강원', '충북', '충남', '전북', '전남', '경북', '경남',
  '제주', '해외',
];

// '' ↔ null 변환: 내부 state 는 '' (uncontrolled 경고 방지), 외부 계약은 null.
const toNullable = (v) => (v === '' || v === undefined || v === null ? null : v);

export default function ProfileExtraForm({
  initialValues,
  onSubmit,
  onSkip,
  onChange,
  submitLabel = '저장',
  busy = false,
  lockedFields = [],
  hiddenFields = [],
}) {
  const lockBirth = lockedFields.includes('birth_date');
  const lockGender = lockedFields.includes('gender');
  const hideBirth = hiddenFields.includes('birth_date');
  const hideNationality = hiddenFields.includes('nationality');
  const hideGender = hiddenFields.includes('gender'); // v125 — 게이트 필수 승격으로 가입 폼에서 숨김
  const initialBirth = parseBirthDate(initialValues?.birth_date);
  const [birthYear, setBirthYear] = useState(initialBirth.y);
  const [birthMonth, setBirthMonth] = useState(initialBirth.m);
  const [birthDay, setBirthDay] = useState(initialBirth.d);
  const [gender, setGender] = useState(initialValues?.gender || '');
  const [region, setRegion] = useState(initialValues?.region || '');
  const [nationality, setNationality] = useState(initialValues?.nationality || '');

  const buildValues = (by, bm, bd, g, r, n) => ({
    birth_date:
      by !== '' && bm !== '' && bd !== ''
        ? `${by}-${pad2(bm)}-${pad2(bd)}`
        : null,
    gender: toNullable(g),
    region: toNullable(r),
    nationality: toNullable(n),
  });

  const emitChange = (by, bm, bd, g, r, n) => {
    if (onChange) onChange(buildValues(by, bm, bd, g, r, n));
  };

  // 연/월 변경 시 현재 선택된 일이 새 말일을 넘으면 일 선택 해제
  const changeBirthPart = (nextYear, nextMonth, nextDay) => {
    let day = nextDay;
    if (day !== '' && parseInt(day, 10) > daysInMonth(nextYear, nextMonth)) {
      day = '';
    }
    setBirthYear(nextYear);
    setBirthMonth(nextMonth);
    setBirthDay(day);
    emitChange(nextYear, nextMonth, day, gender, region, nationality);
  };

  const handleSubmit = async () => {
    const values = buildValues(birthYear, birthMonth, birthDay, gender, region, nationality);
    if (import.meta.env.DEV) {
      const filled = Object.values(values).filter((v) => v !== null).length;
      console.info('[ProfileExtra] submit', { filledFields: filled });
    }
    if (onSubmit) await onSubmit(values);
  };

  return (
    <div className="profile-extra">
      <p className="profile-extra__notice">
        선택사항입니다 — 맞춤 콘텐츠·통계에만 활용됩니다
      </p>

      {!hideBirth && (
      <div className="profile-extra__field">
        <label className="profile-extra__label" htmlFor="profile-extra-birth-year">
          생년월일 (선택)
        </label>
        <div className="profile-extra__birth-row">
          <select
            id="profile-extra-birth-year"
            className="profile-extra__select"
            aria-label="출생 연도"
            value={birthYear}
            disabled={lockBirth}
            onChange={(e) => changeBirthPart(e.target.value, birthMonth, birthDay)}
          >
            <option value="">연도</option>
            {BIRTH_YEARS.map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
          <select
            className="profile-extra__select"
            aria-label="출생 월"
            value={birthMonth}
            disabled={lockBirth}
            onChange={(e) => changeBirthPart(birthYear, e.target.value, birthDay)}
          >
            <option value="">월</option>
            {BIRTH_MONTHS.map((m) => (
              <option key={m} value={m}>{m}월</option>
            ))}
          </select>
          <select
            className="profile-extra__select"
            aria-label="출생 일"
            value={birthDay}
            disabled={lockBirth}
            onChange={(e) => changeBirthPart(birthYear, birthMonth, e.target.value)}
          >
            <option value="">일</option>
            {Array.from({ length: daysInMonth(birthYear, birthMonth) }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>{d}일</option>
            ))}
          </select>
        </div>
      </div>
      )}

      {!hideGender && (
      <div className="profile-extra__field">
        <span className="profile-extra__label">성별</span>
        <div className="profile-extra__radios" role="radiogroup" aria-label="성별">
          {GENDER_OPTIONS.map((opt) => (
            <label key={opt.value || 'none'} className="profile-extra__radio">
              <input
                type="radio"
                name="profile-extra-gender"
                value={opt.value}
                checked={gender === opt.value}
                disabled={lockGender}
                onChange={() => {
                  setGender(opt.value);
                  emitChange(birthYear, birthMonth, birthDay, opt.value, region, nationality);
                }}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </div>
      </div>
      )}

      <div className="profile-extra__field">
        <label className="profile-extra__label" htmlFor="profile-extra-region">
          지역
        </label>
        <select
          id="profile-extra-region"
          className="profile-extra__select"
          value={region}
          onChange={(e) => {
            setRegion(e.target.value);
            emitChange(birthYear, birthMonth, birthDay, gender, e.target.value, nationality);
          }}
        >
          <option value="">선택안함</option>
          {REGION_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {!hideNationality && (
        <div className="profile-extra__field">
          <span className="profile-extra__label">내/외국인</span>
          <div className="profile-extra__radios" role="radiogroup" aria-label="내/외국인">
            {NATIONALITY_OPTIONS.map((opt) => (
              <label key={opt.value || 'none'} className="profile-extra__radio">
                <input
                  type="radio"
                  name="profile-extra-nationality"
                  value={opt.value}
                  checked={nationality === opt.value}
                  onChange={() => {
                    setNationality(opt.value);
                    emitChange(birthYear, birthMonth, birthDay, gender, region, opt.value);
                  }}
                />
                <span>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {(onSubmit || onSkip) && (
        <div className="profile-extra__actions">
          {onSkip && (
            <button
              type="button"
              className="profile-extra__skip-btn"
              onClick={onSkip}
              disabled={busy}
            >
              건너뛰기
            </button>
          )}
          {onSubmit && (
            <button
              type="button"
              className="profile-extra__submit-btn"
              onClick={handleSubmit}
              disabled={busy}
            >
              {busy ? '저장 중...' : submitLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
