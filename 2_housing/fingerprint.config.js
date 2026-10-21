// v3.391 [OTA] 런타임 버전(fingerprint) 계산 설정 — 네이티브가 바뀔 때만 runtime 이 갈리게.
//  · eas.json: 빌드 프로필·광고 env(JS 값) 변경으로 기존 설치 앱이 OTA 를 못 받는 일 방지(네이티브 무관).
//  · .gitignore: CNG(android/ios 폴더 미보관)에서는 네이티브에 영향 없음 — 다른 세션의 ignore 추가로 runtime 이 바뀌지 않게.
/** @type {import('expo/fingerprint').Config} */
const config = {
  ignorePaths: ['eas.json', '.gitignore'],
};
module.exports = config;
