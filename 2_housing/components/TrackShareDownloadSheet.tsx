// [TrackShareDownloadSheet] 곡 공유/다운로드 선택지 시트 — MAIDOL TrackShareButton/TrackDownloadButton 이식.
// 공유:   YouTube 쇼츠 / 릴스 / 틱톡 (모두 세로 9:16 공유영상) + 링크 복사
// 다운로드: 일반 화질(16:9) / SNS용(9:16) / 카톡 프로필(15초) / 음원(mp3, 로그인 필요)
// 영상은 서버가 ffmpeg로 만들며 최초 1~2분 걸린다(캐시되면 즉시).
import { useState } from 'react';
import { Modal, View, TouchableOpacity, ActivityIndicator, StyleSheet, Platform, Linking } from 'react-native';
import { showAlert } from '../utils/appAlert';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import api, { BACKEND_BASE_URL } from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { AppText } from './ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';

export type SheetMode = 'share' | 'download';

interface Props {
  visible: boolean;
  mode: SheetMode;
  track: { id: string | number; title: string } | null;
  onClose: () => void;
}

// 영상 포맷 3종 — 서버 share-video API의 format 값과 1:1
const VIDEO_FORMATS = {
  wide: { label: '일반 화질 (가로 16:9)', icon: 'monitor' as const },
  sns: { label: 'SNS용 (세로 9:16)', icon: 'smartphone' as const },
  kakao: { label: '카톡 프로필 배경 (15초)', icon: 'message-circle' as const },
};

// 공유 대상별 폴백 업로드 페이지(모바일 공유 시트가 안 뜰 때)
const SNS_UPLOAD_URLS: Record<string, string> = {
  youtube: 'https://www.youtube.com/upload',
  reels: 'https://www.instagram.com/',
  tiktok: 'https://www.tiktok.com/upload',
};

export default function TrackShareDownloadSheet({ visible, mode, track, onClose }: Props) {
  const user = useAuthStore((s) => s.user);
  const [busy, setBusy] = useState<string | null>(null); // 진행 중 항목 key

  const trackId = track ? String(track.id) : '';

  // 공유영상 생성 → 파일 URL 확보 (최초 생성은 오래 걸려 timeout을 넉넉히)
  const buildShareVideo = async (format: 'sns' | 'wide' | 'kakao'): Promise<string | null> => {
    if (__DEV__) console.info('[TrackShareDownloadSheet] share-video 생성', { trackId, format });
    try {
      const res = await api.post(`/tracks/${trackId}/share-video`, null, { params: { format }, timeout: 300000 });
      const path = res.data?.video_url;
      if (!path) return null;
      // 서버가 준 경로(/api/...)를 절대 URL로
      return path.startsWith('http') ? path : `${BACKEND_BASE_URL}${path}`;
    } catch (err: any) {
      const status = err?.response?.status;
      console.error('[TrackShareDownloadSheet] share-video 실패', { trackId, format, status });
      showAlert('오류',
        status === 404 ? '공개된 곡만 공유할 수 있습니다.'
        : status === 400 ? '커버 이미지가 없어 공유 영상을 만들 수 없습니다.'
        : '영상 생성에 실패했습니다. 잠시 후 다시 시도해주세요.');
      return null;
    }
  };

  const handleShareSns = async (key: 'youtube' | 'reels' | 'tiktok') => {
    if (!track) return;
    setBusy(key);
    const url = await buildShareVideo('sns');
    setBusy(null);
    if (!url) return;
    onClose();
    // 생성된 영상을 열어 저장/공유 → 이어서 해당 SNS 업로드 페이지로 이동
    await Linking.openURL(url).catch((err) => console.error('[TrackShareDownloadSheet] 영상 열기 실패', { err }));
    const fallback = SNS_UPLOAD_URLS[key];
    if (fallback) Linking.openURL(fallback).catch(() => {});
    showAlert('공유 영상 준비 완료', '영상을 저장한 뒤 열린 페이지에서 업로드해주세요.');
  };

  const handleCopyLink = async () => {
    if (!track) return;
    const link = `${BACKEND_BASE_URL}/player?track=${trackId}`;
    try {
      await Clipboard.setStringAsync(link);
      onClose();
      showAlert('복사 완료', '링크가 복사되었습니다.');
    } catch (err: any) {
      console.error('[TrackShareDownloadSheet] 링크 복사 실패', { message: err?.message });
    }
  };

  // v3.48(B6): 네이티브는 기기에 내려받아 OS 공유/저장 시트로 — 브라우저 이탈 없이 저장 가능
  const saveToDevice = async (url: string, filename: string) => {
    if (Platform.OS === 'web') {
      await Linking.openURL(url).catch((err) => console.error('[TrackShareDownloadSheet] 다운로드 열기 실패', { err }));
      return;
    }
    try {
      const dest = `${FileSystem.cacheDirectory}${filename}`;
      if (__DEV__) console.info('[TrackShareDownloadSheet] 기기 저장 시작', { filename });
      const res = await FileSystem.downloadAsync(url, dest);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(res.uri);
      } else {
        showAlert('저장 완료', '파일이 저장되었습니다.');
      }
    } catch (err: any) {
      console.error('[TrackShareDownloadSheet] 기기 저장 실패', { message: err?.message });
      // 폴백: 브라우저 열기
      await Linking.openURL(url).catch(() => {});
    }
  };

  const handleDownloadVideo = async (format: 'sns' | 'wide' | 'kakao') => {
    if (!track) return;
    setBusy(format);
    const url = await buildShareVideo(format);
    setBusy(null);
    if (!url) return;
    onClose();
    await saveToDevice(url, `aidol_${format}.mp4`);
  };

  const handleDownloadMp3 = async () => {
    if (!track) return;
    if (!user) { onClose(); showAlert('로그인 필요', '음원 다운로드는 로그인 후 이용할 수 있어요.'); return; }
    setBusy('mp3');
    if (__DEV__) console.info('[TrackShareDownloadSheet] mp3 다운로드', { trackId });
    try {
      const { data } = await api.post(`/tracks/download/${trackId}`);
      const url = data?.download_url;
      if (!url) { showAlert('오류', '다운로드 링크를 가져오지 못했어요.'); return; }
      onClose();
      await saveToDevice(url, data?.filename || `${track.title}.mp3`);
    } catch (err: any) {
      console.error('[TrackShareDownloadSheet] mp3 다운로드 실패', { status: err?.response?.status });
      showAlert('오류', '다운로드에 실패했어요. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusy(null);
    }
  };

  const Item = ({ icon, label, hint, onPress, itemKey }: any) => (
    <TouchableOpacity style={styles.item} onPress={onPress} disabled={!!busy} accessibilityLabel={label}>
      <Feather name={icon} size={20} color={colors.text.secondary} />
      <View style={{ flex: 1 }}>
        <AppText variant="body">{label}</AppText>
        {hint ? <AppText variant="caption" tone="muted">{hint}</AppText> : null}
      </View>
      {busy === itemKey ? <ActivityIndicator size="small" color={colors.accent.primary} /> : null}
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={() => !busy && onClose()}>
        <TouchableOpacity style={styles.sheet} activeOpacity={1} onPress={() => {}}>
          <AppText variant="title3" style={styles.title}>
            {mode === 'share' ? 'SNS 공유' : '다운로드'}
          </AppText>
          {track ? <AppText variant="footnote" tone="secondary" numberOfLines={1} style={styles.sub}>{track.title}</AppText> : null}

          {mode === 'share' ? (
            <>
              <Item itemKey="youtube" icon="youtube" label="YouTube 쇼츠" hint="세로 9:16 공유영상" onPress={() => handleShareSns('youtube')} />
              <Item itemKey="reels" icon="instagram" label="릴스" hint="세로 9:16 공유영상" onPress={() => handleShareSns('reels')} />
              <Item itemKey="tiktok" icon="music" label="틱톡" hint="세로 9:16 공유영상" onPress={() => handleShareSns('tiktok')} />
              <Item itemKey="link" icon="link" label="링크 복사" onPress={handleCopyLink} />
            </>
          ) : (
            <>
              {(['wide', 'sns', 'kakao'] as const).map((f) => (
                <Item key={f} itemKey={f} icon={VIDEO_FORMATS[f].icon} label={VIDEO_FORMATS[f].label}
                  hint="영상 생성 — 최초 1~2분" onPress={() => handleDownloadVideo(f)} />
              ))}
              <Item itemKey="mp3" icon="music" label="음원만 (mp3)" hint={user ? undefined : '로그인 필요'} onPress={handleDownloadMp3} />
            </>
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg.surface1, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, padding: spacing.xl, paddingBottom: spacing.xxl ?? spacing.xl },
  title: { marginBottom: spacing.xs },
  sub: { marginBottom: spacing.md },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
});
