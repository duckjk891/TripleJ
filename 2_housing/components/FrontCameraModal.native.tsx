// v3.391 [FaceCam] 얼굴 인증용 앱 안 전면 카메라(expo-camera).
//  · 갤럭시 기본 카메라 앱은 '전면으로 열기' 요청을 무시하고 마지막 렌즈(후면)로 열렸다 → 앱 안에서 전면 카메라를 직접 띄운다.
//  · 바깥 카메라 앱으로 나가지 않으니, 촬영 중 메모리 부족으로 MAIDOL 이 꺼져 결과를 잃는 일도 없다.
//  · expo-camera 가 없는 빌드면 isInAppCameraAvailable() = false → 호출부가 예전 시스템 카메라(expo-image-picker)로.
import { useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from './ui';
import { colors } from '../theme/colors';
import type { FrontCameraModalProps } from './FrontCameraModal';

let Cam: any = null;
try {
  Cam = require('expo-camera');
} catch {
  Cam = null;
}

export function isInAppCameraAvailable(): boolean {
  return !!Cam?.CameraView;
}

export default function FrontCameraModal({ visible, onCapture, onClose }: FrontCameraModalProps) {
  const insets = useSafeAreaInsets();
  const ref = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [taking, setTaking] = useState(false);
  const [failed, setFailed] = useState('');
  if (!visible || !Cam?.CameraView) return null;
  const CameraView = Cam.CameraView;

  const shoot = async () => {
    if (!ready || taking || !ref.current) return;
    setTaking(true);
    try {
      const pic = await ref.current.takePictureAsync({ quality: 0.85, exif: false });
      if (!pic?.uri) throw new Error('no photo');
      console.info('[FaceCam] 촬영 완료', { w: pic.width, h: pic.height });
      onCapture({ uri: pic.uri, width: pic.width, height: pic.height });
    } catch (err: any) {
      console.warn('[FaceCam] 촬영 실패', { message: err?.message });
      setFailed('사진을 찍지 못했어요. 다시 눌러 주세요.');
    } finally {
      setTaking(false);
    }
  };

  const close = () => { setReady(false); setFailed(''); onClose(); };

  return (
    <Modal visible animationType="slide" onRequestClose={close} statusBarTranslucent>
      <View style={styles.root}>
        <CameraView
          ref={ref}
          style={StyleSheet.absoluteFill}
          facing="front"
          mode="picture"
          onCameraReady={() => setReady(true)}
          onMountError={(e: any) => {
            console.warn('[FaceCam] 카메라 시작 실패', { message: e?.message });
            setFailed('카메라를 켜지 못했어요. 닫고 다시 시도해 주세요.');
          }}
        />
        <View pointerEvents="none" style={styles.guideWrap}>
          <View style={styles.guide} />
        </View>
        <View style={[styles.top, { paddingTop: insets.top + 12 }]}>
          <AppText style={styles.tip}>얼굴이 원 안에 들어오게 맞춘 뒤 촬영해 주세요</AppText>
          {failed ? <AppText style={styles.err}>{failed}</AppText> : null}
        </View>
        <View style={[styles.bottom, { paddingBottom: insets.bottom + 24 }]}>
          <TouchableOpacity onPress={close} style={styles.side} accessibilityLabel="촬영 닫기">
            <AppText style={styles.sideText}>닫기</AppText>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => { void shoot(); }} disabled={!ready || taking} style={[styles.shutter, (!ready || taking) && { opacity: 0.5 }]} accessibilityLabel="촬영">
            {taking || !ready ? <ActivityIndicator color={colors.accent.primary} /> : <View style={styles.shutterInner} />}
          </TouchableOpacity>
          <View style={styles.side} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  guideWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  guide: { width: 240, height: 310, borderRadius: 155, borderWidth: 3, borderColor: 'rgba(255,255,255,0.85)' },
  top: { position: 'absolute', left: 0, right: 0, top: 0, alignItems: 'center', paddingHorizontal: 20, gap: 6 },
  tip: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center', textShadowColor: 'rgba(0,0,0,0.6)', textShadowRadius: 4 },
  err: { color: '#fca5a5', fontSize: 13, textAlign: 'center' },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 32 },
  side: { width: 64, alignItems: 'center' },
  sideText: { color: '#fff', fontSize: 15 },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
});
