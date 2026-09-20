// Metro 번들러 설정
// - web 빌드 시 native-only 모듈(예: react-native-google-mobile-ads)을 빈 모듈로 치환
// - web 빌드 시 zustand 의 ESM(.mjs) 해석 결과를 CJS(.js)로 치환
//   (zustand 미들웨어(devtools)의 esm/*.mjs 가 `import.meta.env` 를 사용 →
//    expo web 의 index.html 은 번들을 type="module" 이 아닌 일반 <script> 로 로드하므로
//    `import.meta` 가 파싱 단계에서 SyntaxError 를 던져 앱 전체가 백지가 됨.
//    런타임 가드(`import.meta.env ? ...`)가 있어도 "파싱" 에러라 무의미 →
//    아예 import.meta 가 없는 CJS 빌드로 web 에서만 강제 치환한다.)
//   ※ 이전 버전은 context 에 unstable_conditionNames 를 주입했으나 Expo SDK 54
//     resolver 에서 무시되어 동작하지 않았음. 해석 결과를 직접 치환하는 방식이 확실.
// - native(ios/android) 빌드는 RN 기본 동작 그대로 (production 번들 안전).
const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const config = getDefaultConfig(__dirname);

// package.json "exports" 필드 해석 활성화 (RN 0.81 / Expo 54).
config.resolver.unstable_enablePackageExports = true;

// web 플랫폼에서 native-only 모듈 import 시 빈 모듈로 대체
const NATIVE_ONLY_MODULES = new Set([
  'react-native-google-mobile-ads',
]);

const ZUSTAND_ESM_SEG = `${path.sep}zustand${path.sep}esm${path.sep}`;

const originalResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  // web: native-only 모듈은 빈 모듈로
  if (platform === 'web' && NATIVE_ONLY_MODULES.has(moduleName)) {
    return { type: 'empty' };
  }

  // 기본 해석 수행 (native 포함 공통)
  const resolve = originalResolveRequest || context.resolveRequest;
  const res = resolve(context, moduleName, platform);

  // web: zustand 의 ESM(.mjs) → 동일 이름의 CJS(.js) 로 치환 (import.meta 제거)
  if (
    platform === 'web' &&
    res &&
    typeof res.filePath === 'string' &&
    res.filePath.includes(ZUSTAND_ESM_SEG) &&
    res.filePath.endsWith('.mjs')
  ) {
    const cjs = res.filePath
      .replace(`${path.sep}esm${path.sep}`, path.sep)
      .replace(/\.mjs$/, '.js');
    if (fs.existsSync(cjs)) {
      return { ...res, filePath: cjs };
    }
  }

  return res;
};

module.exports = config;
