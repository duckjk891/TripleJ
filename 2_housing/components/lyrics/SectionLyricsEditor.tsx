// [SectionLyrics] v3.281: 곡 구성(벌스·후렴·브릿지…)별 가사 편집기.
// 외부 테스터 피드백 D — "가사 전체를 텍스트박스 하나로 편집하는 건 모바일에서 너무 어렵다.
// 벌스는 각각 다른 가사, 후렴은 하나를 돌려 쓰기도 한다 → 구성별 텍스트박스 + 아코디언, 마지막에 전체 확인."
//
// - 상단 칩 줄 = 곡 구성 순서(벌스 1 · 후렴 · 벌스 2 · 브릿지 · 후렴). 탭 → 해당 카드 펼침 + 스크롤.
// - 아코디언 카드(한 번에 하나 펼침). 펼친 카드만 TextInput — 입력창이 짧아 키보드에 덜 가린다.
// - 반복 섹션(같은 내용 = linkedKey)은 "같은 후렴 n곳 함께 수정" 토글(기본 ON) — ON 이면 연결 섹션 동기.
// - [전체 보기] = 재조립된 전체 가사 읽기 전용(최종 확인) → "전체로 직접 편집" = 기존 단일 TextInput(탈출구).
// - 섹션 태그가 하나도 없으면 기존 단일 TextInput 그대로(폴백).
// - 저장/확정 로직은 화면 소유 — 이 컴포넌트는 value/onChange 만 다룬다(왕복 불변: utils/lyricsSections).
//
// 키보드: 화면 컨테이너(KAV)는 그대로 두고, (a) 펼친 입력창 높이를 제한하고 (b) 포커스 시 해당 카드를
// 뷰포트 상단 근처로 스크롤해 키보드 위에 오게 한다. 페이지 모드는 onRequestScroll(부모 ScrollView),
// 고정 높이 모드(maxHeight)는 내부 ScrollView 가 담당. keyboard-controller 의 KeyboardAwareScrollView 는
// Reanimated worklet 기반이라 웹 빌드 리스크로 사용하지 않음.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import { AppText } from '../ui';
import { colors } from '../../theme/colors';
import { spacing, radius } from '../../theme/spacing';
import {
  countLyricLines,
  joinLyricsSections,
  stripTrailingNewlines,
  linkedIndices,
  parseLyricsSections,
  updateSectionBody,
} from '../../utils/lyricsSections';

type Mode = 'sections' | 'preview' | 'raw';

export interface SectionLyricsEditorProps {
  value: string;
  onChange: (text: string) => void;
  editable?: boolean;
  /** 고정 높이 모드(작곡 대화 하단 입력 영역 등) — 카드 목록을 내부 스크롤로 */
  maxHeight?: number;
  /** 페이지 모드 — 카드 위치(편집기 루트 기준 y)로 부모 ScrollView 스크롤 요청 */
  onRequestScroll?: (y: number) => void;
  /** 폴백/전체 직접 편집용 단일 TextInput 스타일(화면 기존 스타일 유지) */
  inputStyle?: StyleProp<TextStyle>;
  placeholder?: string;
}

const PRE_ID = 'pre';
const INPUT_LINE_H = 24;

// 펼친 입력창 높이: 줄 수에 맞춰(웹 textarea 는 자동 확장이 없음) + 상한(키보드 위에 들어오게)
function sectionInputSize(body: string, bounded: boolean) {
  const max = bounded ? 150 : 260;
  const lines = Math.max(1, body.split('\n').length);
  const min = Math.min(max, Math.max(88, (lines + 1) * INPUT_LINE_H + spacing.md * 2));
  return { minHeight: min, maxHeight: max };
}

function firstLine(body: string): string {
  const l = body.split('\n').find((x) => x.trim().length > 0);
  return l ? l.replace(/\r$/, '').trim() : '';
}

export default function SectionLyricsEditor({
  value,
  onChange,
  editable = true,
  maxHeight,
  onRequestScroll,
  inputStyle,
  placeholder = '가사를 입력하세요',
}: SectionLyricsEditorProps) {
  const parsed = useMemo(() => parseLyricsSections(value || ''), [value]);
  const { preamble, sections } = parsed;
  const hasSections = sections.length > 0;
  const bounded = typeof maxHeight === 'number' && maxHeight > 0;

  // 첫 렌더 기준: 태그가 있으면 구성별, 없으면 단일 입력(폴백). 이후 입력 중 태그가 생겨도 모드를 강제 전환하지 않는다.
  const [mode, setMode] = useState<Mode>(() => (hasSections ? 'sections' : 'raw'));
  const effectiveMode: Mode = hasSections ? mode : 'raw';
  const [expandedId, setExpandedId] = useState<string | null>(() => (hasSections ? 's0' : null));
  // 반복 그룹별 동기 OFF 여부 — 그룹 대표 = 그룹 첫 섹션 id(위치 기반이라 동기 편집 중 안정)
  const [syncOff, setSyncOff] = useState<Record<string, boolean>>({});

  const preBody = useMemo(() => preamble.replace(/(?:\r?\n)+$/, ''), [preamble]);
  const showPreCard = hasSections && preBody.trim().length > 0;

  // ── 스크롤 ──
  const innerScrollRef = useRef<ScrollView>(null);
  const sectionsYRef = useRef(0); // 편집기 루트 기준 '구성별 편집' 블록 y(모드 탭 아래)
  const listYRef = useRef(0); // 그 블록 기준 카드 목록 y(칩 줄 아래)
  const cardYRef = useRef<Record<string, number>>({});
  const pendingScrollRef = useRef<string | null>(null);
  const focusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
  }, []);

  const scrollToCard = useCallback(
    (id: string) => {
      const y = cardYRef.current[id];
      if (typeof y !== 'number') return;
      if (bounded) {
        innerScrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.xs), animated: true });
      } else if (onRequestScroll) {
        onRequestScroll(sectionsYRef.current + listYRef.current + y);
      }
    },
    [bounded, onRequestScroll],
  );

  const onCardLayout = (id: string) => (e: LayoutChangeEvent) => {
    cardYRef.current[id] = e.nativeEvent.layout.y;
    if (pendingScrollRef.current === id) {
      pendingScrollRef.current = null;
      scrollToCard(id);
    }
  };

  const openCard = (id: string, via: 'chip' | 'header') => {
    if (__DEV__) console.info('[SectionLyrics] open', { id, via });
    if (expandedId === id) {
      scrollToCard(id);
      return;
    }
    pendingScrollRef.current = id;
    setExpandedId(id);
    // 레이아웃 변화가 없어 onLayout 이 안 오는 경우 대비
    setTimeout(() => {
      if (pendingScrollRef.current === id) {
        pendingScrollRef.current = null;
        scrollToCard(id);
      }
    }, 150);
  };

  const onHeaderPress = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    openCard(id, 'header');
  };

  const onInputFocus = (id: string) => {
    if (focusTimerRef.current) clearTimeout(focusTimerRef.current);
    // 키보드가 올라와 뷰포트가 줄어든 뒤 스크롤(페이지 모드). 고정 높이 모드는 바로.
    focusTimerRef.current = setTimeout(() => scrollToCard(id), bounded ? 0 : 320);
  };

  // ── 편집 ──
  // v3.284: 구간 끝에서 엔터가 안 먹던 문제 — 끝 줄바꿈이 재파싱 때 trail 로 빠져 입력창 값이 되돌아갔고,
  // 누를 때마다 구간 사이에 보이지 않는 빈 줄이 쌓였다. 입력 중 원문은 카드별 draft 로 들고,
  // 상위에는 끝 줄바꿈을 뗀 본문만 올린다(draft 는 본문이 외부에서 바뀌면 자동 무효).
  const [draft, setDraft] = useState<{ id: string; text: string } | null>(null);
  const syncLoggedRef = useRef<Set<string>>(new Set());
  const groupIdOf = (idx: number): string | null => {
    const idxs = linkedIndices(sections, idx);
    return idxs.length > 1 ? sections[idxs[0]].id : null;
  };

  const handleBodyChange = (idx: number, text: string) => {
    const gid = groupIdOf(idx);
    const sync = gid != null && !syncOff[gid];
    if (__DEV__ && sync && gid && !syncLoggedRef.current.has(gid)) {
      syncLoggedRef.current.add(gid);
      console.info('[SectionLyrics] 반복 구간 동기 편집', { group: gid, count: linkedIndices(sections, idx).length });
    }
    const next = updateSectionBody(sections, idx, text, sync);
    onChange(joinLyricsSections(preamble, next));
  };

  const handlePreambleChange = (text: string) => {
    const tail = preamble.slice(preBody.length) || '\n';
    onChange(joinLyricsSections(text ? text + tail : '', sections));
  };

  const toggleSync = (gid: string) => {
    setSyncOff((prev) => {
      const nextOff = !prev[gid];
      if (__DEV__) console.info('[SectionLyrics] 반복 구간 함께 수정', { group: gid, on: !nextOff });
      return { ...prev, [gid]: nextOff };
    });
  };

  const switchMode = (m: Mode) => {
    if (m === effectiveMode) return;
    if (__DEV__) console.info('[SectionLyrics] mode', { from: effectiveMode, to: m });
    setMode(m);
  };

  // 구조 변화 로그(섹션 수/구성 바뀔 때만)
  const structureSig = useMemo(() => sections.map((s) => s.label).join('|'), [sections]);
  useEffect(() => {
    if (!__DEV__) return;
    const groups = new Set(sections.map((s) => s.linkedKey).filter(Boolean)).size;
    console.info('[SectionLyrics] parsed', {
      sections: sections.length,
      linkedGroups: groups,
      preamble: preBody.trim().length > 0,
      structure: structureSig,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureSig]);

  // ── 렌더 ──
  const renderRawInput = () => (
    <TextInput
      style={[styles.rawInputDefault, inputStyle]}
      value={value}
      onChangeText={onChange}
      editable={editable}
      multiline
      textAlignVertical="top"
      placeholder={placeholder}
      placeholderTextColor={colors.text.muted}
    />
  );

  const renderCard = (
    id: string,
    label: string,
    hint: string,
    body: string,
    onBodyChange: (t: string) => void,
    linkedCount: number,
    groupId: string | null,
    kind: string,
  ) => {
    const open = expandedId === id;
    const lines = countLyricLines(body);
    const shown = draft && draft.id === id && stripTrailingNewlines(draft.text) === body ? draft.text : body;
    const onInputChange = (t: string) => {
      setDraft({ id, text: t });
      onBodyChange(stripTrailingNewlines(t));
    };
    const syncOn = groupId != null && !syncOff[groupId];
    return (
      <View
        key={id}
        onLayout={onCardLayout(id)}
        style={[styles.card, open && styles.cardOpen]}
      >
        <TouchableOpacity
          style={styles.cardHeader}
          activeOpacity={0.7}
          onPress={() => onHeaderPress(id)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={`${label} ${open ? '접기' : '펼치기'}`}
        >
          <View style={styles.cardHeaderLeft}>
            <AppText variant="bodyStrong" style={styles.cardLabel} numberOfLines={1}>
              {label}
            </AppText>
            {!!hint && (
              <AppText variant="caption" tone="muted" style={styles.cardHint} numberOfLines={1}>
                {hint}
              </AppText>
            )}
            {linkedCount > 1 && (
              <View style={[styles.repeatBadge, syncOn && styles.repeatBadgeOn]}>
                <AppText variant="caption" style={[styles.repeatBadgeText, syncOn && styles.repeatBadgeTextOn]}>
                  반복 {linkedCount}
                </AppText>
              </View>
            )}
          </View>
          <AppText variant="caption" tone="muted" style={styles.lineCount}>
            {lines > 0 ? `${lines}줄` : '비어 있음'}
          </AppText>
          <AppText style={[styles.chevron, open && styles.chevronOpen]}>{open ? '▾' : '▸'}</AppText>
        </TouchableOpacity>

        {!open && lines > 0 && (
          <AppText variant="footnote" tone="muted" style={styles.preview} numberOfLines={1}>
            {firstLine(body)}
          </AppText>
        )}

        {open && (
          <View style={styles.cardBody}>
            {editable ? (
              <TextInput
                style={[styles.sectionInput, sectionInputSize(shown, bounded)]}
                value={shown}
                onChangeText={onInputChange}
                onFocus={() => onInputFocus(id)}
                multiline
                scrollEnabled
                textAlignVertical="top"
                placeholder="이 구간 가사를 입력하세요"
                placeholderTextColor={colors.text.muted}
              />
            ) : (
              <AppText style={styles.sectionReadonly}>{body || ' '}</AppText>
            )}
            {editable && linkedCount > 1 && groupId && (
              <TouchableOpacity
                style={styles.syncRow}
                activeOpacity={0.7}
                onPress={() => toggleSync(groupId)}
                accessibilityRole="switch"
                accessibilityState={{ checked: syncOn }}
                accessibilityLabel={`같은 ${kind} ${linkedCount}곳 함께 수정`}
              >
                <AppText variant="footnote" tone={syncOn ? 'primary' : 'muted'} style={styles.syncText}>
                  같은 {kind} {linkedCount}곳 함께 수정
                </AppText>
                <View style={[styles.toggleTrack, syncOn && styles.toggleTrackOn]}>
                  <View style={[styles.toggleKnob, syncOn && styles.toggleKnobOn]} />
                </View>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    );
  };

  const cards = (
    <>
      {showPreCard &&
        renderCard(PRE_ID, '곡 안내', '첫 구간 앞 머리말', preBody, handlePreambleChange, 1, null, '')}
      {sections.map((s, idx) => {
        const idxs = linkedIndices(sections, idx);
        const gid = idxs.length > 1 ? sections[idxs[0]].id : null;
        return renderCard(
          s.id,
          s.label,
          s.hint,
          s.body,
          (t) => handleBodyChange(idx, t),
          idxs.length,
          gid,
          s.kind,
        );
      })}
    </>
  );

  return (
    <View style={styles.root}>
      {/* 모드 탭 — 태그가 있을 때만. 슬롯 위치 고정(아래 단일 입력창이 재마운트되지 않게) */}
      {hasSections && (
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, effectiveMode === 'sections' && styles.tabActive]}
            onPress={() => switchMode('sections')}
            accessibilityRole="tab"
            accessibilityState={{ selected: effectiveMode === 'sections' }}
          >
            <AppText variant="footnote" style={[styles.tabText, effectiveMode === 'sections' && styles.tabTextActive]}>
              구성별 편집
            </AppText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, effectiveMode !== 'sections' && styles.tabActive]}
            onPress={() => switchMode('preview')}
            accessibilityRole="tab"
            accessibilityState={{ selected: effectiveMode !== 'sections' }}
          >
            <AppText variant="footnote" style={[styles.tabText, effectiveMode !== 'sections' && styles.tabTextActive]}>
              전체 보기
            </AppText>
          </TouchableOpacity>
        </View>
      )}

      {/* 단일 입력(폴백 / 전체로 직접 편집) */}
      {effectiveMode === 'raw' && renderRawInput()}

      {/* 전체 보기(읽기 전용 최종 확인) */}
      {effectiveMode === 'preview' && (
        <View>
          {bounded ? (
            <ScrollView style={[styles.previewBox, { maxHeight }]} nestedScrollEnabled>
              <AppText style={styles.previewText} selectable>
                {value}
              </AppText>
            </ScrollView>
          ) : (
            <View style={styles.previewBox}>
              <AppText style={styles.previewText} selectable>
                {value}
              </AppText>
            </View>
          )}
          {editable && (
            <TouchableOpacity style={styles.rawButton} activeOpacity={0.7} onPress={() => switchMode('raw')}>
              <AppText variant="footnote" tone="accent" style={styles.rawButtonText}>
                전체로 직접 편집
              </AppText>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* 구성별 편집 */}
      {effectiveMode === 'sections' && (
        <View
          onLayout={(e) => {
            sectionsYRef.current = e.nativeEvent.layout.y;
          }}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.chipRow}
            style={styles.chipScroll}
          >
            {sections.map((s, i) => {
              const active = expandedId === s.id;
              return (
                <View key={s.id} style={styles.chipWrap}>
                  {i > 0 && <AppText variant="caption" tone="muted" style={styles.chipDot}>·</AppText>}
                  <TouchableOpacity
                    style={[styles.chip, active && styles.chipActive]}
                    activeOpacity={0.7}
                    onPress={() => openCard(s.id, 'chip')}
                    accessibilityLabel={`${s.label}로 이동`}
                  >
                    <AppText variant="caption" style={[styles.chipText, active && styles.chipTextActive]}>
                      {s.label}
                    </AppText>
                  </TouchableOpacity>
                </View>
              );
            })}
          </ScrollView>

          {bounded ? (
            <ScrollView
              ref={innerScrollRef}
              style={{ maxHeight }}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.list}
            >
              {cards}
            </ScrollView>
          ) : (
            <View
              style={styles.list}
              onLayout={(e) => {
                // '구성별 편집' 블록 기준 카드 목록 시작 y(칩 줄 높이 포함)
                listYRef.current = e.nativeEvent.layout.y;
              }}
            >
              {cards}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: spacing.sm,
  },
  // 모드 탭(세그먼트)
  tabs: {
    flexDirection: 'row',
    backgroundColor: colors.bg.surface1,
    borderRadius: radius.pill,
    padding: spacing.xxs,
    borderWidth: 1,
    borderColor: colors.border.subtle,
  },
  tab: {
    flex: 1,
    paddingVertical: spacing.sm - 2,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  tabActive: {
    backgroundColor: colors.bg.surface3,
  },
  tabText: {
    color: colors.text.secondary,
    fontWeight: '600',
  },
  tabTextActive: {
    color: colors.text.primary,
  },
  // 칩 줄
  chipScroll: {
    flexGrow: 0,
  },
  chipRow: {
    alignItems: 'center',
    paddingVertical: spacing.xxs,
  },
  chipWrap: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  chipDot: {
    marginHorizontal: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill,
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  chipActive: {
    backgroundColor: colors.bg.surface2,
    borderColor: colors.accent.primary,
  },
  chipText: {
    color: colors.text.secondary,
  },
  chipTextActive: {
    color: colors.text.primary,
    fontWeight: '700',
  },
  // 카드 목록
  list: {
    gap: spacing.sm,
  },
  card: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  cardOpen: {
    borderColor: colors.accent.primary,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: 44,
  },
  cardHeaderLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minWidth: 0,
  },
  cardLabel: {
    color: colors.text.primary,
    flexShrink: 0,
  },
  cardHint: {
    flexShrink: 1,
  },
  repeatBadge: {
    paddingHorizontal: spacing.sm - 2,
    paddingVertical: 1,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border.default,
  },
  repeatBadgeOn: {
    borderColor: colors.accent.primaryDim,
    backgroundColor: colors.bg.surface2,
  },
  repeatBadgeText: {
    color: colors.text.muted,
  },
  repeatBadgeTextOn: {
    color: colors.accent.primaryGlow,
  },
  lineCount: {
    marginLeft: spacing.sm,
  },
  chevron: {
    marginLeft: spacing.sm,
    color: colors.text.muted,
    fontSize: 14,
    width: 14,
    textAlign: 'center',
  },
  chevronOpen: {
    color: colors.accent.primary,
  },
  preview: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    marginTop: -spacing.xs,
  },
  cardBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  sectionInput: {
    backgroundColor: colors.bg.deepest,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: radius.md,
    padding: spacing.md,
    color: colors.text.primary,
    fontSize: 15,
    lineHeight: 24,
    minHeight: 88,
  },
  sectionReadonly: {
    color: colors.text.secondary,
    fontSize: 15,
    lineHeight: 24,
  },
  syncRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
  },
  syncText: {
    flex: 1,
    marginRight: spacing.sm,
  },
  toggleTrack: {
    width: 38,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.bg.surface3,
    padding: 2,
    justifyContent: 'center',
  },
  toggleTrackOn: {
    backgroundColor: colors.accent.primary,
  },
  toggleKnob: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.text.muted,
  },
  toggleKnobOn: {
    alignSelf: 'flex-end',
    backgroundColor: colors.text.primary,
  },
  // 전체 보기
  previewBox: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  previewText: {
    color: colors.text.secondary,
    fontSize: 15,
    lineHeight: 26,
  },
  rawButton: {
    alignSelf: 'flex-end',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    marginTop: spacing.xs,
  },
  rawButtonText: {
    fontWeight: '600',
  },
  // 단일 입력 기본 스타일(화면이 inputStyle 로 덮어씀)
  rawInputDefault: {
    backgroundColor: colors.bg.surface1,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    borderRadius: radius.lg,
    padding: spacing.md,
    color: colors.text.primary,
    fontSize: 15,
    lineHeight: 24,
    minHeight: 160,
  },
});
