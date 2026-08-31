// [TrackUpload] v3.100(A-10): 직접 음원 파일 업로드 — MAIDOL UploadPage.jsx(직접 파일 분기) 이식.
// 흐름: 오디오 선택(클라 선검증: 확장자/크기) → 메타 입력(제목 필수·장르·무드·태그·가사)
//   → 커버 이미지 선택(선택 — 미선택 시 서버 cover_image_url=None 기본) → 저작권 확인(필수)
//   → POST /tracks/upload(진행률) → (커버 있으면) POST /upload/image type=cover → 완료 팝업.
// 계약/제한값은 services/trackService.ts 헤더 주석 참조(실서버 openapi 실측 + tracks.py:1238).
import { useState, useCallback } from 'react';
import {
  View,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  Image,
  StyleSheet,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as DocumentPicker from 'expo-document-picker';
import { Feather } from '@expo/vector-icons';
import { showAlert } from '../utils/appAlert';
import api from '../services/api';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Button } from '../components/ui';
import {
  uploadTrackFile,
  uploadTrackCover,
  fileExt,
  AUDIO_ALLOWED_EXTS,
  AUDIO_MAX_SIZE_MB,
  COVER_ALLOWED_EXTS,
  COVER_MAX_SIZE_MB,
  PickedFile,
} from '../services/trackService';
// v3.104(B-5): 커버 보관함에서 선택 — 파일 선택과 병행(둘 중 하나만, cover_object_name form 필드로 발매)
import { useCoverLibraryStore, PickedCover } from '../stores/coverLibraryStore';

// MAIDOL UploadPage.jsx:10-11 폼 선택지 관행
const GENRES = ['발라드', '댄스', '힙합', 'R&B', '인디', '록', 'Electronic', 'Ambient', 'Lo-fi', 'Cinematic', '기타'];
const AI_TOOLS = ['Suno', 'Udio', 'AIVA', 'Stable Audio', 'MusicGen (Meta)', '직접 제작', '기타'];

function formatSize(bytes?: number): string {
  if (!bytes && bytes !== 0) return '';
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export default function TrackUploadScreen({ navigation }: any) {
  const [audioFile, setAudioFile] = useState<PickedFile | null>(null);
  const [coverFile, setCoverFile] = useState<PickedFile | null>(null);
  // v3.104(B-5): 커버 보관함 선택 결과 — coverFile과 상호 배타(둘 중 하나만)
  const [libraryCover, setLibraryCover] = useState<PickedCover | null>(null);
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [aiTool, setAiTool] = useState('');
  const [mood, setMood] = useState('');
  const [tags, setTags] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);

  // v3.104(B-5): 커버 보관함 선택 모드에서 돌아왔을 때 결과 소비 (store에 쓰고 goBack 관행)
  useFocusEffect(
    useCallback(() => {
      const picked = useCoverLibraryStore.getState().pickedCover;
      if (picked) {
        console.info('[TrackUpload] 보관함 커버 선택됨', { objectName: picked.objectName });
        setLibraryCover(picked);
        setCoverFile(null); // 파일 선택과 상호 배타
        useCoverLibraryStore.getState().setPickedCover(null); // 유령 선택 방지
      }
    }, [])
  );

  // 오디오 파일 선택 — 서버 제한(tracks.py: 확장자 5종·50MB) 클라 선검증
  const handlePickAudio = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*' });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const ext = fileExt(asset.name || '');
      if (!AUDIO_ALLOWED_EXTS.includes(ext)) {
        console.info('[TrackUpload] 오디오 확장자 거부', { ext });
        showAlert('파일 형식', `${AUDIO_ALLOWED_EXTS.map((e) => '.' + e).join(', ')} 파일만 업로드할 수 있어요.`);
        return;
      }
      if (asset.size != null && asset.size > AUDIO_MAX_SIZE_MB * 1024 * 1024) {
        console.info('[TrackUpload] 오디오 크기 거부', { size: asset.size });
        showAlert('파일 크기', `음원 파일은 ${AUDIO_MAX_SIZE_MB}MB 이하여야 해요. (선택한 파일: ${formatSize(asset.size)})`);
        return;
      }
      setAudioFile({ fileUri: asset.uri, fileName: asset.name, mimeType: asset.mimeType, size: asset.size });
      if (!title.trim()) {
        // 파일명(확장자 제외)으로 제목 초기 제안
        setTitle(asset.name.replace(/\.[^.]+$/, ''));
      }
    } catch (err: any) {
      console.error('[TrackUpload] 오디오 선택 실패', { message: err?.message });
      showAlert('오류', '파일 선택에 실패했습니다.');
    }
  };

  // 커버 이미지 선택(선택사항) — expo-image-picker 미설치: DocumentPicker image/* 관행(SettingsScreen)
  const handlePickCover = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'image/*' });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const ext = fileExt(asset.name || '');
      if (!COVER_ALLOWED_EXTS.includes(ext)) {
        console.info('[TrackUpload] 커버 확장자 거부', { ext });
        showAlert('이미지 형식', `${COVER_ALLOWED_EXTS.map((e) => '.' + e).join(', ')} 이미지만 사용할 수 있어요.`);
        return;
      }
      if (asset.size != null && asset.size > COVER_MAX_SIZE_MB * 1024 * 1024) {
        console.info('[TrackUpload] 커버 크기 거부', { size: asset.size });
        showAlert('이미지 크기', `커버 이미지는 ${COVER_MAX_SIZE_MB}MB 이하여야 해요.`);
        return;
      }
      setCoverFile({ fileUri: asset.uri, fileName: asset.name, mimeType: asset.mimeType, size: asset.size });
      setLibraryCover(null); // v3.104(B-5): 보관함 선택과 상호 배타
    } catch (err: any) {
      console.error('[TrackUpload] 커버 선택 실패', { message: err?.message });
      showAlert('오류', '이미지 선택에 실패했습니다.');
    }
  };

  const canSubmit = !!audioFile && title.trim().length > 0 && !uploading;

  // 업로드 직전 저작권 확인(필수) — 이 확인 없이는 업로드 불가
  const handleSubmit = () => {
    if (!audioFile) { showAlert('음원 파일', '업로드할 음원 파일을 선택해주세요.'); return; }
    if (!title.trim()) { showAlert('곡 제목', '곡 제목을 입력해주세요.'); return; }
    showAlert(
      '저작권 확인',
      '본인이 권리를 보유한 음원만 업로드할 수 있어요.\n타인의 저작물을 무단 업로드하면 신고에 의해 블라인드·제재될 수 있어요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '동의하고 업로드', onPress: doUpload },
      ]
    );
  };

  const doUpload = async () => {
    if (!audioFile || uploading) return;
    setUploading(true);
    setProgress(0);
    try {
      // v3.102(B-4): 출처 기록 — 기본 아티스트 character_id(best-effort, 실패해도 발매 진행)
      let characterId: string | undefined;
      try {
        const res = await api.get('/character/me');
        const ch = res.data?.character;
        characterId = ch ? String(ch.character_id ?? ch.id ?? ch._id ?? '') || undefined : undefined;
      } catch (err: any) {
        console.warn('[TrackUpload] /character/me 조회 실패 — character_id 생략', { status: err?.response?.status });
      }
      const track = await uploadTrackFile(
        {
          file: audioFile,
          title,
          genre: genre || undefined,
          mood,
          tags,
          lyrics,
          aiModel: aiTool || undefined,
          isPublic,
          characterId,
          // v3.104(B-5): 보관함 커버 재사용 — form 필드로 발매와 동시에 부착(별도 /upload/image 불필요)
          coverObjectName: libraryCover?.objectName,
        },
        setProgress
      );

      // 커버는 발매 후 부착(서버가 cover_image_url 갱신) — 실패해도 발매는 유지(best-effort)
      let coverFailed = false;
      if (coverFile && track?.id) {
        try {
          await uploadTrackCover(String(track.id), coverFile);
        } catch (err: any) {
          coverFailed = true;
          console.warn('[TrackUpload] 커버 업로드 실패(발매는 완료)', {
            status: err?.response?.status,
            error: err?.response?.data?.error,
          });
        }
      }

      const doneMsg = coverFailed
        ? '곡이 발매되었어요! (커버 이미지 반영은 실패 — 보관함에서 다시 시도할 수 있어요)'
        : '곡이 발매되었어요! 마이뮤직 보관함에서 확인할 수 있어요.';
      showAlert('발매 완료', doneMsg, [
        {
          text: '지금 듣기',
          onPress: () => {
            navigation.goBack();
            navigation.navigate('Player', { track });
          },
        },
        { text: '보관함으로', onPress: () => navigation.goBack() },
      ]);
    } catch (err: any) {
      const status = err?.response?.status;
      const serverMsg = err?.response?.data?.error;
      console.error('[TrackUpload] 업로드 실패', { status, error: serverMsg, message: err?.message });
      if (serverMsg) {
        // 서버 400: 형식/크기 등 검증 메시지 그대로 노출
        showAlert('업로드 실패', serverMsg);
      } else if (!err?.response) {
        showAlert('네트워크 오류', '연결이 불안정해서 업로드에 실패했어요. 네트워크 상태를 확인한 뒤 다시 시도해주세요.');
      } else {
        showAlert('업로드 실패', '업로드에 실패했습니다. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setUploading(false);
    }
  };

  const renderChips = (
    options: string[],
    selected: string,
    onSelect: (v: string) => void,
    labelPrefix: string
  ) => (
    <View style={styles.chipRow}>
      {options.map((opt) => {
        const active = selected === opt;
        return (
          <TouchableOpacity
            key={opt}
            style={[styles.chip, active && styles.chipActive]}
            onPress={() => onSelect(active ? '' : opt)}
            disabled={uploading}
            accessibilityLabel={`${labelPrefix} ${opt}`}
          >
            <AppText style={[styles.chipText, active && styles.chipTextActive]}>{opt}</AppText>
          </TouchableOpacity>
        );
      })}
    </View>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      {/* 오디오 파일 선택 */}
      <AppText variant="caption" tone="secondary">음원 파일 (필수)</AppText>
      {audioFile ? (
        <View style={styles.fileRow}>
          <Feather name="music" size={18} color={colors.accent.primary} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <AppText variant="callout" numberOfLines={1}>{audioFile.fileName}</AppText>
            {audioFile.size != null ? (
              <AppText variant="footnote" tone="muted">{formatSize(audioFile.size)}</AppText>
            ) : null}
          </View>
          <TouchableOpacity onPress={() => setAudioFile(null)} disabled={uploading} accessibilityLabel="음원 파일 제거">
            <Feather name="x" size={18} color={colors.text.muted} />
          </TouchableOpacity>
        </View>
      ) : (
        <TouchableOpacity style={styles.pickBtn} activeOpacity={0.8} onPress={handlePickAudio} accessibilityLabel="음원 파일 선택">
          <Feather name="upload-cloud" size={20} color={colors.accent.primary} />
          <AppText style={styles.pickBtnText}>음원 파일 선택</AppText>
          <AppText variant="footnote" tone="muted">
            {AUDIO_ALLOWED_EXTS.map((e) => '.' + e).join(' ')} · 최대 {AUDIO_MAX_SIZE_MB}MB
          </AppText>
        </TouchableOpacity>
      )}

      {/* 제목 */}
      <AppText variant="caption" tone="secondary" style={styles.label}>곡 제목 (필수)</AppText>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="곡 제목"
        placeholderTextColor={colors.text.muted}
        maxLength={200}
        editable={!uploading}
      />

      {/* 장르 */}
      <AppText variant="caption" tone="secondary" style={styles.label}>장르</AppText>
      {renderChips(GENRES, genre, setGenre, '장르')}

      {/* 제작 도구 */}
      <AppText variant="caption" tone="secondary" style={styles.label}>제작 도구</AppText>
      {renderChips(AI_TOOLS, aiTool, setAiTool, '제작 도구')}

      {/* 무드 */}
      <AppText variant="caption" tone="secondary" style={styles.label}>무드</AppText>
      <TextInput
        style={styles.input}
        value={mood}
        onChangeText={setMood}
        placeholder="예: 잔잔한, 몽환적인 (쉼표로 구분)"
        placeholderTextColor={colors.text.muted}
        maxLength={200}
        editable={!uploading}
      />

      {/* 태그 */}
      <AppText variant="caption" tone="secondary" style={styles.label}>태그</AppText>
      <TextInput
        style={styles.input}
        value={tags}
        onChangeText={setTags}
        placeholder="예: 새벽감성, 드라이브 (쉼표로 구분)"
        placeholderTextColor={colors.text.muted}
        maxLength={200}
        editable={!uploading}
      />

      {/* 가사 */}
      <AppText variant="caption" tone="secondary" style={styles.label}>가사</AppText>
      <TextInput
        style={[styles.input, styles.inputMulti]}
        value={lyrics}
        onChangeText={setLyrics}
        placeholder="가사 (선택)"
        placeholderTextColor={colors.text.muted}
        multiline
        editable={!uploading}
      />

      {/* 커버 이미지 (선택) — 파일 선택 또는 보관함에서 선택(v3.104 B-5, 상호 배타) */}
      <AppText variant="caption" tone="secondary" style={styles.label}>커버 이미지 (선택)</AppText>
      {coverFile ? (
        <View style={styles.fileRow}>
          <Image source={{ uri: coverFile.fileUri }} style={styles.coverPreview} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <AppText variant="callout" numberOfLines={1}>{coverFile.fileName}</AppText>
            {coverFile.size != null ? (
              <AppText variant="footnote" tone="muted">{formatSize(coverFile.size)}</AppText>
            ) : null}
          </View>
          <TouchableOpacity onPress={() => setCoverFile(null)} disabled={uploading} accessibilityLabel="커버 이미지 제거">
            <Feather name="x" size={18} color={colors.text.muted} />
          </TouchableOpacity>
        </View>
      ) : libraryCover ? (
        <View style={styles.fileRow}>
          <Image source={{ uri: libraryCover.imageUri }} style={styles.coverPreview} />
          <View style={{ flex: 1, marginLeft: spacing.sm }}>
            <AppText variant="callout" numberOfLines={1}>{libraryCover.title || '커버'}</AppText>
            <AppText variant="footnote" tone="muted">보관함에서 선택함</AppText>
          </View>
          <TouchableOpacity onPress={() => setLibraryCover(null)} disabled={uploading} accessibilityLabel="보관함 커버 제거">
            <Feather name="x" size={18} color={colors.text.muted} />
          </TouchableOpacity>
        </View>
      ) : (
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <TouchableOpacity style={[styles.pickBtn, { flex: 1 }]} activeOpacity={0.8} onPress={handlePickCover} accessibilityLabel="커버 이미지 선택">
            <Feather name="image" size={20} color={colors.accent.primary} />
            <AppText style={styles.pickBtnText}>파일 선택</AppText>
            <AppText variant="footnote" tone="muted" style={{ textAlign: 'center' }}>
              {COVER_ALLOWED_EXTS.map((e) => '.' + e).join(' ')}{'\n'}최대 {COVER_MAX_SIZE_MB}MB
            </AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.pickBtn, { flex: 1 }]}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('CoverLibrary', { select: true })}
            disabled={uploading}
            accessibilityLabel="보관함에서 선택"
          >
            <Feather name="folder" size={20} color={colors.accent.primary} />
            <AppText style={styles.pickBtnText}>보관함에서 선택</AppText>
            <AppText variant="footnote" tone="muted" style={{ textAlign: 'center' }}>
              생성해둔 커버 재사용{'\n'}없으면 기본 커버
            </AppText>
          </TouchableOpacity>
        </View>
      )}

      {/* 공개 여부 */}
      <View style={styles.switchRow}>
        <View style={{ flex: 1 }}>
          <AppText variant="callout">차트에 공개</AppText>
          <AppText variant="footnote" tone="muted">끄면 내 보관함에만 보관돼요. 나중에 차트에 올릴 수 있어요.</AppText>
        </View>
        <Switch
          value={isPublic}
          onValueChange={setIsPublic}
          disabled={uploading}
          trackColor={{ false: colors.bg.surface2, true: colors.accent.primary }}
          thumbColor="#fff"
        />
      </View>

      {/* 저작권 안내 */}
      <View style={styles.noticeCard}>
        <Feather name="alert-triangle" size={16} color={colors.accent.secondary} style={{ marginTop: 1 }} />
        <AppText variant="footnote" tone="secondary" style={{ flex: 1, marginLeft: spacing.sm }}>
          본인이 권리를 보유한 음원만 업로드할 수 있어요. 타인의 저작물을 무단 업로드하면 신고에 의해 블라인드·제재될 수 있어요.
        </AppText>
      </View>

      {/* 진행률 */}
      {uploading ? (
        <View style={styles.progressWrap}>
          <View style={styles.progressBarBg}>
            <View style={[styles.progressBarFill, { width: `${progress}%` }]} />
          </View>
          <AppText variant="footnote" tone="muted" style={{ marginTop: spacing.xs, textAlign: 'center' }}>
            {progress < 100 ? `업로드 중... ${progress}%` : '서버 처리 중...'}
          </AppText>
        </View>
      ) : null}

      <View style={{ marginTop: spacing.lg }}>
        <Button
          label={uploading ? '업로드 중...' : '발매하기'}
          loading={uploading}
          disabled={!canSubmit}
          fullWidth
          onPress={handleSubmit}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  content: { padding: spacing.xl, paddingBottom: 120 },
  label: { marginTop: spacing.lg },
  input: {
    backgroundColor: colors.bg.surface1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    color: colors.text.primary,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 14,
    marginTop: spacing.xs,
  },
  inputMulti: { minHeight: 96, textAlignVertical: 'top' },
  pickBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: spacing.lg,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderStyle: 'dashed' as any,
    borderRadius: radius.lg,
  },
  pickBtnText: { fontSize: 13, fontWeight: '700', color: colors.accent.primary },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  coverPreview: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.bg.surface2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs, marginTop: spacing.xs },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  chipActive: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  chipText: { fontSize: 12, color: colors.text.secondary },
  chipTextActive: { color: '#fff', fontWeight: '700' },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  noticeCard: {
    flexDirection: 'row',
    backgroundColor: colors.bg.surface1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  progressWrap: { marginTop: spacing.lg },
  progressBarBg: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.bg.surface2,
    overflow: 'hidden',
  },
  progressBarFill: { height: 6, borderRadius: 3, backgroundColor: colors.accent.primary },
});
