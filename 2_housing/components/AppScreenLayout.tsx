import { ReactNode } from 'react';
import {
  View,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  ViewStyle,
  StyleProp,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePlayerStore } from '../stores/playerStore';
import { colors } from '../theme/colors';

/**
 * 앱 전반의 공통 화면 레이아웃 래퍼.
 *
 * 자동으로 처리:
 *  - 상단 노치 safeArea (헤더 없는 화면용)
 *  - 하단 인디케이터 safeArea
 *  - MiniPlayer가 떠 있으면 하단 70px 여유 추가
 *  - Tab 화면의 경우 BottomTabBar(49px + safeArea bottom)도 회피
 *  - ScrollView 옵션 (긴 컨텐츠 자동 스크롤)
 *  - KeyboardAvoidingView (입력 화면)
 *  - 하단 고정 영역(bottomFixed) — 스크롤되지 않는 버튼 영역
 *
 * MapScreen 같은 특수 화면은 사용하지 않음 (자체 레이아웃 유지).
 */

const MINI_PLAYER_HEIGHT = 70;
const TAB_BAR_HEIGHT = 49;

interface AppScreenLayoutProps {
  children: ReactNode;
  /** Tab 헤더가 있는 화면이면 true (상단 safeArea 자동 처리됨, 중복 적용 X) */
  hasHeader?: boolean;
  /** 본문을 ScrollView로 감쌀지 (false면 flex View — 풀스크린/로딩 화면용) */
  scroll?: boolean;
  /** 키보드 회피 (입력 화면용) */
  keyboardAvoiding?: boolean;
  /** 미니플레이어 떠 있을 때 자동 padding 추가 (default true) */
  avoidMiniPlayer?: boolean;
  /** Tab 화면이면 true — 하단 탭바 영역 회피 (default false: Root Stack 화면) */
  insideTab?: boolean;
  /** 하단 고정 영역 (스크롤 안 됨). 보통 [저장] [취소] 같은 액션 버튼 */
  bottomFixed?: ReactNode;
  /** 컨테이너에 추가 스타일 */
  style?: StyleProp<ViewStyle>;
  /** ScrollView contentContainerStyle 또는 View 본문 스타일 */
  contentStyle?: StyleProp<ViewStyle>;
  /** 좌우 default padding 적용 여부 (default false) */
  padded?: boolean;
}

export default function AppScreenLayout({
  children,
  hasHeader = false,
  scroll = true,
  keyboardAvoiding = false,
  avoidMiniPlayer = true,
  insideTab = false,
  bottomFixed,
  style,
  contentStyle,
  padded = false,
}: AppScreenLayoutProps) {
  const insets = useSafeAreaInsets();
  const hasMiniPlayer = !!usePlayerStore((s) => s.track);

  // 상단: 헤더가 있으면 RN Navigation이 처리 → 0. 아니면 노치 영역만큼
  const topPad = hasHeader ? 0 : insets.top;

  // 하단: 미니플레이어/탭바/노치 합산
  // - insideTab: tabBar(49) 위에 그려지므로 본문 내부 padding 불필요 (RN Nav가 처리). 단 미니플레이어가 탭바 위에 있어서 그건 본문이 회피해야 함.
  // - !insideTab (Root Stack): tabBar 없음. 미니플레이어만 회피.
  let bottomPad = 0;
  if (insideTab) {
    // Tab 본문: 하단 노치 + 탭바는 RN Navigation이 처리. 미니플레이어만 추가.
    if (hasMiniPlayer && avoidMiniPlayer) bottomPad += MINI_PLAYER_HEIGHT;
  } else {
    // Root Stack: 노치 + 미니플레이어(있으면 탭바 위에 떠있긴 한데 root stack은 보통 풀스크린)
    bottomPad += insets.bottom;
    if (hasMiniPlayer && avoidMiniPlayer) bottomPad += MINI_PLAYER_HEIGHT + TAB_BAR_HEIGHT;
  }

  // 본문 영역
  const inner = scroll ? (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={[
        padded ? styles.paddedContent : null,
        bottomFixed ? null : { paddingBottom: bottomPad + (padded ? 16 : 0) },
        contentStyle,
      ]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padded ? styles.paddedContent : null, contentStyle]}>
      {children}
    </View>
  );

  // bottomFixed가 있으면: 본문 영역은 그 위에서 끝나고, 하단 고정 영역이 따로
  const body = bottomFixed ? (
    <View style={styles.flex}>
      {inner}
      <View style={[styles.bottomFixed, { paddingBottom: bottomPad }]}>
        {bottomFixed}
      </View>
    </View>
  ) : (
    inner
  );

  const root = (
    <View style={[styles.root, { paddingTop: topPad }, style]}>
      {body}
    </View>
  );

  if (keyboardAvoiding) {
    return (
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? (hasHeader ? 0 : 0) : 0}
      >
        {root}
      </KeyboardAvoidingView>
    );
  }
  return root;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  root: {
    flex: 1,
    backgroundColor: colors.bg.deepest,
  },
  paddedContent: {
    paddingHorizontal: 16,
  },
  bottomFixed: {
    backgroundColor: colors.bg.deepest,
    borderTopWidth: 1,
    borderTopColor: colors.bg.surface1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
});
