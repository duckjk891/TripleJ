// v3.352 [AccountMerge] 1인 1계정 통합 화면 — 본인확인에서 같은 분 명의의 다른 계정이 발견됐을 때.
// 사과 문구 → 두 계정 카드(로그인 방식·닉네임·가입일·아티스트·곡·별) → [이 계정을 남길게요] / [내 계정이 아니에요]
// → 확인("되돌릴 수 없어요") → 합치기. 남긴 계정 토큰으로 바꿔 끼우고(/auth/me) 안내. App 루트에 1개.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';
import { useAccountMergeStore, loginMethodLabel, blockedReasonText } from '../../utils/accountMerge';
import { confirmMerge, declineMerge, getMergePreview, getMergeStatus, type MergeAccount, type MergePreview } from '../../services/accountMergeService';
import { useAuthStore } from '../../stores/authStore';
import { showAlert } from '../../utils/appAlert';
import { friendlyErrorMessage } from '../../utils/friendlyError';
import AppDialogHost from '../AppDialogHost';
import { useModalTurn } from '../../utils/modalTurn';

const POLL_MS = 3000;
const POLL_MAX_MS = 3 * 60 * 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} 가입`;
}

export default function AccountMergeHost() {
  const rid = useAccountMergeStore((s) => s.rid);
  const finish = useAccountMergeStore((s) => s.finish);
  const insets = useSafeAreaInsets();
  const [preview, setPreview] = useState<MergePreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPreview(null);
    if (!rid) return;
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const p = await getMergePreview(rid);
        console.info('[AccountMerge] preview', { n: p.accounts?.length, blocked: p.blocked_reason });
        if (alive) setPreview(p);
      } catch (err: any) {
        console.error('[AccountMerge] preview 실패', { status: err?.response?.status, code: err?.response?.data?.code });
        if (!alive) return;
        showAlert('알림', err?.response?.status === 404
          ? '통합 요청이 만료됐거나 이미 처리됐어요. 다시 본인인증해 주세요.'
          : friendlyErrorMessage(err));
        finish('closed');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [rid, finish]);

  // v3.384 [ModalTurn]: 가입 마무리 창 등이 내려간 뒤(닫힘 애니메이션 끝) 띄운다 — iOS 는 창 두 개를 겹쳐 띄우지 못한다
  const shown = useModalTurn('account-merge', !!rid, 6, 15000);
  if (!rid || !shown) return null;

  const swapTo = async (token: string | undefined) => {
    if (token) {
      const ok = await useAuthStore.getState().loginWithToken(token);
      console.info('[AccountMerge] 남긴 계정으로 세션 교체', { ok });
    }
  };

  const doMerge = async (keep: MergeAccount) => {
    setBusy(true);
    try {
      let r = await confirmMerge(rid, keep.id);
      const deadline = Date.now() + POLL_MAX_MS;
      while (r.status === 'running' && Date.now() < deadline) {
        await sleep(POLL_MS);
        r = await getMergeStatus(rid);
      }
      console.info('[AccountMerge] confirm 결과', { status: r.status });
      if (r.status === 'merged') {
        await swapTo(r.token);
        finish('merged');
        showAlert('계정을 하나로 합쳤어요', `「${keep.nickname}」 계정으로 합쳤어요. 아티스트·곡·피드·스타를 모두 옮겼어요.\n다른 계정으로 로그인해도 이 계정으로 들어와요.`);
      } else if (r.status === 'running') {
        finish('closed');
        showAlert('알림', '계정을 합치는 중이에요. 잠시 후 앱을 다시 열어 주세요.');
      } else {
        finish('closed');
        showAlert('알림', '계정을 합치지 못했어요. 잠시 후 다시 본인인증해 주세요.');
      }
    } catch (err: any) {
      const data = err?.response?.data || {};
      console.error('[AccountMerge] confirm 실패', { status: err?.response?.status, code: data.code, blocked: data.blocked_reason });
      const msg = blockedReasonText(data.blocked_reason) || friendlyErrorMessage(err);
      showAlert('알림', msg);
      if (data.blocked_reason) finish('closed');
    } finally {
      setBusy(false);
    }
  };

  const askKeep = (keep: MergeAccount) => {
    showAlert(
      '이 계정으로 합칠까요?',
      `「${keep.nickname}」 계정을 남겨요.\n남기지 않는 계정의 아티스트·곡·피드·스타는 모두 옮겨지고, 그 계정의 로그인은 남기는 계정으로 연결됩니다.\n되돌릴 수 없어요.`,
      [{ text: '취소', style: 'cancel' }, { text: '합치기', onPress: () => { void doMerge(keep); } }],
    );
  };

  const notMine = () => {
    showAlert(
      '내 계정이 아니에요',
      '계정을 합치지 않고, 이번 본인인증도 반영하지 않아요.\n가족 휴대폰으로 인증하셨다면 본인 명의 휴대폰으로 다시 인증하거나 고객센터(maidol_official@lotusai.co.kr)로 문의해 주세요.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '합치지 않기',
          onPress: async () => {
            setBusy(true);
            try {
              await declineMerge(rid);
              finish('declined');
            } catch (err: any) {
              console.error('[AccountMerge] decline 실패', { status: err?.response?.status, code: err?.response?.data?.code });
              showAlert('알림', err?.response?.data?.code === 'merge_started' ? '이미 계정을 합치는 중이에요.' : friendlyErrorMessage(err));
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  };

  const blocked = blockedReasonText(preview?.blocked_reason);

  return (
    <Modal visible animationType="slide" onRequestClose={() => {}}>
      <ScrollView style={styles.screen} contentContainerStyle={{ paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl, paddingHorizontal: spacing.lg }}>
        <AppText variant="title2">같은 분의 계정이 있어요</AppText>
        <AppText variant="footnote" tone="secondary" style={{ marginTop: spacing.sm, lineHeight: 20 }}>
          초기에는 1인 1계정 정책이 없어 혼선을 드려 죄송합니다. 같은 분 명의의 계정이 있어 하나로 합쳐 드려요.{'\n'}
          남길 계정을 골라 주세요. 다른 계정의 아티스트·곡·피드·스타는 모두 남길 계정으로 옮겨져요.
        </AppText>

        {loading || !preview ? (
          <ActivityIndicator color={colors.accent.primary} style={{ marginTop: spacing.xxl }} />
        ) : (
          <View style={{ marginTop: spacing.lg, gap: spacing.md }}>
            {blocked ? (
              <View style={styles.blocked}><AppText variant="footnote">{blocked}</AppText></View>
            ) : null}
            {preview.accounts.map((a) => (
              <View key={a.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <AppText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>{a.nickname}</AppText>
                  {a.is_current ? <View style={styles.chip}><AppText variant="caption" tone="accent">지금 로그인한 계정</AppText></View> : null}
                </View>
                <AppText variant="caption" tone="secondary" style={{ marginTop: 4 }}>
                  {a.login_methods.map(loginMethodLabel).join('·') || '로그인 방식 없음'}{a.email_masked ? ` · ${a.email_masked}` : ''}
                </AppText>
                <AppText variant="caption" tone="muted" style={{ marginTop: 2 }}>{fmtDate(a.created_at)}</AppText>
                <View style={styles.stats}>
                  <AppText variant="footnote">아티스트 {a.artists}</AppText>
                  <AppText variant="footnote">곡 {a.tracks}</AppText>
                  {a.feeds != null ? <AppText variant="footnote">피드 {a.feeds}</AppText> : null}
                  <AppText variant="footnote">⭐ {a.stars}</AppText>
                </View>
                <TouchableOpacity
                  style={[styles.primary, (busy || !!blocked) && styles.disabled]}
                  disabled={busy || !!blocked}
                  onPress={() => askKeep(a)}
                  accessibilityLabel={`${a.nickname} 계정을 남기기`}
                >
                  {busy ? <ActivityIndicator color="#fff" /> : <AppText style={styles.primaryText}>이 계정을 남길게요</AppText>}
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <TouchableOpacity style={styles.secondary} onPress={notMine} disabled={busy} accessibilityLabel="내 계정이 아니에요">
          <AppText variant="footnote" tone="secondary">내 계정이 아니에요</AppText>
        </TouchableOpacity>
        {blocked ? (
          <TouchableOpacity style={styles.secondaryTight} onPress={() => finish('closed')} disabled={busy}>
            <AppText variant="footnote" tone="muted">닫기</AppText>
          </TouchableOpacity>
        ) : null}
      </ScrollView>
      {/* v3.384: 합치기 확인 등 다이얼로그는 이 창 안에서(iOS) */}
      <AppDialogHost nestedIn="account-merge" />
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg.deepest },
  card: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  chip: { paddingHorizontal: spacing.sm, paddingVertical: 2, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.accent.primary },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.md, marginBottom: spacing.md },
  blocked: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.bg.surface2 },
  primary: { backgroundColor: colors.accent.primary, borderRadius: radius.md, paddingVertical: 13, alignItems: 'center' },
  primaryText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.5 },
  secondary: { alignItems: 'center', paddingVertical: spacing.lg, marginTop: spacing.md },
  secondaryTight: { alignItems: 'center', paddingBottom: spacing.lg },
});
