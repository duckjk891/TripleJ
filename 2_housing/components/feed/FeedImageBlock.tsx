// [FeedImageBlock] v3.111 피드 이미지 블록 렌더 — 가로폭 맞춤·비율 유지(getSize),
// 탭 시 크게 보기 모달(CoverLibrary 뷰어 관행: 반투명 백드롭 + contain + 닫기).
// 계약: 백엔드 image 블록 { type:'image', object_name, image_url } — image_url 은
// proxy 모드면 상대경로(/api/upload/cover-preview/..), presign 모드면 절대 URL.
import { useEffect, useState } from 'react';
import { View, Image, Modal, TouchableOpacity, StyleSheet } from 'react-native';
import { AppText } from '../ui';
import { BACKEND_BASE_URL } from '../../services/api';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';

/** image 블록 → 표시용 절대 URL (상대경로면 BACKEND_BASE_URL 접두). */
export const feedImageUri = (b: { image_url?: string | null; object_name?: string | null }): string | null => {
  const u = b?.image_url;
  if (u) return u.startsWith('http') ? u : `${BACKEND_BASE_URL}${u}`;
  if (b?.object_name) return `${BACKEND_BASE_URL}/api/upload/cover-preview/${b.object_name}`;
  return null;
};

interface Props {
  uri: string;
}

export default function FeedImageBlock({ uri }: Props) {
  // width/height 비율 — 로드 전 1:1, 극단 비율은 클램프(세로로 무한히 길어지는 것 방지)
  const [ratio, setRatio] = useState(1);
  const [viewerOpen, setViewerOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    Image.getSize(
      uri,
      (w, h) => {
        if (alive && w > 0 && h > 0) setRatio(Math.min(Math.max(w / h, 0.6), 3));
      },
      (err: any) => {
        if (__DEV__) console.info('[FeedImageBlock] getSize 실패', { message: err?.message });
      },
    );
    return () => { alive = false; };
  }, [uri]);

  return (
    <View>
      <TouchableOpacity activeOpacity={0.85} onPress={() => setViewerOpen(true)} accessibilityLabel="이미지 크게 보기">
        <Image source={{ uri }} style={[styles.image, { aspectRatio: ratio }]} resizeMode="cover" />
      </TouchableOpacity>

      {/* 크게 보기 — 앱 내 전체 화면 모달 (CoverLibraryScreen 뷰어와 동일 관행) */}
      <Modal visible={viewerOpen} transparent animationType="fade" onRequestClose={() => setViewerOpen(false)}>
        <TouchableOpacity style={styles.viewerBackdrop} activeOpacity={1} onPress={() => setViewerOpen(false)}>
          <Image source={{ uri }} style={styles.viewerImage} resizeMode="contain" />
          <TouchableOpacity style={styles.viewerCloseBtn} onPress={() => setViewerOpen(false)} accessibilityLabel="닫기">
            <AppText variant="footnote" style={styles.viewerCloseText}>닫기</AppText>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    width: '100%', marginTop: spacing.md, borderRadius: radius.lg,
    backgroundColor: colors.bg.surface2,
  },
  viewerBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  viewerImage: { width: '100%', height: '75%' },
  viewerCloseBtn: {
    marginTop: spacing.lg, backgroundColor: colors.bg.surface2,
    borderRadius: radius.lg, paddingHorizontal: 28, paddingVertical: 10,
  },
  viewerCloseText: { fontWeight: '600', color: colors.text.primary },
});
