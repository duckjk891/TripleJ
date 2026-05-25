// Metro 번들러 설정
// - web 빌드 시 native-only 모듈(예: react-native-google-mobile-ads)을 빈 모듈로 치환
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// 패키지 export condition 우선순위 — 'import' 조건을 빼서 ESM(.mjs) 대신 CJS(.js) 선택
// (예: zustand의 esm/middleware.mjs가 `import.meta`를 사용해 브라우저에서 SyntaxError 발생)
config.resolver.unstable_conditionNames = ['require', 'react-native', 'browser', 'default'];
config.resolver.unstable_enablePackageExports = true;

// web 플랫폼에서 native-only 모듈 import 시 빈 모듈로 대체
const NATIVE_ONLY_MODULES = new Set([
  'react-native-google-mobile-ads',
]);

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && NATIVE_ONLY_MODULES.has(moduleName)) {
    return { type: 'empty' };
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
