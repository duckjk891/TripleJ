// Metro 번들러 설정
// - web 빌드 시 native-only 모듈(예: react-native-google-mobile-ads)을 빈 모듈로 치환
// - native(ios/android) 빌드 시에는 RN 기본 동작 그대로 두어 production 번들 깨지지 않도록 함
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// web에서만 적용: 패키지 export condition 우선순위 + ESM 대신 CJS 선택
// (zustand의 esm/middleware.mjs가 `import.meta`를 사용해 브라우저에서 SyntaxError 발생하는 이슈 회피)
// native에선 RN 기본 resolver가 알아서 처리하므로 건드리지 않음.
config.resolver.unstable_enablePackageExports = true;

// web 플랫폼에서 native-only 모듈 import 시 빈 모듈로 대체
const NATIVE_ONLY_MODULES = new Set([
  'react-native-google-mobile-ads',
]);

const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web') {
    if (NATIVE_ONLY_MODULES.has(moduleName)) {
      return { type: 'empty' };
    }
    // web에서만 CJS 우선 (import.meta 회피)
    const webCtx = {
      ...context,
      unstable_conditionNames: ['require', 'browser', 'default'],
    };
    if (originalResolveRequest) {
      return originalResolveRequest(webCtx, moduleName, platform);
    }
    return webCtx.resolveRequest(webCtx, moduleName, platform);
  }
  // native: 기본 동작
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
