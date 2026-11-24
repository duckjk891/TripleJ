// 상품·사진 기준 — 소개 화면, 상품 등록 창, 한꺼번에 등록 화면이 같은 문구를 쓴다(11-24).
// 문구를 바꿀 때는 이 파일만 고치면 세 곳이 함께 바뀐다.

const RULES = [
  '실존 인물의 얼굴이나 목소리를 허락 없이 쓴 것. AI로 만들거나 바꾼 것도 같아요. 본인 동의를 확인할 자료를 요청할 수 있어요.',
  '사진·상표·디자인을 쓸 권리가 없는 것, 사실과 다르거나 부풀린 것.',
];

export function AdRules() {
  return (
    <div className="adrules">
      <b>이런 사진과 문구는 올릴 수 없어요</b>
      <ul>{RULES.map((r) => <li key={r}>{r}</li>)}</ul>
      <b>AI로 만든 인물이 나오는 사진</b>
      <p>실제 사람처럼 보이는 AI 인물이 상품을 추천하는 사진이라면, 인물 가까이에 ‘가상인물’이라고 알아볼 수 있게 적어 주세요.</p>
      <p>기준에 맞지 않는 상품은 미리 알리지 않고 숨길 수 있어요. 숨긴 이유는 소개 화면의 ‘입점·광고 문의’로 물어봐 주세요.</p>
    </div>
  );
}

export const RIGHTS_MISSING_MSG = '사진과 문구를 쓸 권리가 있는지 확인 칸을 눌러 주세요.';

// 등록 전 확인 칸(필수) — 이 화면에서만 확인하고 서버에는 아직 저장하지 않는다.
export function RightsCheck({ checked, onChange }) {
  return (
    <div className="rights">
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>이 사진과 문구를 쓸 권리가 있고, 동의 없는 실존 인물을 쓰지 않았어요. (필수)</span>
      </label>
      <details className="help">
        <summary>상품·사진 기준 보기</summary>
        <AdRules />
      </details>
    </div>
  );
}
