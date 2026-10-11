// [iOS 빌드] expo-age-range 0.2.x(npm 태그 sdk-55)는 podspec 이 Swift 6 언어 모드라, 이 프로젝트의
// SDK 54 빌드 이미지(Xcode 26.0)에서 AgeRangeModule.swift:14 "task or actor isolated value cannot be sent"
// 로 컴파일이 실패한다(EAS build b4855e96, 2026-10-11). 모듈 코드는 그대로 두고 이 Pod 타깃만 Swift 5 모드로
// 빌드해 엄격 동시성 검사를 경고로 낮춘다. SDK 55(Xcode 26.2) 이상으로 올리면 이 플러그인을 지울 것.
const { withPodfile } = require('expo/config-plugins');

const MARKER = '# [withAgeRangeSwift5]';

module.exports = function withAgeRangeSwift5(config) {
  return withPodfile(config, (cfg) => {
    const src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;
    const hook = /post_install do \|installer\|\n/;
    if (!hook.test(src)) {
      throw new Error('[withAgeRangeSwift5] Podfile 에 post_install 블록이 없어 패치할 수 없습니다');
    }
    cfg.modResults.contents = src.replace(
      hook,
      (m) =>
        `${m}    ${MARKER} expo-age-range: Swift 6 엄격 동시성 컴파일 실패 회피(이 타깃만 Swift 5)\n` +
        `    installer.pods_project.targets.each do |t|\n` +
        `      next unless t.name == 'ExpoAgeRange'\n` +
        `      t.build_configurations.each { |bc| bc.build_settings['SWIFT_VERSION'] = '5.0' }\n` +
        `    end\n`
    );
    return cfg;
  });
};
