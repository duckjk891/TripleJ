// v3.453 [FixedFontScale] 휴대폰 글자 크기 설정과 관계없이 앱 글자를 기본 크기(1.0배)로 고정 (대표 11-28).
//  "기존 ui 랑은 전혀 관계없어야 돼" — 상한(1.2배)이 아니라 글자 키움을 완전히 무시한다.
//  방법: react-native 가 내보내는 Text·TextInput·Animated.Text 를 allowFontScaling=false 를 항상 붙이는 껍데기로 바꿔 끼운다.
//   · React 19 는 함수 컴포넌트의 defaultProps 를 무시해서 Text.defaultProps 방식은 안 먹는다.
//   · Text 모듈 자체의 default 는 읽기 전용(번들에서 getter)이라 못 바꾼다 → react-native 입구(index)의 getter 를 바꾼다.
//     앱 코드와 라이브러리(내비게이션 탭 글자·헤더·아이콘 글꼴·키보드 라이브러리)는 모두 이 입구로 Text 를 가져간다.
//   · 이 파일은 App.tsx 맨 첫 줄에서 불러야 한다(다른 모듈이 Text 를 쓰기 전에).
//  웹은 해당 없음(브라우저 글자 크기는 그대로 둔다).
import { createElement } from 'react';
import { Platform } from 'react-native';

type AnyComp = ((props: any) => any) & Record<string, any>;

function fixed(Orig: AnyComp, name: string): AnyComp {
  // React 19: 함수 컴포넌트는 ref 도 일반 prop 으로 받는다 → 그대로 넘긴다.
  const Fixed: AnyComp = (props: any) => createElement(Orig, { ...props, allowFontScaling: false });
  for (const k of Object.keys(Orig)) {
    if (k !== 'displayName') Fixed[k] = Orig[k]; // TextInput.State 등
  }
  Fixed.displayName = name;
  Fixed.__fixedFontScale = true;
  return Fixed;
}

function swap(target: any, key: string, make: (orig: AnyComp) => AnyComp): boolean {
  try {
    const desc = Object.getOwnPropertyDescriptor(target, key);
    if (!desc || desc.configurable === false) return false;
    const Orig = target[key];
    if (!Orig || Orig.__fixedFontScale) return !!Orig?.__fixedFontScale;
    const next = make(Orig);
    Object.defineProperty(target, key, { configurable: true, enumerable: true, get: () => next });
    return target[key] === next;
  } catch {
    return false;
  }
}

export const fixedFontScaleResult = (() => {
  if (Platform.OS === 'web') return { text: true, input: true, animated: true };
  const RN = require('react-native');
  const text = swap(RN, 'Text', (o) => fixed(o, 'Text'));
  const input = swap(RN, 'TextInput', (o) => fixed(o, 'TextInput'));
  let animated = false;
  if (text) {
    try {
      const A = RN.Animated;
      const FixedText = RN.Text;
      animated = swap(A, 'Text', () => {
        const C = A.createAnimatedComponent(FixedText);
        C.__fixedFontScale = true;
        return C;
      });
    } catch {
      animated = false;
    }
  }
  return { text, input, animated };
})();
