// [ClubAlbumScreen] v3.305 크루 앨범 — 크루장이 크루 플레이리스트로 만든 테마 앨범(대표 확정 2026-10-08).
//  · 비회원(링크 방문자 포함): 대표곡만 재생, 나머지는 잠금 + '크루 가입하고 전 곡 듣기'.
//  · 멤버: 전체 재생 + '이 앨범에 내 곡 내기'(앨범 생성 이후 발매한 내 곡 → 크루장 승인 시 수록 + ⭐5, 앨범당 1회).
//  · 크루장: 곡 ⋯ → 대표곡 지정·앨범에서 빼기, 참여곡 승인/거절, 앨범 삭제.
//  · 공유: 초대 코드가 붙은 앨범 링크(서버 OG 랜딩 → 앱 이 화면). 팝업은 전부 앱 내 다이얼로그(showAlert).
import { useCallback, useEffect, useState } from 'react';
import { View, FlatList, TouchableOpacity, ActivityIndicator, StyleSheet, Modal, ScrollView, Image } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Feather } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
import { AppText, Button, EmptyState, ScreenLayout } from '../components/ui';
import TrackRow, { getTrackCoverUri } from '../components/TrackRow';
import { showAlert } from '../utils/appAlert';
import { useAuthStore } from '../stores/authStore';
import { usePlayerStore } from '../stores/playerStore';
import { getClub, getClubInvite, type Club } from '../services/clubService';
import {
  ClubAlbumDetail, ClubAlbumTrack, AlbumSubmission, ALBUM_PARTICIPATION_REWARD,
  getClubAlbum, updateClubAlbum, deleteClubAlbum, removeClubAlbumTrack,
  listEligibleTracks, submitToClubAlbum, listAlbumSubmissions, decideAlbumSubmission,
  clubAlbumShareUrl, clubAlbumErrorMessage,
} from '../services/clubAlbumService';
import { joinClubFlow, joinResultMessage, shareOrCopy } from '../utils/clubJoin';

export default function ClubAlbumScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { clubId, albumId } = route.params || {};
  const user = useAuthStore((s) => s.user);
  const playerTrack = usePlayerStore((s) => s.track);

  const [album, setAlbum] = useState<ClubAlbumDetail | null>(null);
  const [club, setClub] = useState<Club | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [subs, setSubs] = useState<AlbumSubmission[]>([]);
  const [pickOpen, setPickOpen] = useState(false);
  const [eligible, setEligible] = useState<ClubAlbumTrack[] | null>(null);

  const isOwner = album?.role === 'owner' || (!!user && !!club?.owner_id && String(club.owner_id) === String(user.id));
  const isMember = !!album?.is_member;
  const pending = club?.join_status === 'pending';

  const load = useCallback(async () => {
    if (!clubId || !albumId) return;
    try {
      const [a, c] = await Promise.all([getClubAlbum(String(clubId), String(albumId)), getClub(String(clubId))]);
      setAlbum(a);
      setClub(c);
      setFailed(false);
      console.info('[ClubAlbum] 화면 로드', { clubId, albumId, tracks: a.tracks.length, member: a.is_member });
    } catch (err: any) {
      console.error('[ClubAlbum] 화면 로드 실패', { clubId, albumId, status: err?.response?.status });
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [clubId, albumId]);

  useEffect(() => { setLoading(true); load(); }, [load, user?.id, route.params?.refreshAt]);

  useEffect(() => {
    if (!album?.title) return;
    navigation.setOptions({ headerTitle: () => <AppText variant="subtitle" numberOfLines={1}>{album.title}</AppText> });
  }, [album?.title, navigation]);

  const loadSubs = useCallback(async () => {
    if (!isOwner || !clubId || !albumId) return;
    try {
      setSubs(await listAlbumSubmissions(String(clubId), String(albumId)));
    } catch {
      setSubs([]);
    }
  }, [isOwner, clubId, albumId]);
  useEffect(() => { loadSubs(); }, [loadSubs]);

  const playable = (album?.tracks || []).filter((t) => !t.locked);

  const play = (item: ClubAlbumTrack) => {
    if (item.locked) {
      showAlert('크루 멤버 전용', '크루에 가입하면 앨범의 모든 곡을 들을 수 있어요.', [
        { text: '닫기', style: 'cancel' },
        { text: pending ? '승인 대기 중' : '크루 가입하기', onPress: pending ? undefined : handleJoin },
      ]);
      return;
    }
    const queue = playable.map((t) => ({ ...t, id: String(t.id) }));
    const idx = queue.findIndex((t) => t.id === String(item.id));
    usePlayerStore.getState().setQueue(queue, null);
    usePlayerStore.getState().setCurrentIndex(idx >= 0 ? idx : 0);
    if (__DEV__) console.info('[ClubAlbum] 재생', { albumId, idx, len: queue.length, member: isMember });
    navigation.navigate('Player', { track: queue[idx >= 0 ? idx : 0] });
  };

  const handleJoin = async () => {
    if (busy || !clubId) return;
    setBusy(true);
    try {
      const r = await joinClubFlow(String(clubId), { reason: 'club_album_join' });
      if (r === 'login') return;
      const m = joinResultMessage(r, club?.name);
      showAlert(m.title, m.body);
      await load();
    } catch (err: any) {
      showAlert('알림', clubAlbumErrorMessage(err, '크루에 가입하지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  const handleShare = async () => {
    if (!clubId || !albumId || !album) return;
    let url = `https://api.maidol.ai.kr/club/${clubId}/album/${albumId}`;
    if (isMember) {
      try {
        const inv = await getClubInvite(String(clubId));
        url = clubAlbumShareUrl(inv.url, String(clubId), String(albumId));
      } catch {
        // 초대 코드 없이도 앨범 링크는 공유 가능(가입은 승인 대기 경로)
      }
    }
    console.info('[ClubAlbum] 공유', { albumId, withInvite: url.includes('?i=') });
    await shareOrCopy(`MAIDOL 크루 앨범 「${album.title}」\n대표곡 먼저 들어보고, 크루에 가입하면 전 곡을 들을 수 있어요!\n${url}`, url);
  };

  const openSubmit = async () => {
    if (!clubId || !albumId) return;
    setPickOpen(true);
    setEligible(null);
    try {
      setEligible(await listEligibleTracks(String(clubId), String(albumId)));
    } catch (err: any) {
      setPickOpen(false);
      showAlert('알림', clubAlbumErrorMessage(err, '내 곡을 불러오지 못했어요.'));
    }
  };

  const submit = async (t: ClubAlbumTrack) => {
    if (busy) return;
    setBusy(true);
    try {
      await submitToClubAlbum(String(clubId), String(albumId), String(t.id));
      setPickOpen(false);
      showAlert('참여 완료', `「${t.title}」을(를) 앨범에 냈어요.\n크루장이 수록하면 참여 미션 ⭐${ALBUM_PARTICIPATION_REWARD}를 받아요.`);
      load();
    } catch (err: any) {
      showAlert('알림', clubAlbumErrorMessage(err, '곡을 내지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  const goCreateSong = () => {
    setPickOpen(false);
    console.info('[ClubAlbum] 테마 곡 만들기로 이동', { albumId });
    navigation.navigate('MainTabs', { screen: 'Studio' });
  };

  const decide = async (s: AlbumSubmission, approve: boolean) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await decideAlbumSubmission(String(clubId), String(albumId), String(s.track.id), approve);
      if (approve) {
        showAlert('수록 완료', r.starred
          ? `${s.nickname ?? '멤버'}님 곡을 수록했어요. 참여 미션 ⭐${ALBUM_PARTICIPATION_REWARD}가 지급됐어요.`
          : `${s.nickname ?? '멤버'}님 곡을 수록했어요.${r.reason === 'weekly_cap' ? '\n(이번 주 참여 미션 ⭐ 상한에 도달해 ⭐는 지급되지 않았어요)' : ''}`);
      }
      await Promise.all([load(), loadSubs()]);
    } catch (err: any) {
      showAlert('알림', clubAlbumErrorMessage(err, '처리하지 못했어요. 잠시 후 다시 시도해 주세요.'));
    } finally {
      setBusy(false);
    }
  };

  const ownerTrackMenu = (t: ClubAlbumTrack) => {
    const isRep = String(t.id) === String(album?.representative_track_id);
    showAlert(t.title || '곡', undefined, [
      ...(isRep ? [] : [{
        text: '대표곡으로 지정',
        onPress: async () => {
          try {
            await updateClubAlbum(String(clubId), String(albumId), { representative_track_id: String(t.id) });
            load();
          } catch (err: any) {
            showAlert('알림', clubAlbumErrorMessage(err, '대표곡을 바꾸지 못했어요.'));
          }
        },
      }, {
        text: '앨범에서 빼기',
        style: 'destructive' as const,
        onPress: async () => {
          try {
            await removeClubAlbumTrack(String(clubId), String(albumId), String(t.id));
            load();
          } catch (err: any) {
            showAlert('알림', clubAlbumErrorMessage(err, '곡을 빼지 못했어요.'));
          }
        },
      }]),
      { text: '닫기', style: 'cancel' },
    ]);
  };

  const confirmDelete = () => {
    showAlert('앨범 삭제', `「${album?.title}」 앨범을 삭제할까요?\n곡과 플레이리스트는 그대로 남아요.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제', style: 'destructive', onPress: async () => {
          try {
            await deleteClubAlbum(String(clubId), String(albumId));
            navigation.navigate('MainTabs', { screen: 'ClubHome', params: { clubId, initialTab: 'playlists', refreshAt: Date.now() } });
          } catch (err: any) {
            showAlert('알림', clubAlbumErrorMessage(err, '앨범을 삭제하지 못했어요.'));
          }
        },
      },
    ]);
  };

  if (loading && !album) {
    return <ScreenLayout><ActivityIndicator size="large" color={colors.accent.primary} style={{ marginTop: spacing.huge }} /></ScreenLayout>;
  }
  if (failed || !album) {
    return (
      <ScreenLayout>
        <EmptyState
          icon={<Feather name="disc" size={44} color={colors.text.muted} />}
          title="앨범을 찾을 수 없어요"
          hint="삭제되었거나 잠시 불러오지 못했어요."
          action={<Button label="다시 시도" variant="tonal" onPress={() => { setLoading(true); load(); }} />}
        />
      </ScreenLayout>
    );
  }

  const rep = album.tracks.find((t) => t.is_representative) || null;
  const repCover = rep ? getTrackCoverUri({ ...rep, id: String(rep.id), cover_image: rep.cover_image ?? undefined, cover_image_url: rep.cover_image_url ?? undefined } as any) : null;
  const mySubmittedPending = (album.my_submissions || []).some((s) => s.status === 'pending');

  const header = (
    <View>
      <View style={styles.hero}>
        {repCover ? <Image source={{ uri: repCover }} style={styles.heroCover} /> : (
          <View style={[styles.heroCover, styles.heroPlaceholder]}><Feather name="disc" size={36} color={colors.text.muted} /></View>
        )}
        <View style={{ flex: 1 }}>
          <AppText variant="caption" tone="accent">{`${club?.name ?? '크루'} · 크루 앨범`}</AppText>
          <AppText variant="title3" style={{ marginTop: 2 }} numberOfLines={2}>{album.title}</AppText>
          {album.theme ? <AppText variant="footnote" tone="secondary" style={{ marginTop: spacing.xs }} numberOfLines={3}>{album.theme}</AppText> : null}
          <AppText variant="caption" tone="muted" style={{ marginTop: spacing.xs }}>{`${album.tracks.length}곡`}</AppText>
        </View>
      </View>

      <View style={styles.actions}>
        {isMember ? (
          <Button label="전체 재생" size="sm" leading={<Feather name="play" size={14} color={colors.text.primary} />}
            disabled={!playable.length} onPress={() => playable[0] && play(playable[0])} />
        ) : rep ? (
          <Button label="대표곡 듣기" size="sm" leading={<Feather name="play" size={14} color={colors.text.primary} />} onPress={() => play(rep)} />
        ) : null}
        <Button label="공유" size="sm" variant="tonal" leading={<Feather name="share-2" size={14} color={colors.accent.primary} />} onPress={handleShare} />
        {isOwner ? <Button label="삭제" size="sm" variant="text" onPress={confirmDelete} /> : null}
      </View>

      {!isMember ? (
        <View style={styles.joinCard}>
          <Feather name="lock" size={16} color={colors.accent.primary} />
          <View style={{ flex: 1 }}>
            <AppText variant="callout">{pending ? '가입 승인을 기다리고 있어요' : '크루에 가입하면 전 곡을 들을 수 있어요'}</AppText>
            <AppText variant="caption" tone="secondary" style={{ marginTop: 2 }}>
              {`가입 후 테마에 맞는 곡을 만들어 내면 참여 미션 ⭐${ALBUM_PARTICIPATION_REWARD}`}
            </AppText>
          </View>
          {!pending ? <Button label={user ? '가입하기' : '로그인하고 가입'} size="sm" loading={busy} onPress={handleJoin} /> : null}
        </View>
      ) : (
        <TouchableOpacity style={styles.missionCard} activeOpacity={0.8} onPress={openSubmit} accessibilityLabel="이 앨범에 내 곡 내기">
          <Feather name="target" size={16} color={colors.accent.primary} />
          <View style={{ flex: 1 }}>
            <AppText variant="callout">{`이 앨범에 내 곡 내기 · ⭐${ALBUM_PARTICIPATION_REWARD}`}</AppText>
            <AppText variant="caption" tone="secondary" style={{ marginTop: 2 }}>
              {mySubmittedPending ? '낸 곡이 크루장 확인을 기다리고 있어요' : '테마에 맞춰 새로 만든 곡을 내면, 크루장이 수록할 때 ⭐ 지급(앨범당 1회)'}
            </AppText>
          </View>
          <Feather name="chevron-right" size={18} color={colors.text.muted} />
        </TouchableOpacity>
      )}

      {isOwner && subs.length ? (
        <View style={styles.subsBox}>
          <AppText variant="callout" style={{ marginBottom: spacing.sm }}>{`참여곡 확인 (${subs.length})`}</AppText>
          {subs.map((s) => (
            <View key={String(s.track.id)} style={styles.subRow}>
              <View style={{ flex: 1 }}>
                <TrackRow track={{ ...s.track, id: String(s.track.id) } as any} onPress={() => play({ ...s.track, locked: false })} />
                <AppText variant="caption" tone="muted" style={{ marginLeft: spacing.md }}>{`${s.nickname ?? '멤버'}님이 냈어요`}</AppText>
              </View>
              <View style={{ gap: spacing.xs }}>
                <Button label="수록" size="sm" disabled={busy} onPress={() => decide(s, true)} />
                <Button label="거절" size="sm" variant="text" disabled={busy} onPress={() => decide(s, false)} />
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  const renderTrack = ({ item }: { item: ClubAlbumTrack }) => (
    <TrackRow
      track={{ ...item, id: String(item.id) } as any}
      left={item.is_representative
        ? <View style={styles.repBadge}><AppText variant="caption" tone="accent">대표</AppText></View>
        : item.locked ? <View style={styles.lockSlot}><Feather name="lock" size={14} color={colors.text.muted} /></View> : undefined}
      onPress={() => play(item)}
      onMore={isOwner ? () => ownerTrackMenu(item) : undefined}
    />
  );

  return (
    <ScreenLayout>
      <FlatList
        data={album.tracks}
        keyExtractor={(t) => String(t.id)}
        renderItem={renderTrack}
        ListHeaderComponent={header}
        ListEmptyComponent={<EmptyState title="아직 곡이 없어요" />}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: playerTrack ? 140 : 80 }}
      />

      <Modal visible={pickOpen} transparent animationType="fade" onRequestClose={() => setPickOpen(false)}>
        <View style={styles.backdrop}>
          <TouchableOpacity style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)' }]} activeOpacity={1} onPress={() => setPickOpen(false)} accessibilityLabel="닫기" />
          <View style={styles.sheet}>
            <AppText variant="title3">이 앨범에 낼 곡 고르기</AppText>
            <AppText variant="caption" tone="secondary" style={{ marginTop: spacing.xs }}>
              {album.theme ? `테마: ${album.theme}\n` : ''}앨범이 만들어진 뒤 발매한 내 공개곡만 낼 수 있어요.
            </AppText>
            {eligible === null ? (
              <ActivityIndicator color={colors.accent.primary} style={{ marginVertical: spacing.xl }} />
            ) : eligible.length === 0 ? (
              <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
                <AppText variant="footnote" tone="secondary">아직 낼 수 있는 곡이 없어요. 테마에 맞는 새 곡을 만들어 보세요!</AppText>
                <Button label="곡 만들러 가기" fullWidth onPress={goCreateSong} />
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 360, marginTop: spacing.md }}>
                {eligible.map((t) => {
                  const st = t.submission_status;
                  return (
                    <View key={String(t.id)} style={styles.pickRow}>
                      <View style={{ flex: 1 }}><TrackRow track={{ ...t, id: String(t.id) } as any} onPress={() => (st ? null : submit(t))} /></View>
                      {st === 'approved' ? <AppText variant="caption" tone="accent">수록됨</AppText>
                        : st === 'pending' ? <AppText variant="caption" tone="muted">확인 중</AppText>
                        : <Button label="내기" size="sm" disabled={busy} onPress={() => submit(t)} />}
                    </View>
                  );
                })}
              </ScrollView>
            )}
            <Button label="닫기" variant="text" onPress={() => setPickOpen(false)} />
          </View>
        </View>
      </Modal>
    </ScreenLayout>
  );
}

const styles = StyleSheet.create({
  hero: { flexDirection: 'row', gap: spacing.md, padding: spacing.lg, alignItems: 'center' },
  heroCover: { width: 96, height: 96, borderRadius: radius.lg, backgroundColor: colors.bg.surface2 },
  heroPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg, flexWrap: 'wrap' },
  joinCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, margin: spacing.lg, padding: spacing.md,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.accent, backgroundColor: colors.bg.surface1,
  },
  missionCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, margin: spacing.lg, padding: spacing.md,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border.subtle, backgroundColor: colors.bg.surface1,
  },
  subsBox: { marginHorizontal: spacing.lg, marginBottom: spacing.md, padding: spacing.md, borderRadius: radius.lg, backgroundColor: colors.bg.surface1 },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  repBadge: { width: 32, alignItems: 'center' },
  lockSlot: { width: 32, alignItems: 'center' },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg.surface1, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, gap: spacing.sm },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
});
