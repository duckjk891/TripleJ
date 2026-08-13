import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLevelUpQueueStore } from '../stores/levelUpQueueStore';
import { colors } from '../theme/colors';

const TOAST_MS = 3500;

export default function LevelUpModal() {
  const insets = useSafeAreaInsets();
  const queue = useLevelUpQueueStore((s) => s.queue);
  const dequeue = useLevelUpQueueStore((s) => s.dequeue);

  const current = queue[0];
  const slideAnim = useRef(new Animated.Value(-100)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!current) return;

    // slide-in
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: 0,
        duration: 300,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start();

    // 자동 dismiss
    timeoutRef.current = setTimeout(() => {
      handleDismiss();
    }, TOAST_MS);

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id]);

  const handleDismiss = () => {
    Animated.parallel([
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => {
      dequeue();
      // slideAnim/fadeAnim 다음 이벤트를 위해 reset
      slideAnim.setValue(-100);
      fadeAnim.setValue(0);
    });
  };

  if (!current) return null;

  const titlePrefix = current.kind === 'artist' ? '아티스트가' : '기획사가';

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrap,
        { top: insets.top + 8 },
        { transform: [{ translateY: slideAnim }], opacity: fadeAnim },
      ]}
    >
      <TouchableOpacity activeOpacity={0.85} onPress={handleDismiss} style={styles.toast}>
        <Text style={styles.emoji}>{current.emoji}</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>🎉 {titlePrefix} Lv.{current.newLevel}!</Text>
          <Text style={styles.sub}>
            {current.rankLabel} 달성!
          </Text>
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
    elevation: 12,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface1,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: colors.accent.primary,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
  },
  emoji: { fontSize: 32, marginRight: 12 },
  title: { color: colors.text.primary, fontSize: 14, fontWeight: '800', marginBottom: 2 },
  sub: { color: colors.text.secondary, fontSize: 12, fontWeight: '600' },
});
