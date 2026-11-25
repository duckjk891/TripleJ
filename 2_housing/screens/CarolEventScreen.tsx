// [CarolEventScreen] v3.438 크리스마스 캐롤 크루 이벤트(대표 11-24)
//  · 오늘(11-24) 이후 만든 캐롤을 업로드하면 MAIDOL 공식이 듣고 승인 → 곡마다 '스타룰렛' 1번(꽝 없음, 결과는 서버).
//  · v3.444 params.spin(푸시·알림함·배너·앱 안 팝업) → 룰렛을 바로 연다.
//  · 규칙·기간·확률·금액은 서버 값. 팝업은 전부 showAlert.
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import AppModal from '../components/AppModal';
import CarolHero from '../components/CarolHero'; // v3.440 반짝이는 트리·남은 시간
import CarolReel, { REEL_BG } from '../components/CarolReel';
import TrackRow from '../components/TrackRow';
import { AppText, Button, EmptyState, ScreenLayout } from '../components/ui';
import { colors } from '../theme/colors';
import { radius, spacing } from '../theme/spacing';
import { CURRENCY, CURRENCY_ICON } from '../constants/currency';
import { useAuthStore } from '../stores/authStore';
import { useCarolStore } from '../stores/carolStore';
import { usePlayerStore } from '../stores/playerStore';
import { usePointsStore } from '../stores/pointsStore';
import {
  cancelCarol, carolErrorCode, carolErrorMessage, spinCarol, submitCarol, type CarolSubmission,
} from '../services/carolService';
import { showAlert } from '../utils/appAlert';
import { untilLabel } from '../utils/carolStop';
import { startIdentityVerify } from '../utils/identityVerify';
import { openLoginModal } from '../utils/loginModal';
import { useRootModalOpen, waitModalTurn } from '../utils/modalTurn';

function stateText(s: CarolSubmission): string {
  if (s.status === 'pending') return 'MAIDOL이 듣고 있어요';
  if (s.status === 'rejected') return `승인되지 않았어요 — ${s.reason || ''}`;
  if (s.spin === 'ready') return '승인됐어요! 스타룰렛을 돌려 보세요';
  return `승인됐어요 · ${CURRENCY_ICON}${s.amount ?? 0} 받음`;
}

export default function CarolEventScreen() {
  const navigation = useNavigation<any>();
  const user = useAuthStore((s) => s.user);
  const uid = user?.id ? String(user.id) : null;
  const status = useCarolStore((s) => s.status);
  const load = useCarolStore((s) => s.load);
  const playerTrack = usePlayerStore((s) => s.track);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState('');
  const [pickOpen, setPickOpen] = useState(false);
  const [wheelSub, setWheelSub] = useState<CarolSubmission | null>(null);
  const [result, setResult] = useState<{ amount: number; balance: number } | null>(null);
  const [landed, setLanded] = useState(false);
  const [running, setRunning] = useState(false);

  const refresh = useCallback(async () => {
    try {
      await load(uid, true);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [load, uid]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  // v3.444 룰렛 바로 열기 — 서버에서 새로 받은 상태로 판단한다. 로그인 복원 전이면 기다렸다가 연다.
  const route = useRoute<any>();
  const spinParam: string | undefined = route.params?.spin;
  const focused = useRef(false);
  useFocusEffect(useCallback(() => { focused.current = true; return () => { focused.current = false; }; }, []));
  useRootModalOpen('carol-reel', Platform.OS !== 'ios' && !!wheelSub); // 룰렛이 떠 있는 동안 자동 팝업은 기다린다(아이폰은 AppModal 이 한다)
  useEffect(() => {
    if (!spinParam || !uid) return undefined;
    let alive = true;
    void (async () => {
      await refresh();
      if (!alive) return;
      const list = (useCarolStore.getState().status?.submissions ?? []).filter((s) => s.spin === 'ready');
      const hit = list.find((s) => s.id === spinParam) ?? (spinParam === 'any' ? list[0] : undefined);
      console.info('[Carol] 룰렛 바로 열기', { found: !!hit });
      navigation.setParams({ spin: undefined });
      if (!hit) return;
      await waitModalTurn('carol-spin', 2).promise; // 앱을 막 열었을 때 출석 팝업 등과 겹치지 않게
      if (focused.current) setWheelSub((cur) => cur ?? hit);
    })();
    return () => { alive = false; };
  }, [spinParam, uid, refresh, navigation]);

  const goStudio = () => {
    setPickOpen(false);
    navigation.navigate('MainTabs', { screen: 'Studio' });
  };

  const askIdentity = () => {
    showAlert('본인확인이 필요해요', '한 사람이 여러 계정으로 참여하지 않도록 본인확인을 마친 회원만 캐롤을 업로드할 수 있어요.', [
      { text: '나중에', style: 'cancel' },
      { text: '본인확인하기', onPress: () => { void startIdentityVerify('carol').then(refresh); } },
    ]);
  };

  const openPick = () => {
    if (!user) { openLoginModal({ reason: 'carol_event', afterLogin: () => { void refresh(); } }); return; }
    if (status?.identity_ok === false) {
      if (status.child) showAlert('보호자 동의가 필요해요', '보호자 동의를 마치면 캐롤을 업로드할 수 있어요.');
      else askIdentity();
      return;
    }
    setPickOpen(true);
  };

  const submit = async (trackId: string) => {
    if (busy) return;
    setBusy(trackId);
    try {
      await submitCarol(trackId);
      setPickOpen(false);
      await refresh();
      showAlert('캐롤을 업로드했어요', `MAIDOL이 들어 보고 알려 드릴게요.${status?.club ? `\n「${status.club.name}」 멤버로 함께해요.` : ''}`);
    } catch (err: any) {
      if (carolErrorCode(err) === 'identity_required') { setPickOpen(false); askIdentity(); } else showAlert('알림', carolErrorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const cancel = (s: CarolSubmission) => {
    showAlert('업로드를 취소할까요?', `「${s.title || '내 곡'}」 이벤트 업로드를 취소해요. 곡은 그대로 남아요.`, [
      { text: '닫기', style: 'cancel' },
      {
        text: '업로드 취소', style: 'destructive',
        onPress: async () => {
          try { await cancelCarol(s.id); } catch (err: any) { showAlert('알림', carolErrorMessage(err)); }
          await refresh();
        },
      },
    ]);
  };

  const spin = async () => {
    if (!wheelSub || busy || result) return;
    setBusy('spin');
    try {
      setResult(await spinCarol(wheelSub.id));
    } catch (err: any) {
      const code = carolErrorCode(err);
      showAlert('알림', carolErrorMessage(err));
      if (code !== 'pay_failed') closeWheel();
    } finally {
      setBusy('');
    }
  };

  const closeWheel = () => {
    if (result) usePointsStore.getState().setBalance(result.balance);
    setWheelSub(null);
    setResult(null);
    setLanded(false);
    setRunning(false);
    void refresh();
  };

  if (!status) {
    return (
      <ScreenLayout>
        {failed ? (
          <EmptyState
            icon={<Feather name="wifi-off" size={40} color={colors.text.muted} />}
            title="이벤트를 불러오지 못했어요"
            action={<Button label="다시 시도" variant="tonal" onPress={refresh} />}
          />
        ) : <ActivityIndicator color={colors.accent.primary} style={{ marginTop: spacing.xxl }} />}
      </ScreenLayout>
    );
  }
  if (!status.active) {
    return (
      <ScreenLayout>
        <EmptyState icon={<Feather name="gift" size={40} color={colors.text.muted} />} title="지금은 진행 중인 이벤트가 없어요" />
      </ScreenLayout>
    );
  }

  const amounts = status.wheel.map((w) => w.amount);
  return (
    <ScreenLayout>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: playerTrack ? 140 : 80, gap: spacing.lg }}>
        <CarolHero
          title={status.title}
          subtitle={status.child
            ? `새로 만든 캐롤이 승인되면 ${CURRENCY_ICON}${status.child_reward}을 드려요`
            : `캐롤이 승인될 때마다 스타룰렛! 꽝 없이 ${CURRENCY}를 받아요`}
          until={status.submit_open ? status.submit_until : status.spin_until}
          untilName={status.submit_open ? '업로드 마감' : '스타룰렛 마감'}
          onOver={refresh}
        />

        <View style={styles.card}>
          <AppText variant="subtitle">이렇게 참여해요</AppText>
          <View style={styles.steps}>
            <AppText variant="footnote">{`1. 작업실에서 캐롤을 만들어 발매해요`}</AppText>
            <AppText variant="footnote">{`2. 여기서 캐롤을 업로드하면 캐롤 크루에 함께 들어가요`}</AppText>
            <AppText variant="footnote">{`3. MAIDOL이 듣고 캐롤로 승인해요`}</AppText>
            <AppText variant="footnote">{status.child ? `4. 승인되면 ${CURRENCY_ICON}${status.child_reward}을 바로 받아요` : '4. 승인된 곡마다 스타룰렛을 한 번 돌려요'}</AppText>
          </View>
          {status.submit_open ? (
            <View style={{ gap: spacing.sm, marginTop: spacing.md }}>
              <Button label="캐롤 업로드" fullWidth onPress={openPick} />
              <Button label="캐롤 만들러 가기" variant="tonal" fullWidth onPress={goStudio} />
            </View>
          ) : (
            <AppText variant="footnote" tone="accent" style={{ marginTop: spacing.md }}>
              {`업로드는 끝났어요. 승인된 곡은 ${untilLabel(status.spin_until)}까지 스타룰렛을 돌릴 수 있어요.`}
            </AppText>
          )}
          {status.club ? (
            <Button
              label={`${status.club.name} 보러 가기`} variant="text" size="sm"
              onPress={() => navigation.navigate('MainTabs', { screen: 'ClubHome', params: { clubId: status.club!.id, name: status.club!.name, initialTab: 'playlists' } })}
            />
          ) : null}
        </View>

        {user ? (
          <View style={styles.card}>
            <AppText variant="subtitle">내가 업로드한 캐롤</AppText>
            {status.submissions.length === 0 ? (
              <AppText variant="footnote" tone="muted" style={{ marginTop: spacing.sm }}>아직 업로드한 캐롤이 없어요.</AppText>
            ) : status.submissions.map((s) => (
              <View key={s.id} style={styles.subRow}>
                <View style={{ flex: 1 }}>
                  <AppText variant="bodyStrong" numberOfLines={1}>{s.title || '내 곡'}</AppText>
                  <AppText variant="caption" tone={s.spin === 'ready' ? 'accent' : 'secondary'}>{stateText(s)}</AppText>
                </View>
                {s.spin === 'ready' ? <Button label="돌리기" size="sm" onPress={() => setWheelSub(s)} /> : null}
                {s.status === 'pending' ? <Button label="취소" size="sm" variant="text" onPress={() => cancel(s)} /> : null}
              </View>
            ))}
          </View>
        ) : null}

        <View style={styles.card}>
          <AppText variant="subtitle">꼭 읽어 주세요</AppText>
          <View style={styles.steps}>
            <AppText variant="caption" tone="secondary">{`· 11월 24일부터 MAIDOL에서 새로 작곡한 ${status.min_seconds}초 이상 공개곡만 업로드할 수 있어요. 직접 올린 음원과 Inst. 버전은 안 돼요.`}</AppText>
            <AppText variant="caption" tone="secondary">· 크리스마스나 연말 분위기가 담긴 새 곡이어야 해요. 기존 캐롤의 멜로디나 가사를 쓴 곡은 승인되지 않아요.</AppText>
            <AppText variant="caption" tone="secondary">{`· 한 번 작곡해 나온 곡(A·B)은 하나만, 하루에 ${status.daily_limit}곡까지 업로드할 수 있어요.`}</AppText>
            <AppText variant="caption" tone="secondary">· 본인확인을 마친 회원만 참여할 수 있고, 만 14세 미만은 보호자 동의가 있어야 해요.</AppText>
            {status.child ? null : (
              <>
                <AppText variant="caption" tone="secondary">{`· 만 14세 미만 회원은 스타룰렛 대신 승인되면 ${CURRENCY_ICON}${status.child_reward}을 바로 받아요.`}</AppText>
                <AppText variant="caption" tone="secondary">{`· 스타룰렛 확률: ${status.wheel.map((w) => `${CURRENCY_ICON}${w.amount} ${w.percent}%`).join(' · ')}. 누르는 순간과 상관없이 이 확률로 정해져요.`}</AppText>
              </>
            )}
            <AppText variant="caption" tone="secondary">{`· 업로드는 ${untilLabel(status.submit_until)}까지, 스타룰렛은 ${untilLabel(status.spin_until)}까지예요. 준비한 ${CURRENCY}가 모두 나가면 업로드를 일찍 마감할 수 있어요.`}</AppText>
            <AppText variant="caption" tone="secondary">{`· ${CURRENCY}는 앱 안에서만 쓸 수 있고 돈으로 바꿀 수 없어요. Apple과 Google은 이 이벤트와 관계가 없어요.`}</AppText>
          </View>
        </View>
      </ScrollView>

      <AppModal visible={pickOpen} transparent animationType="fade" onRequestClose={() => setPickOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <AppText variant="title3">내가 만든 캐롤 고르기</AppText>
            {status.eligible.length === 0 ? (
              <View style={{ marginTop: spacing.md, gap: spacing.md }}>
                <AppText variant="footnote" tone="secondary">업로드할 수 있는 곡이 없어요. 11월 24일부터 새로 만든 공개곡만 업로드할 수 있어요.</AppText>
                <Button label="캐롤 만들러 가기" fullWidth onPress={goStudio} />
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 360, marginTop: spacing.md }}>
                {status.eligible.map((t) => (
                  <View key={String(t.id)} style={styles.pickRow}>
                    <View style={{ flex: 1 }}><TrackRow track={{ ...t, id: String(t.id) }} hideAgency onPress={() => submit(String(t.id))} /></View>
                    <Button label="업로드" size="sm" loading={busy === String(t.id)} disabled={!!busy} onPress={() => submit(String(t.id))} />
                  </View>
                ))}
              </ScrollView>
            )}
            <Button label="닫기" variant="text" onPress={() => setPickOpen(false)} />
          </View>
        </View>
      </AppModal>

      <AppModal visible={!!wheelSub} transparent animationType="fade" onRequestClose={() => { if (!result || landed) closeWheel(); }}>
        <View style={styles.backdrop}>
          <View style={styles.reelCard}>
            <View style={styles.reelHead}>
              <AppText variant="title3">스타룰렛</AppText>
              <AppText variant="footnote" tone="secondary" numberOfLines={1}>{wheelSub?.title || '내 캐롤'}</AppText>
            </View>
            <CarolReel amounts={amounts} running={running} result={result?.amount ?? null} onDone={() => setLanded(true)} />
            <View style={styles.reelFoot}>
            <View style={styles.reelMsg}>
              {landed && result ? (
                <AppText variant="title3">{`${CURRENCY_ICON}${result.amount} 받았어요!`}</AppText>
              ) : (
                <AppText variant="footnote" tone="secondary">{result ? '두근두근…' : running ? '지금이다 싶을 때 스톱!' : '시작을 누르면 굴러가요'}</AppText>
              )}
            </View>
            {landed ? (
              <Button label="확인" fullWidth onPress={closeWheel} />
            ) : (
              <Button
                label={running ? '스톱!' : '시작'}
                size="lg"
                fullWidth
                disabled={!!busy || !!result}
                onPress={running ? spin : () => setRunning(true)}
              />
            )}
            {result ? null : <Button label="나중에" variant="text" disabled={!!busy} onPress={closeWheel} />}
            </View>
          </View>
        </View>
      </AppModal>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle,
    padding: spacing.lg,
  },
  steps: { gap: spacing.xs, marginTop: spacing.md },
  subRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border.subtle, marginTop: spacing.sm,
  },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: spacing.lg },
  sheet: {
    backgroundColor: colors.bg.surface1, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs,
    width: '100%', maxWidth: 420, alignSelf: 'center',
  },
  reelCard: {
    width: '100%', maxWidth: 380, alignSelf: 'center', borderRadius: 28, overflow: 'hidden', backgroundColor: REEL_BG,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
  },
  reelHead: { alignItems: 'center', gap: 4, paddingTop: 22, paddingBottom: 14, paddingHorizontal: 24, backgroundColor: '#1d1147' },
  reelFoot: { paddingHorizontal: 24, paddingBottom: 20, gap: 6 },
  reelMsg: { alignItems: 'center', justifyContent: 'center', minHeight: 52 },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
