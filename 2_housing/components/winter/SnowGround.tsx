// v3.442 [Winter] 스플래시 아래쪽 눈 언덕 — 밤에 은은하게 빛나는 두 겹
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { StyleSheet, View } from 'react-native';

export default function SnowGround({ height = 170 }: { height?: number }) {
  return (
    <View style={[styles.wrap, { height }]} pointerEvents="none">
      <Svg width="100%" height="100%" viewBox="0 0 400 170" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="snowBack" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#d9d2ff" stopOpacity={0.55} />
            <Stop offset="1" stopColor="#8f7bd8" stopOpacity={0.1} />
          </LinearGradient>
          <LinearGradient id="snowFront" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#ffffff" stopOpacity={0.92} />
            <Stop offset="1" stopColor="#b9a9f5" stopOpacity={0.55} />
          </LinearGradient>
        </Defs>
        <Path d="M0 70C60 30 120 26 190 58C250 84 320 40 400 34L400 170L0 170Z" fill="url(#snowBack)" />
        <Path d="M0 108C70 78 130 112 200 104C270 96 330 74 400 100L400 170L0 170Z" fill="url(#snowFront)" />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { position: 'absolute', left: 0, right: 0, bottom: 0 } });
