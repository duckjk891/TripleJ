// [ClubCreateScreen] v3.245 커뮤니티 Phase 1b — 클럽 개설(이름 ≤30 · 소개 ≤300, 글자수 카운터).
// 계약: POST /clubs → 201 {id,name,...}. 409 'club_limit'(계정당 1개)·'club_name_taken', 400 'word_filtered'.
// 성공 시 ClubHome(숨김 탭)으로 이동 — 탭은 스택이 아니라 개설 화면이 히스토리에 남지 않는다(replace 동등).
// v3.247 어린이: 개설 불가(서버 POST /clubs/ 403 child_restricted, feature:'club_create') —
// 정상 진입로(커뮤니티 CTA)는 안내로 대체됐고, 우회 진입 시 403 은 api 인터셉터가 서버 문구로 안내.
// 팝업은 전부 앱 내 다이얼로그(showAlert).
import { useState } from 'react';
import { View, ScrollView, TextInput, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Button } from '../components/ui';
import LoginPrompt from '../components/LoginPrompt';
import { showAlert } from '../utils/appAlert';
import { useAuthStore } from '../stores/authStore';
import { createClub, getClubErrorCode } from '../services/clubService';
import { getWordFilteredMessage } from '../utils/kidsMode';

const NAME_MAX = 30;
const DESC_MAX = 300;

export default function ClubCreateScreen() {
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      showAlert('알림', '클럽 이름을 입력해주세요.');
      return;
    }
    if (busy) return;
    setBusy(true);
    try {
      const club = await createClub(trimmedName, desc.trim());
      console.info('[Club] 개설 성공', { clubId: club.id });
      navigation.navigate('ClubHome', { clubId: club.id, name: club.name });
    } catch (err: any) {
      const code = getClubErrorCode(err);
      console.error('[Club] 개설 실패', { status: err?.response?.status, code });
      if (code === 'club_limit') {
        showAlert('알림', '클럽은 계정당 1개까지 만들 수 있어요.');
      } else if (code === 'club_name_taken') {
        showAlert('알림', '이미 있는 이름이에요. 다른 이름을 지어주세요.');
      } else {
        // 400 word_filtered — 서버 안내 문구(피드 작성 관행), 그 외(미배포 404 포함)는 공통 안내
        const wf = getWordFilteredMessage(err);
        if (wf) showAlert('알림', wf);
        else showAlert('오류', '클럽을 만들지 못했어요. 잠시 후 다시 시도해주세요.');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!user) {
    // 진입 경로(커뮤니티 CTA)가 이미 게이트하지만 직접 진입 방어
    return (
      <View style={[styles.container, styles.center]}>
        <LoginPrompt
          desc={'로그인하면 클럽을 만들고\n마음 맞는 사람들과 함께할 수 있어요'}
          onPress={() => navigation.navigate('Settings')}
        />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
        <View style={styles.labelRow}>
          <AppText variant="footnote" tone="secondary" style={styles.label}>클럽 이름</AppText>
          <AppText variant="caption" tone="muted">{`${name.length}/${NAME_MAX}`}</AppText>
        </View>
        <TextInput
          style={styles.nameInput}
          placeholder="예) 새벽 감성 발라드 클럽"
          placeholderTextColor={colors.text.muted}
          value={name}
          onChangeText={setName}
          maxLength={NAME_MAX}
          editable={!busy}
        />

        <View style={[styles.labelRow, { marginTop: spacing.xl }]}>
          <AppText variant="footnote" tone="secondary" style={styles.label}>소개</AppText>
          <AppText variant="caption" tone="muted">{`${desc.length}/${DESC_MAX}`}</AppText>
        </View>
        <TextInput
          style={styles.descInput}
          placeholder="어떤 음악을 함께 듣는 클럽인지 알려주세요. (선택)"
          placeholderTextColor={colors.text.muted}
          value={desc}
          onChangeText={setDesc}
          maxLength={DESC_MAX}
          multiline
          textAlignVertical="top"
          editable={!busy}
        />

        <AppText variant="caption" tone="muted" style={styles.hint}>
          클럽은 계정당 1개까지 만들 수 있어요. 가입한 멤버 누구나 게시판과 공유 플레이리스트를 함께 써요.
        </AppText>

        <View style={{ marginTop: spacing.xl }}>
          <Button label="만들기" fullWidth loading={busy} onPress={submit} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  center: { alignItems: 'center', justifyContent: 'center' },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  // 섹션 라벨 관행(footnote 12 + 700)
  label: { fontWeight: '700', letterSpacing: 0.3 },
  nameInput: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.md, padding: spacing.md,
    color: colors.text.primary, fontSize: 15,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  descInput: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.md, padding: spacing.md,
    color: colors.text.primary, fontSize: 14, lineHeight: 20, minHeight: 120,
    borderWidth: 1, borderColor: colors.border.subtle,
  },
  hint: { marginTop: spacing.lg, lineHeight: 16 },
});
