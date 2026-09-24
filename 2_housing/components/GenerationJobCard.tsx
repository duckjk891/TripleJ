import { useEffect, useState } from 'react';
import { StyleSheet, View, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { AppText } from './ui';
import { showAlert } from '../utils/appAlert';
import { BACKEND_BASE_URL } from '../services/api';
import { useUserArtistJobs, type TrackedJob } from '../stores/generationJobStore';
import {
  finalizeArtistJob,
  discardDoneJob,
  acknowledgeFailedJob,
  openJobViewer,
} from '../services/generationTracker';
import { colors } from '../theme/colors';

// ── v3.227 A-보완 보완1: 생성 job 공용 카드(MyArtists 상단·ArtistInput welcome) ─────────
// processing = "아티스트를 만드는 중이에요 · 경과 m분" → 탭하면 추적 뷰어(ArtistLoading {jobId})
// done       = "완성된 아티스트가 도착했어요" + 썸네일 → [아티스트로 저장](finalize) / [닫기](dismiss)
// failed     = "만들지 못했어요 — 사용된 별은 자동으로 환불돼요" → [확인](레코드 정리)
// 회수 목록은 기간 제한 없음(consume/dismiss 전까지 노출 — 사용자 결정 4).

function elapsedMinutes(job: TrackedJob, now: number): number {
  return Math.max(0, Math.floor((now - job.startedAt) / 60000));
}

function JobRow({ job, navigation, now }: { job: TrackedJob; navigation?: any; now: number }) {
  const [busy, setBusy] = useState(false);

  if (job.lastStatus === 'processing') {
    return (
      <TouchableOpacity
        style={styles.card}
        activeOpacity={0.85}
        onPress={() => openJobViewer(job.jobId, navigation)}
        accessibilityLabel="만드는 중인 아티스트 진행 상황 보기"
      >
        <View style={styles.spinnerBox}>
          <ActivityIndicator size="small" color={colors.accent.primary} />
        </View>
        <View style={styles.body}>
          <AppText style={styles.title}>
            {job.mode === 'outfit' ? '옷을 입히는 중이에요' : '아티스트를 만드는 중이에요'} · 경과 {elapsedMinutes(job, now)}분
          </AppText>
          <AppText style={styles.desc}>나가 있어도 계속 만들어져요. 탭하면 진행 상황을 볼 수 있어요.</AppText>
        </View>
      </TouchableOpacity>
    );
  }

  if (job.lastStatus === 'done') {
    const preview = job.result?.preview_url ? `${BACKEND_BASE_URL}${job.result.preview_url}` : null;
    const onSave = async () => {
      if (busy) return;
      setBusy(true);
      try {
        await finalizeArtistJob(job.jobId, { navigation });
      } finally {
        setBusy(false);
      }
    };
    const onClose = () => {
      showAlert('완성된 아티스트 닫기', '닫으면 이 결과는 목록에서 사라지고 다시 받을 수 없어요. 닫을까요?', [
        { text: '취소', style: 'cancel' },
        {
          text: '닫기',
          style: 'destructive',
          onPress: () => { void discardDoneJob(job.jobId); },
        },
      ]);
    };
    return (
      <View style={[styles.card, styles.cardDone]}>
        {preview ? (
          <Image source={{ uri: preview }} style={styles.thumb} />
        ) : (
          <View style={[styles.thumb, styles.thumbEmpty]} />
        )}
        <View style={styles.body}>
          <AppText style={styles.title}>
            {job.mode === 'outfit' ? '옷 입히기가 완성됐어요' : '완성된 아티스트가 도착했어요'}
          </AppText>
          <AppText style={styles.desc}>저장하면 내 아티스트에 추가돼요.</AppText>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.primaryBtn} onPress={onSave} disabled={busy}>
              {busy ? (
                <ActivityIndicator size="small" color={colors.text.primary} />
              ) : (
                <AppText style={styles.primaryBtnText}>
                  {job.mode === 'outfit' ? '확인하기' : '아티스트로 저장'}
                </AppText>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.ghostBtn} onPress={onClose} disabled={busy}>
              <AppText style={styles.ghostBtnText}>닫기</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }

  if (job.lastStatus === 'failed') {
    return (
      <View style={[styles.card, styles.cardFailed]}>
        <View style={styles.body}>
          <AppText style={styles.title}>아티스트를 만들지 못했어요</AppText>
          <AppText style={styles.desc}>
            {job.error ? `${job.error} · ` : ''}사용된 별은 자동으로 환불돼요.
          </AppText>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.ghostBtn} onPress={() => acknowledgeFailedJob(job.jobId)}>
              <AppText style={styles.ghostBtnText}>확인</AppText>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  }
  return null;
}

/** 현재 사용자의 추적 job 카드 목록 — 없으면 아무것도 렌더하지 않는다 */
export default function GenerationJobCard({ navigation, style }: { navigation?: any; style?: any }) {
  const jobs = useUserArtistJobs();
  const [now, setNow] = useState(Date.now());
  const hasProcessing = jobs.some((j) => j.lastStatus === 'processing');

  // 경과 분 갱신(1분마다) — 진행 중 카드가 있을 때만
  useEffect(() => {
    if (!hasProcessing) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, [hasProcessing]);

  if (jobs.length === 0) return null;
  return (
    <View style={style}>
      {jobs.map((j) => (
        <JobRow key={j.jobId} job={j} navigation={navigation} now={now} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
  },
  cardDone: { borderColor: colors.accent.secondary },
  cardFailed: { borderColor: colors.status.error },
  spinnerBox: {
    width: 44, height: 44, borderRadius: 22, marginRight: 12,
    backgroundColor: colors.bg.surface2, alignItems: 'center', justifyContent: 'center',
  },
  thumb: {
    width: 56, height: 72, borderRadius: 8, marginRight: 12,
    backgroundColor: colors.bg.surface2, resizeMode: 'cover',
  },
  thumbEmpty: { borderWidth: 1, borderColor: colors.border.subtle },
  body: { flex: 1 },
  title: { color: colors.text.primary, fontSize: 14, fontWeight: '700', marginBottom: 2 },
  desc: { color: colors.text.secondary, fontSize: 12, lineHeight: 17 },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  primaryBtn: {
    backgroundColor: colors.accent.primary, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', alignItems: 'center',
  },
  primaryBtnText: { color: colors.text.primary, fontSize: 13, fontWeight: '700' },
  ghostBtn: {
    borderWidth: 1, borderColor: colors.border.default, borderRadius: 10,
    paddingVertical: 8, paddingHorizontal: 14, minHeight: 36, justifyContent: 'center', alignItems: 'center',
  },
  ghostBtnText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },
});
