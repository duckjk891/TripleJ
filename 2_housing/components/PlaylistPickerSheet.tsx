// [PlaylistPickerSheet] 곡(들)을 플레이리스트에 담는 바텀시트 — 기존 목록 선택 또는 새로 만들어 담기.
// 단일 곡·여러 곡(검색 결과 전체 담기) 모두 지원. trackIds 길이에 따라 문구만 달라진다.
// [KeyboardCtl] v3.207(⑤): useAndroidKeyboardLift(RN Keyboard 이벤트 셈법) 제거 —
// SDK 54 edge-to-edge+Fabric 실기기에서 keyboardDidShow 미발화/좌표 불일치로 실패 확정.
// keyboard-controller KeyboardAvoidingView(behavior='padding', 네이티브 IME 인셋 직수신,
// RN Modal 별도 window에서도 동작)로 iOS·Android 리프트 일원화. maxHeight 동적 클램프도
// 불요 — KAV padding으로 backdrop 자체가 줄어 시트 60% 상한이 남은 화면 기준이 된다.
import { useEffect, useState } from 'react';
import { Modal, View, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, StyleSheet } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { showAlert } from '../utils/appAlert';
import api from '../services/api';
import { AppText, Button } from './ui';
import { colors } from '../theme/colors';
import { spacing, radius } from '../theme/spacing';
// v3.245: 클럽 공유 플레이리스트 섹션 — 내가 멤버인 클럽들의 플리에도 동일하게 담기
import { CLUB_LABEL, getMyClubs, listClubPlaylists } from '../services/clubService'; // v3.252 리네이밍 라벨

interface Props {
  visible: boolean;
  trackIds: string[];      // 담을 곡 id 목록(1개 이상)
  onClose: () => void;
}

// v3.245: 클럽 플리 행 — 어느 클럽의 플리인지 이름을 함께 보여준다
interface ClubPlRow { id: string; title: string; track_count?: number; clubName: string }

export default function PlaylistPickerSheet({ visible, trackIds, onClose }: Props) {
  const insets = useSafeAreaInsets(); // v3.196: Modal은 별도 window라 루트 안전영역 패딩 미상속 → 시트에 직접 보강
  const [playlists, setPlaylists] = useState<any[]>([]);
  const [clubPlaylists, setClubPlaylists] = useState<ClubPlRow[]>([]); // v3.245: 없으면 섹션 숨김
  const [newName, setNewName] = useState('');
  const [busy, setBusy] = useState(false);
  const many = trackIds.length > 1;

  useEffect(() => {
    if (!visible) return;
    (async () => {
      if (__DEV__) console.info('[PlaylistPickerSheet] 플레이리스트 조회', { count: trackIds.length });
      try {
        const res = await api.get('/playlists/');
        setPlaylists(res.data.playlists || res.data || []);
      } catch (err: any) {
        console.error('[PlaylistPickerSheet] 플레이리스트 조회 실패', { status: err?.response?.status });
        setPlaylists([]);
      }
    })();
    // v3.245: 클럽 플리 병행 로드 — 서버 미배포/실패·클럽 없음이면 섹션 숨김(개인 플리 동작 불변)
    (async () => {
      try {
        const mine = await getMyClubs();
        if (!mine.length) { setClubPlaylists([]); return; }
        const results = await Promise.allSettled(mine.map((c) => listClubPlaylists(c.id)));
        const rows: ClubPlRow[] = [];
        results.forEach((r, i) => {
          if (r.status !== 'fulfilled') return;
          for (const p of r.value) rows.push({ id: p.id, title: p.title || p.name || '플레이리스트', track_count: p.track_count, clubName: mine[i].name });
        });
        if (__DEV__) console.info('[Club] 피커 클럽 플리', { clubs: mine.length, playlists: rows.length });
        setClubPlaylists(rows);
      } catch (err: any) {
        console.error('[Club] 피커 클럽 플리 조회 실패', { status: err?.response?.status });
        setClubPlaylists([]);
      }
    })();
  }, [visible]);

  // 여러 곡을 순차 추가 — 이미 담긴 곡(중복 오류)은 건너뛰고 계속 진행
  const addAll = async (playlistId: string): Promise<{ added: number; failed: number }> => {
    let added = 0, failed = 0;
    for (const id of trackIds) {
      try {
        await api.post(`/playlists/${playlistId}/tracks`, { track_id: id });
        added += 1;
      } catch (err: any) {
        failed += 1;
        console.error('[PlaylistPickerSheet] 곡 추가 실패', { playlistId, trackId: id, status: err?.response?.status });
      }
    }
    return { added, failed };
  };

  const handlePick = async (playlistId: string) => {
    setBusy(true);
    const { added, failed } = await addAll(playlistId);
    setBusy(false);
    onClose();
    showAlert(added > 0 ? '완료' : '알림',
      added > 0
        ? (many ? `${added}곡을 담았어요.${failed ? ` (${failed}곡은 이미 있거나 실패)` : ''}` : '플레이리스트에 추가되었습니다!')
        : '담지 못했어요. 이미 담긴 곡일 수 있어요.');
  };

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) { showAlert('알림', '플레이리스트 이름을 입력해주세요.'); return; }
    setBusy(true);
    try {
      const createRes = await api.post('/playlists/', { title: name });
      const { added, failed } = await addAll(createRes.data.id);
      setBusy(false);
      setNewName('');
      onClose();
      showAlert('완료', many
        ? `"${name}"에 ${added}곡을 담았어요.${failed ? ` (${failed}곡 실패)` : ''}`
        : `"${name}"에 추가되었습니다!`);
    } catch (err: any) {
      setBusy(false);
      console.error('[PlaylistPickerSheet] 플레이리스트 생성 실패', { status: err?.response?.status });
      showAlert('오류', err?.response?.data?.error || '생성에 실패했습니다.');
    }
  };

  // v3.247(서버 확정): GET /playlists 는 모든 항목에 club_id·club_name 을 내려준다(개인=null) —
  // null 은 falsy 라 아래 truthy 체크가 구서버(필드 자체 없음)와 동일하게 동작. 중복 노출 방지 결정:
  // '클럽 섹션 우선' — 클럽 섹션에 이미 뜬 id 는 개인 섹션에서 제외한다.
  // 클럽 섹션 로드 실패/구서버(클럽 API 404)로 클럽 섹션이 비면 개인 섹션에 그대로 남기되
  // users 배지+클럽명 부제로 구분(항목 소실 방지 — 어느 경로로도 같은 플리가 두 번 뜨지 않음).
  const clubSectionIds = new Set(clubPlaylists.map((p) => String(p.id)));
  const personalRows = playlists.filter((pl: any) => !clubSectionIds.has(String(pl.id)));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* [KeyboardCtl] v3.207(⑤): keyboard-controller KAV(behavior='padding') — iOS·Android 공통.
          keyboardVerticalOffset=-insets.bottom: IME 인셋에 내비바 영역이 포함 → 시트 자체
          paddingBottom(insets.bottom+xl)과의 이중 계상 상쇄(v3.201 kbHeight-insets.bottom 셈법과 동치).
          닫힘 시 padding이 0으로 복귀 → 잔존 간격 구조적 불가. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={-insets.bottom}
        pointerEvents="box-none"
      >
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        {/* v3.196: Modal은 루트 인셋 미상속 → 하단 제스처 바만큼 paddingBottom 보강(v3.191 queueSheet 패턴)
            v3.207(⑤): maxHeight 60%는 KAV padding으로 줄어든 backdrop 기준이라 동적 클램프 불요 */}
        <TouchableOpacity
          style={[styles.sheet, { paddingBottom: insets.bottom + spacing.xl }]}
          activeOpacity={1}
          onPress={() => {}}
        >
          <AppText variant="title3" style={styles.title}>
            {many ? `${trackIds.length}곡을 플레이리스트에 담기` : '플레이리스트에 담기'}
          </AppText>
          {busy ? <ActivityIndicator color={colors.accent.primary} style={{ marginBottom: spacing.lg }} /> : null}
          {personalRows.length > 0 && (
            /* v3.201(A): 목록 ScrollView 전환 — 비스크롤 View는 목록이 길면 맨 아래 입력행을
               시트 밖으로 밀어내는 잠재 결함(키보드와 무관)이 있었다. maxHeight로 입력행 상시 노출 보장. */
            <ScrollView style={[styles.list, { maxHeight: 240 }]} keyboardShouldPersistTaps="handled">
              {personalRows.map((pl: any) => (
                <TouchableOpacity key={pl.id} style={styles.item} disabled={busy} onPress={() => handlePick(pl.id)}>
                  {/* v3.247: club_id 있는 플리(클럽 섹션 미표시분) — users 소형 배지 + 클럽명 부제 */}
                  <View style={styles.itemTitleRow}>
                    {pl.club_id ? <Feather name="users" size={12} color={colors.text.muted} /> : null}
                    <AppText variant="body" numberOfLines={1} style={{ flexShrink: 1 }}>{pl.title || pl.name}</AppText>
                  </View>
                  <AppText variant="caption" tone="muted" numberOfLines={1}>
                    {/* v3.252 리네이밍 — 크루명 미직렬화 구응답 폴백 라벨 */}
                    {pl.club_id ? `${pl.club_name || CLUB_LABEL} · ${pl.track_count ?? 0}곡` : `${pl.track_count ?? 0}곡`}
                  </AppText>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
          {/* v3.245: 클럽 플레이리스트 — 내가 멤버인 클럽의 공유 플리. 데이터 없으면 섹션 자체 숨김 */}
          {clubPlaylists.length > 0 && (
            <View>
              {/* v3.252 리네이밍 — 섹션 라벨 */}
              <AppText variant="footnote" tone="secondary" style={styles.label}>{`${CLUB_LABEL} 플레이리스트`}</AppText>
              <ScrollView style={[styles.list, { maxHeight: 160 }]} keyboardShouldPersistTaps="handled">
                {clubPlaylists.map((pl) => (
                  <TouchableOpacity key={`club-${pl.id}`} style={styles.item} disabled={busy} onPress={() => handlePick(pl.id)}>
                    <AppText variant="body" numberOfLines={1}>{pl.title}</AppText>
                    <AppText variant="caption" tone="muted" numberOfLines={1}>{`${pl.clubName} · ${pl.track_count ?? 0}곡`}</AppText>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
          <AppText variant="footnote" tone="secondary" style={styles.label}>새 플레이리스트 만들기</AppText>
          <View style={styles.createRow}>
            <TextInput
              style={styles.input}
              placeholder="플레이리스트 이름"
              placeholderTextColor={colors.text.muted}
              value={newName}
              onChangeText={setNewName}
            />
            <Button label="만들기" size="md" onPress={handleCreate} />
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    
      </KeyboardAvoidingView></Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg.surface1, borderTopLeftRadius: radius.xxl, borderTopRightRadius: radius.xxl, padding: spacing.xl, maxHeight: '60%' },
  title: { marginBottom: spacing.lg },
  list: { marginBottom: spacing.lg },
  item: { paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border.subtle },
  // v3.247: 클럽 플리 행 제목(users 배지 + 이름 한 줄)
  itemTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { marginBottom: spacing.sm },
  createRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'stretch' },
  input: {
    flex: 1, backgroundColor: colors.bg.deepest, borderRadius: radius.md, padding: spacing.md,
    color: colors.text.primary, borderWidth: 1, borderColor: colors.border.subtle,
  },
});
