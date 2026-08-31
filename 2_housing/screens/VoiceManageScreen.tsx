import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import {
  StyleSheet,
  View,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import { colors } from '../theme/colors';
import { useVoiceStore, artistVoiceLabel } from '../stores/voiceStore';
import { useArtistProfileStore } from '../stores/artistProfileStore';
import { useCharacterTaskStore } from '../stores/characterTaskStore';
import { VOCAL_STYLES, VOCAL_OPTIONS } from './MusicGenerationScreen';
import { deleteVoiceClone, getVoiceClone, VoiceClone } from '../services/voiceService';
import api from '../services/api';

// v3.83: 클론 상태 배지 (MAIDOL MyVoiceCloneSection STATUS_BADGE 이식 — 기술 용어 최소화)
const CLONE_STATUS_BADGE: Record<string, string> = {
  validating: '분석 중',
  awaiting_verify: '검증 대기',
  generating: '학습 중',
  ready: '사용 가능',
  failed: '실패',
  expired: '만료됨',
};

// ── 아티스트 목소리 관리 화면 ─────────────────────────────────────────────────
// v3.84: 아티스트 목소리는 2택 — 간편(프리셋: 성별+보컬 스타일 태그) 또는
// 내 목소리(정식 클로닝: 노래+문장낭독). 서로 배타(하나 설정 시 다른 쪽 자동 해제).
// 프리셋은 서버 호출 없음 — 곡 생성 때 vocal/vocalStyle 태그로만 쓰인다.
// route.params.select === 'artist' → 선택 모드: 설정 완료 시 goBack.
// v3.102: 구 Voice Persona 자산 목록·미리듣기 제거 — v216 서버 /voice-persona/* 삭제,
// 내 목소리 목록은 voice_clones(정식 클로닝)만 표시(중복 UI 정리).

type Props = NativeStackScreenProps<any, 'VoiceManage'>;

export default function VoiceManageScreen({ navigation, route }: Props) {
  const insets = useSafeAreaInsets();
  const selectMode = (route.params as any)?.select === 'artist';

  // v3.83: 정식 클로닝 목록
  const clones = useVoiceStore((s) => s.clones);
  const clonesLoading = useVoiceStore((s) => s.clonesLoading);
  const fetchClones = useVoiceStore((s) => s.fetchClones);
  // v3.84: 아티스트 목소리 (프리셋 XOR 클론)
  const artistVoice = useVoiceStore((s) => s.artistVoice);
  const setArtistVoicePreset = useVoiceStore((s) => s.setArtistVoicePreset);
  const setArtistVoiceClone = useVoiceStore((s) => s.setArtistVoiceClone);
  const clearArtistVoice = useVoiceStore((s) => s.clearArtistVoice);
  const artistCloneId = artistVoice?.type === 'clone' ? artistVoice.personaId : null;

  // v3.84: 간편(프리셋) 만들기 — 활성 아티스트 슬롯의 성별(artistProfileStore)이 기본값
  const characterKind = useCharacterTaskStore((s) => s.characterKind);
  const profiles = useArtistProfileStore((s) => s.profiles);
  const activeSlot = characterKind === 'virtual' ? 'virtual' : 'real';
  const profileGender = profiles[activeSlot]?.gender || '';
  const defaultPresetGender: 'male' | 'female' | null = profileGender.includes('남')
    ? 'male'
    : profileGender.includes('여')
      ? 'female'
      : null;

  // v3.106: 클로닝 ⭐ 비용 캡션 — /points/costs의 voice_clone 키가 있을 때만 표시
  // (구서버=키 없음=무표시, 하드코딩 금지 — 백엔드 B-9 배포 전 껍데기 방지)
  const [voiceCloneCost, setVoiceCloneCost] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await api.get('/points/costs');
        const cost = res.data?.costs?.voice_clone;
        if (alive && typeof cost === 'number') setVoiceCloneCost(cost);
        if (__DEV__) console.info('[VoiceManage] /points/costs voice_clone =', cost ?? '(키 없음)');
      } catch (err: any) {
        console.error('[VoiceManage] /points/costs 조회 실패', { status: err?.response?.status });
      }
    })();
    return () => { alive = false; };
  }, []);

  const [presetOpen, setPresetOpen] = useState(false);
  const [presetGender, setPresetGender] = useState<'male' | 'female' | null>(
    artistVoice?.type === 'preset' ? artistVoice.gender : defaultPresetGender
  );
  const [presetStyle, setPresetStyle] = useState<string>(
    artistVoice?.type === 'preset' ? artistVoice.style : ''
  );

  // v3.79 UX-1: ArtistResult 가 탭 헤더에 주입한 ‹ 가 남아 이중 화살표가 되지 않도록
  // 진입 시 parent 헤더의 headerLeft 를 정리한다 (자체 헤더 ‹ 하나만 남김).
  // ArtistResult 는 focus 시 재주입하므로 복귀하면 원래대로 돌아온다.
  useLayoutEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    if (__DEV__) console.log('[VoiceManage] parent headerLeft 정리 (이중 뒤로가기 방지)');
    parent.setOptions({ headerLeft: undefined });
  }, [navigation]);

  // v3.83: 위저드에서 돌아왔을 때도 최신 목록 반영 — focus 시 재조회
  useFocusEffect(
    useCallback(() => {
      fetchClones();
    }, [fetchClones])
  );

  // v3.105: 진행 중(validating/generating) 클론 폴링 — 화면 focus 동안 10초 간격.
  // 서버는 "단건 GET /voice-clone/{id}"가 올 때만 Suno를 auto-poll하므로(목록 GET은 안 태움)
  // 반드시 단건 GET을 보내야 학습이 진행된다. 상태가 바뀌면 목록 재조회로 배지 갱신.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let busy = false;
      const interval = setInterval(async () => {
        if (cancelled || busy) return;
        const inProgress = useVoiceStore
          .getState()
          .clones.filter((c) => (c.status === 'generating' || c.status === 'validating') && c.clone_id);
        if (inProgress.length === 0) return;
        busy = true;
        try {
          for (const c of inProgress) {
            const fresh = await getVoiceClone(c.clone_id);
            if (cancelled) return;
            if (fresh.status !== c.status) {
              console.log('[VoiceManage] 진행 중 클론 상태 변경:', c.clone_id, c.status, '→', fresh.status);
              fetchClones();
              break;
            }
          }
        } catch (err: any) {
          console.error('[VoiceManage] 진행 중 클론 폴링 실패:', err?.response?.status, err?.message);
        } finally {
          busy = false;
        }
      }, 10000);
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }, [fetchClones])
  );

  useEffect(() => {
    console.log('[VoiceManage] 진입, selectMode=', selectMode, 'artistVoice=', artistVoice?.type ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── v3.84: 간편(프리셋) 목소리 설정 — 서버 호출 없음 ──
  const handleSavePreset = () => {
    if (!presetGender) {
      showAlert('성별 선택', '아티스트 성별이 기록되어 있지 않아요. 성별을 먼저 선택해주세요.');
      return;
    }
    if (!presetStyle) {
      showAlert('스타일 선택', '보컬 스타일을 선택해주세요.');
      return;
    }
    console.log('[VoiceManage] 프리셋 아티스트 목소리 설정:', presetGender, presetStyle);
    setArtistVoicePreset(presetGender, presetStyle);
    const label = `${presetGender === 'male' ? '남성' : '여성'} · ${presetStyle}`;
    showAlert(
      '설정 완료',
      `간편 목소리(${label})로 설정했어요.\n곡을 만들 때 이 스타일이 적용돼요.`,
      [{ text: '확인', onPress: () => { if (selectMode) navigation.goBack(); } }]
    );
  };

  // ── v3.84: 아티스트 목소리 해제 ──
  const handleClearArtistVoice = () => {
    showAlert('목소리 해제', '아티스트 목소리 설정을 해제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '해제', style: 'destructive', onPress: () => clearArtistVoice() },
    ]);
  };

  // ── 클론(페르소나/정식 클로닝) → 아티스트 목소리 설정 공통 ──
  const applyCloneAsArtistVoice = (id: string, name: string) => {
    console.log('[VoiceManage] 클론 아티스트 목소리 설정:', id, name);
    setArtistVoiceClone(id, name);
    showAlert(
      '설정 완료',
      `"${name}" 목소리를 아티스트 목소리로 설정했어요.\n작곡 시 이 목소리가 기본으로 제안됩니다.`,
      [{ text: '확인', onPress: () => { if (selectMode) navigation.goBack(); } }]
    );
  };

  // ── v3.83: 클론 행 탭 — 검증 대기면 위저드 3단계 재개 / ready면 아티스트 목소리 설정 ──
  const handleCloneTap = (c: VoiceClone) => {
    if (c.status === 'awaiting_verify') {
      console.log('[VoiceManage] 클론 검증 재개:', c.clone_id);
      navigation.navigate('VoiceCloneWizard' as any, { resumeCloneId: c.clone_id });
      return;
    }
    if (c.status !== 'ready' || !c.voice_id) {
      showAlert('아직 처리 중', '이 목소리는 아직 준비 중이에요. 처리가 끝난 후 선택해주세요.');
      return;
    }
    // 작곡 전송 계약(MAIDOL StudioTab2): persona_id = clone.voice_id, persona_model = 'voice_persona'
    if (selectMode) {
      applyCloneAsArtistVoice(c.voice_id, c.voice_name);
      return;
    }
    showAlert(`"${c.voice_name || '이 목소리'}"`, '이 목소리를 아티스트 목소리로 설정할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '설정', onPress: () => applyCloneAsArtistVoice(c.voice_id!, c.voice_name) },
    ]);
  };

  // ── v3.83: 클론 삭제 ──
  const handleCloneDelete = (c: VoiceClone) => {
    showAlert('목소리 삭제', `"${c.voice_name || '이 목소리'}"를 삭제할까요?`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          try {
            console.log('[VoiceManage] 클론 삭제:', c.clone_id);
            await deleteVoiceClone(c.clone_id);
            if (c.voice_id && artistCloneId === c.voice_id) clearArtistVoice();
            await fetchClones();
          } catch (err: any) {
            const msg = err?.response?.data?.detail || err?.response?.data?.error || err?.message || '알 수 없는 오류';
            showAlert('삭제 실패', msg);
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      {/* 헤더 (StudioStack headerShown:false → 화면 내부 헤더) */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <AppText style={styles.backBtnText}>‹</AppText>
        </TouchableOpacity>
        <AppText style={styles.headerTitle}>아티스트 목소리</AppText>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        {selectMode && (
          <View style={styles.selectBanner}>
            <AppText style={styles.selectBannerText}>
              아티스트에 연결할 목소리를 선택해주세요.
            </AppText>
          </View>
        )}

        {/* ── v3.84: 현재 아티스트 목소리 ── */}
        <View style={styles.currentBox}>
          <AppText style={styles.sectionTitle}>현재 아티스트 목소리</AppText>
          {artistVoice ? (
            <>
              <View style={styles.currentRow}>
                <AppText style={styles.currentText} numberOfLines={1}>
                  {artistVoice.type === 'preset'
                    ? `간편 목소리: ${artistVoiceLabel(artistVoice)}`
                    : `내 목소리: ${artistVoice.name}`}
                </AppText>
                <TouchableOpacity
                  style={styles.clearBtn}
                  onPress={handleClearArtistVoice}
                  hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                >
                  <AppText style={styles.clearBtnText}>해제</AppText>
                </TouchableOpacity>
              </View>
              {artistVoice.type === 'preset' && (
                <AppText style={styles.currentDesc}>선택한 스타일은 곡을 만들 때 적용돼요.</AppText>
              )}
            </>
          ) : (
            <AppText style={styles.currentEmpty}>아직 설정 안 됨</AppText>
          )}
        </View>

        {/* ── 만들기 2택: 간편(프리셋) / 내 목소리(클로닝) ── */}
        <View style={styles.createBox}>
          <AppText style={styles.sectionTitle}>아티스트 목소리 만들기</AppText>
          <AppText style={styles.sectionDesc}>
            간편 목소리(스타일 프리셋)와 내 목소리 중 하나만 아티스트 목소리로 쓸 수 있어요.
          </AppText>

          {/* v3.84: 간편 만들기 — 성별+보컬 스타일 프리셋 (서버 호출 없음) */}
          <TouchableOpacity
            style={styles.wizardBtn}
            onPress={() => {
              console.log('[VoiceManage] 간편 만들기 섹션 토글:', !presetOpen);
              setPresetOpen((o) => !o);
            }}
          >
            <AppText style={styles.wizardBtnText}>간편 만들기 {presetOpen ? '▲' : '▼'}</AppText>
            <AppText style={styles.wizardBtnDesc}>
              성별과 보컬 스타일을 골라 바로 설정해요. 선택한 스타일은 곡을 만들 때 적용돼요.
            </AppText>
          </TouchableOpacity>

          {presetOpen && (
            <View style={styles.presetSection}>
              <AppText style={styles.presetLabel}>성별</AppText>
              {!defaultPresetGender && !presetGender && (
                <AppText style={styles.presetHint}>
                  아티스트 성별이 기록되어 있지 않아요. 직접 선택해주세요.
                </AppText>
              )}
              <View style={styles.chipRow}>
                {VOCAL_OPTIONS.map((label) => {
                  const value: 'male' | 'female' = label === '남성' ? 'male' : 'female';
                  const selected = presetGender === value;
                  return (
                    <TouchableOpacity
                      key={label}
                      style={[styles.presetChip, selected && styles.presetChipSelected]}
                      onPress={() => setPresetGender(value)}
                    >
                      <AppText style={[styles.presetChipText, selected && styles.presetChipTextSelected]}>
                        {label}
                      </AppText>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <AppText style={[styles.presetLabel, { marginTop: 10 }]}>보컬 스타일</AppText>
              <View style={styles.chipRow}>
                {VOCAL_STYLES.map((style) => {
                  const selected = presetStyle === style;
                  return (
                    <TouchableOpacity
                      key={style}
                      style={[styles.presetChip, selected && styles.presetChipSelected]}
                      onPress={() => setPresetStyle(style)}
                    >
                      <AppText style={[styles.presetChipText, selected && styles.presetChipTextSelected]}>
                        {style}
                      </AppText>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[styles.createBtn, (!presetGender || !presetStyle) && { opacity: 0.4 }]}
                onPress={handleSavePreset}
                disabled={!presetGender || !presetStyle}
              >
                <AppText style={styles.createBtnText}>이 목소리로 설정</AppText>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.createDivider} />

          {/* v3.83: 정식 클로닝(노래+문장낭독 검증) — 4단계 위저드 진입 */}
          <TouchableOpacity
            style={styles.wizardBtn}
            onPress={() => {
              console.log('[VoiceManage] 정식 클로닝 위저드 진입');
              navigation.navigate('VoiceCloneWizard' as any);
            }}
          >
            <AppText style={styles.wizardBtnText}>내 목소리 만들기</AppText>
            <AppText style={styles.wizardBtnDesc}>
              내가 부른 노래로 나만의 목소리를 만들어요. 마지막에 짧은 문구를 따라 읽으면 완성돼요.
            </AppText>
            {/* v3.106: 비용 캡션 — voice_clone 키 있는 서버에서만(위저드 confirm과 동일 조건) */}
            {voiceCloneCost != null && (
              <AppText style={styles.cloneCostCaption}>
                클로닝 시작 시 ⭐{voiceCloneCost}이 소모돼요. 실패하면 자동 환불돼요.
              </AppText>
            )}
          </TouchableOpacity>
        </View>

        {/* ── 목록 ── */}
        <AppText style={[styles.sectionTitle, { marginTop: 20, marginBottom: 8 }]}>
          내 목소리 목록
        </AppText>
        {clonesLoading && clones.length === 0 ? (
          <ActivityIndicator size="small" color={colors.accent.primary} style={{ marginTop: 16 }} />
        ) : clones.length === 0 ? (
          <AppText style={styles.emptyText}>
            아직 만든 목소리가 없어요. 위에서 내 목소리를 만들어보세요.
          </AppText>
        ) : null}

        {/* ── v3.83: 정식 클로닝 목소리 목록 (v3.102: 구 persona 목록 제거 — 클론만) ── */}
        {clones.map((c) => {
          const ready = c.status === 'ready' && !!c.voice_id;
          const awaiting = c.status === 'awaiting_verify';
          const inProgress = c.status === 'validating' || c.status === 'generating';
          const isArtist = !!c.voice_id && artistCloneId === c.voice_id;
          const tappable = awaiting || ready;
          return (
            <TouchableOpacity
              key={c.clone_id || c.voice_name}
              style={[styles.personaRow, tappable && styles.personaRowSelectable]}
              activeOpacity={tappable ? 0.7 : 1}
              onPress={() => handleCloneTap(c)}
              disabled={!tappable}
            >
              <View style={{ flex: 1 }}>
                <View style={styles.personaNameRow}>
                  <AppText style={styles.personaName} numberOfLines={1}>{c.voice_name || '(이름 없음)'}</AppText>
                  {isArtist && (
                    <View style={styles.artistBadge}>
                      <AppText style={styles.artistBadgeText}>아티스트 목소리</AppText>
                    </View>
                  )}
                  {inProgress && (
                    <View style={styles.pendingBadge}>
                      <AppText style={styles.pendingBadgeText}>처리 중</AppText>
                    </View>
                  )}
                  {awaiting && (
                    <View style={styles.awaitingBadge}>
                      <AppText style={styles.awaitingBadgeText}>검증 대기</AppText>
                    </View>
                  )}
                </View>
                {!!c.description && (
                  <AppText style={styles.personaDesc} numberOfLines={1}>{c.description}</AppText>
                )}
                <AppText style={styles.personaStatus}>
                  {CLONE_STATUS_BADGE[c.status] || `상태: ${c.status || '알 수 없음'}`}
                  {awaiting ? ' — 탭해서 검증 녹음 마저 하기' : ''}
                  {ready ? ' — 탭하면 아티스트 목소리로 설정' : ''}
                </AppText>
              </View>
              <TouchableOpacity
                style={styles.iconBtn}
                onPress={() => handleCloneDelete(c)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Feather name="trash-2" size={14} color={colors.text.primary} />
              </TouchableOpacity>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.bg.surface1,
  },
  backBtn: { width: 44, paddingHorizontal: 12, paddingVertical: 4 },
  backBtnText: { fontSize: 26, color: colors.text.primary, fontWeight: '300' },
  headerTitle: { fontSize: 16, fontWeight: '700', color: colors.text.primary },

  selectBanner: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 14,
  },
  selectBannerText: { color: colors.accent.primary, fontSize: 12, fontWeight: '600', lineHeight: 17 },

  // v3.84: 현재 아티스트 목소리 카드
  currentBox: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 14,
    padding: 14,
    marginBottom: 14,
  },
  currentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  currentText: { color: colors.text.primary, fontSize: 14, fontWeight: '700', flex: 1 },
  currentDesc: { color: colors.text.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  currentEmpty: { color: colors.text.muted, fontSize: 13 },
  clearBtn: {
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  clearBtnText: { color: colors.text.secondary, fontSize: 12, fontWeight: '600' },

  createBox: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 14,
    padding: 14,
  },
  sectionTitle: { color: colors.text.primary, fontSize: 15, fontWeight: '700', marginBottom: 4 },
  sectionDesc: { color: colors.text.muted, fontSize: 11, lineHeight: 16, marginBottom: 10 },
  // v3.83: 만들기 진입 버튼 (간편/클로닝 공용)
  wizardBtn: {
    marginTop: 8,
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 12,
    padding: 14,
  },
  wizardBtnText: { color: colors.accent.primary, fontSize: 14, fontWeight: '700' },
  wizardBtnDesc: { color: colors.text.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  // v3.106: 클로닝 비용 캡션 (조건부 — /points/costs voice_clone)
  cloneCostCaption: { color: colors.accent.primary, fontSize: 11, lineHeight: 16, marginTop: 6, fontWeight: '600' },
  createDivider: {
    height: 1,
    backgroundColor: colors.border.subtle,
    marginVertical: 14,
  },
  // v3.84: 간편(프리셋) 인라인 섹션
  presetSection: {
    marginTop: 10,
    backgroundColor: colors.bg.deepest,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    padding: 12,
  },
  presetLabel: { color: colors.text.secondary, fontSize: 12, fontWeight: '700', marginBottom: 6 },
  presetHint: { color: colors.accent.primary, fontSize: 11, lineHeight: 15, marginBottom: 6 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  presetChip: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  presetChipSelected: {
    backgroundColor: colors.accent.primary,
    borderColor: colors.accent.primary,
  },
  presetChipText: { color: colors.text.secondary, fontSize: 13 },
  presetChipTextSelected: { color: colors.text.primary, fontWeight: '700' },
  createBtn: {
    marginTop: 12,
    backgroundColor: colors.accent.primary,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
  },
  createBtnText: { color: colors.text.primary, fontSize: 14, fontWeight: '700' },

  emptyText: { color: colors.text.muted, fontSize: 13, lineHeight: 19, marginTop: 8 },
  personaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
    gap: 8,
  },
  personaRowSelectable: { borderColor: colors.accent.primary },
  personaNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  personaName: { color: colors.text.primary, fontSize: 14, fontWeight: '700', flexShrink: 1 },
  personaDesc: { color: colors.text.secondary, fontSize: 12, marginTop: 2 },
  personaStatus: { color: colors.text.muted, fontSize: 11, marginTop: 2 },
  artistBadge: {
    backgroundColor: colors.accent.primary,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  artistBadgeText: { color: colors.text.primary, fontSize: 10, fontWeight: '700' },
  pendingBadge: {
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: colors.text.muted,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  pendingBadgeText: { color: colors.text.muted, fontSize: 10, fontWeight: '700' },
  // v3.83: 검증 대기(awaiting_verify) 배지
  awaitingBadge: {
    backgroundColor: colors.bg.surface2,
    borderWidth: 1,
    borderColor: '#f59e0b',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  awaitingBadgeText: { color: '#f59e0b', fontSize: 10, fontWeight: '700' },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.bg.surface2,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
