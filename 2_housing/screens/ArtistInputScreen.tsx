import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  Image,
  ScrollView,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { AppText } from '../components/ui';
import { showAlert } from '../utils/appAlert';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import { BACKEND_BASE_URL } from '../services/api';
import { listArtists } from '../services/characterService';
import { hasArtistDraftProgress } from '../utils/directorResume';
import { useAuthStore } from '../stores/authStore';
import { isKidsRestrictedUser, KIDS_TEXT } from '../utils/kidsMode';
import { useCharacterTaskStore, type ArtistDraft, type ArtistPhotoIntent } from '../stores/characterTaskStore';
import { usePlayerStore } from '../stores/playerStore';
import { useOutfitStore } from '../stores/outfitStore';
import { fetchStyleSamples, resolveArtStyleLabel, type StyleSample } from '../utils/artStyle';
import { getFaceVerifyStatus } from '../services/faceVerifyService';
import { faceIdentityRoute } from '../utils/identityGate';
import GenerationJobCard from '../components/GenerationJobCard';
import { useActiveArtistJob, useUserArtistJobs } from '../stores/generationJobStore';
import { refreshRecoverable, ensureServerCapability } from '../services/generationTracker';
import { useAuthImage } from '../utils/authImage';
import { colors } from '../theme/colors';
import {
  QUESTIONS,
  EMPTY_ANSWERS,
  PHOTO_MODE_KEYS,
  PHOTO_MODE_HINT,
  PHOTO_BUBBLE_PREFIX,
  TEXT_ONLY_BUBBLE,
  REUSE_PHOTO_BUBBLE,
  questionTextFor,
  buildFinalText,
  conceptTextFrom,
  pendingFromAnswers,
  questionOf,
  toggleChip,
  inferChatQKeys,
  latestPhotoBubbleIndex,
  editBlockReason,
  beginAnswerEdit,
  commitAnswerEdit,
  derivedAfterEdit,
  resolveRestoredStep,
  type StyleAnswers,
  type StyleAnswerKey,
  type EditableChatMessage,
  type AnswerEditState,
  type ArtistStep,
} from '../utils/artistAnswerEdit';

const ARTIST_PORTRAIT = require('../assets/portraits/artist_director.png');

// v3.109: "현재 아티스트" 미리보기 카드 제거 — 이 화면은 생성(추가·재생성) 전용.
// 꾸미기 진입은 MyArtists → ArtistResult가 담당(대표 피드백: 추가 흐름에 꾸미기 노출 금지).
// v3.231 [ArtistAnswerEdit]: 질문 정의·답변 직렬화·편집 로직은 utils/artistAnswerEdit(순수 함수 — Node 하네스 검증)
type ChatMessage = EditableChatMessage;

// v3.231 A2: 'review' = 실사 최종 확인 단계(마지막 답 뒤 [의상 고르러 가기]). 가상은 화풍 단계가 같은 역할.
// Cody 취소 복귀(A3)는 실사·가상 공통으로 'review' 로 연다.
type Step = ArtistStep;

const PHOTO_REUPLOAD_BUBBLE = '이어서 만들려면 얼굴 사진을 다시 올려주세요.';
const STYLE_STEP_PROMPT = '어떤 그림체(화풍)로 그릴까요? 샘플 중에 고르거나 원하는 화풍 이미지를 직접 올려주세요.';
// v3.231 A2·A3: 확인 단계 안내(⭐ 표기 금지 — 과금은 Cody "이 옷으로 만들기" 1회)
const REVIEW_PROMPT = '답해주신 내용으로 준비됐어요! 고치고 싶은 답은 말풍선을 눌러 바꿀 수 있어요.';
const RESTORE_REVIEW_PROMPT = '의상 고르기를 멈췄어요. 고치고 싶은 답은 말풍선을 눌러 바꾸고, 준비되면 아래 버튼으로 의상을 골라주세요.';
// v3.231 A1-b: 사진 바꾸기 안내 — 사진 재업로드 안내(PHOTO_REUPLOAD_BUBBLE)와 분리
const PHOTO_CHANGE_BUBBLE = '바꿀 사진을 올려주세요. 사진 없이 설명만으로 만들 수도 있어요.';
const GO_CODY_BUBBLE = '좋아요! 이제 어떤 옷을 입혀줄지 골라볼까요?';
// v3.232 K12 [KidsGate]: 어린이 계정 = 캐릭터(가상) + 사진 없이만 — 어린이 전용 안내(성인 문구 불변)
const KIDS_GREETING = (title: string) =>
  `안녕하세요 ${title}님! 캐릭터 아티스트를 만들어볼까요? 설명을 들려주시면 그림으로 그려드릴게요.`;
const KIDS_DRAFT_DROPPED_BUBBLE =
  '어린이 계정은 사진 없이 캐릭터로만 만들 수 있어요. 이전에 하던 내용 대신 처음부터 캐릭터로 만들어볼게요.';
const KIDS_STYLE_STEP_PROMPT = '어떤 그림체(화풍)로 그릴까요? 샘플 중에 골라주세요.';
const KIDS_VIRTUAL_PICKED_BUBBLE = '좋아요! 캐릭터로 만들어드릴게요. 설명만 들려주시면 돼요. 마지막에 화풍(그림체)을 고르게 돼요.';
const KIDS_REAL_BLOCKED_MSG = '어린이 계정에서는 캐릭터 아티스트만 만들 수 있어요. 내 아티스트에서 캐릭터로 새로 만들어주세요.';

/** v3.231 A1-b: 사진 바꾸기를 그만두거나(그대로 두기) 그 도중 재시작해 멈췄던 단계로 돌아올 때 다시 보여줄 현재 안내 */
function stepPromptFor(step: Step, qIndex: number, withPhoto: boolean, restoreReview: boolean): string | null {
  if (step === 'questioning') return questionTextFor(QUESTIONS[Math.min(Math.max(qIndex, 0), QUESTIONS.length - 1)], withPhoto);
  if (step === 'review') return restoreReview ? RESTORE_REVIEW_PROMPT : REVIEW_PROMPT;
  if (step === 'style') return STYLE_STEP_PROMPT;
  return null;
}

/** v3.227 H-1: draft의 사진 사용 의도. v3.219 구 draft는 필드가 없어 마지막 선택 버블로 추론 */
function resolveDraftPhotoIntent(d: ArtistDraft): ArtistPhotoIntent {
  if (d.photoIntent !== undefined) return d.photoIntent;
  for (let i = d.chat.length - 1; i >= 0; i--) {
    const m = d.chat[i];
    if (m.type !== 'user') continue;
    if (m.text.startsWith(PHOTO_BUBBLE_PREFIX)) return 'photo';
    if (m.text === TEXT_ONLY_BUBBLE) return 'text';
  }
  return null;
}

/** v3.232 K12: 어린이 계정이 이어갈 수 없는 초안 — 실사·사진 사용 의도·[이전 사진 사용]·실사 고정 진입 */
function isKidsUnsafeArtistDraft(d: ArtistDraft): boolean {
  return (
    d.selectedKind === 'real' ||
    d.forceKind === 'real' ||
    !!d.reuseOriginalObjectName ||
    resolveDraftPhotoIntent(d) === 'photo'
  );
}

/** v3.227 H-1: 사진 재요구 시 되돌아갈 지점(사진 재업로드 후 멈췄던 단계·질문으로 복귀)
 *  v3.231 A1-b: reason='change' = 사용자가 사진 버블을 눌러 사진만 바꾸는 중(취소 가능) */
interface PhotoResumeTarget {
  step: Step;
  qIndex: number;
  reason?: 'reupload' | 'change';
}

/** v3.227 H-1(W1): [이전 사진 사용] 버튼 — 원본 썸네일은 인증 로드(authImage), 실패 시 텍스트만 */
function PrevPhotoButton({ objectName, onPress }: { objectName: string; onPress: () => void }) {
  const img = useAuthImage(objectName);
  return (
    <TouchableOpacity style={styles.reuseBtn} onPress={onPress} accessibilityLabel="이전 사진 사용">
      {img.source ? (
        <Image source={img.source} style={styles.reuseThumb} onError={img.markFailed} />
      ) : null}
      <View style={{ flex: 1 }}>
        <AppText style={styles.reuseBtnText}>이전 사진 사용</AppText>
        <AppText style={styles.reuseBtnDesc}>전에 올린 얼굴 사진으로 다시 만들어요</AppText>
      </View>
    </TouchableOpacity>
  );
}

export default function ArtistInputScreen({ navigation, route }: any) {
  const insets = useSafeAreaInsets();
  const { user } = useAuthStore();
  const titleLabel = user?.display_title || '대표';
  const taskStore = useCharacterTaskStore();
  // v3.232 K12 [KidsGate]: 어린이 계정(서버 kids_restricted) — 실사·사진·화풍 이미지·사진 바꾸기 숨김, 가상 자동 선택.
  // 성인·구서버(키 없음)는 false → 아래 모든 분기가 기존 동작 그대로.
  const isChild = isKidsRestrictedUser(user);
  // 어린이가 실사·사진 초안을 가진 경우 폐기했는지(첫 렌더에서만 기록 — 안내 버블용)
  const kidsDraftDroppedRef = useRef(false);

  // v3.81: 레거시(구 계약) 슬롯 추가 진입 시 kind 강제(같은 kind 생성=기존 덮어씀 방지).
  // v3.103(B-1): 재생성(characterId) 진입 시에도 kind 강제 — 서버가 kind 불일치 재생성을 400으로 거부.
  const forceKindParam: 'real' | 'virtual' | undefined = route?.params?.forceKind;
  // v3.103(B-1): 재생성 대상 cid — 지정 시 generate/save에 character_id 전달(기존 아티스트 갱신),
  // 미지정이면 신규 생성(슬롯 검사는 서버 409 slot_limit_exceeded가 백업)
  const regenCharacterIdParam: string | undefined = route?.params?.characterId;
  // v3.105: ArtistCody 취소 복귀 — store에 보존된 입력(컨셉·사진·화풍)을 버리지 않고 이어가기
  const restoreParam = !!route?.params?.restore;

  // v3.219 [ArtistDraft]: 마운트 시점 draft 판정 — 커버(v3.202 H-⑤) 패턴.
  // 키 검증: 재생성 진입(targetCharacterId)·forceKind가 draft와 다르면 폐기(오염 방지).
  // v3.231 A3: restore(Cody 취소 복귀)도 같은 흐름 draft면 대화를 복원해 확인 단계(review)로 연다 —
  // restore 는 라우트 키가 없으므로 store에 보존된 재생성 대상(targetCharacterId)·kind 로 대조하고,
  // 불일치해도 폐기하지 않는다(현행: 환영 + '이어서 만들기').
  const resumableDraft = useRef<ArtistDraft | null>(
    (() => {
      const st = useCharacterTaskStore.getState();
      const d = st.draft;
      if (!d) return null;
      // v3.232 K12: 어린이는 실사·사진 초안을 이어가지 않는다(사진 재요구·사진 버블 없이 가상 처음부터)
      if (isChild && isKidsUnsafeArtistDraft(d)) {
        console.info('[KidsGate] artist virtual-only — 실사·사진 초안 폐기', {
          kind: d.selectedKind, forceKind: d.forceKind, restore: restoreParam,
        });
        useCharacterTaskStore.getState().clearDraft();
        kidsDraftDroppedRef.current = true;
        return null;
      }
      if (restoreParam) {
        const cid = regenCharacterIdParam ?? st.targetCharacterId ?? null;
        const kindMismatch = !!d.selectedKind && d.selectedKind !== st.characterKind;
        if (d.targetCharacterId !== cid || kindMismatch || !hasArtistDraftProgress(d)) {
          console.info('[ArtistDraft] restore — 대화 복원 생략(다른 흐름·진행 없음)', {
            cidMatch: d.targetCharacterId === cid, kindMismatch,
          });
          return null;
        }
        return d;
      }
      const keyMismatch =
        d.targetCharacterId !== (regenCharacterIdParam ?? null) || d.forceKind !== (forceKindParam ?? null);
      if (keyMismatch) {
        if (__DEV__) {
          console.info('[ArtistDraft] 키 불일치 — draft 폐기', {
            draftCid: d.targetCharacterId, cid: regenCharacterIdParam ?? null,
            draftKind: d.forceKind, forceKind: forceKindParam ?? null,
          });
        }
        useCharacterTaskStore.getState().clearDraft();
        return null;
      }
      // 사용자 진행이 없는 draft(환영 인사만)는 복원 대상 아님
      // v3.229 [DirectorResume]: 진행 판정은 작업실 맵 바로 가기와 공용(utils/directorResume) — 규칙 불변
      if (!hasArtistDraftProgress(d)) return null;
      return d;
    })()
  ).current;
  // v3.231 A3: restore 로 draft 를 복원하면 draft 키(재생성 대상·forceKind)를 이어받는다 — 미러링이 키를 null 로
  // 덮어써 다음 진입에서 폐기되지 않게. 일반 진입은 라우트 값 그대로(현행).
  const restoredViaCody = restoreParam && !!resumableDraft;
  const forceKind: 'real' | 'virtual' | undefined =
    forceKindParam ?? (restoredViaCody ? resumableDraft!.forceKind ?? undefined : undefined);
  const regenCharacterId: string | undefined =
    regenCharacterIdParam ?? (restoredViaCody ? resumableDraft!.targetCharacterId ?? undefined : undefined);
  // v3.231 [ArtistAnswerEdit]: 구 초안 버블에 질문 키 추론(편집 대상 식별) + 복원 단계 판정
  // (restore=review, 구 초안의 '마지막 답 뒤 questioning' = review/style 로 승격 — 분위기 버블 중복 방지)
  const restoredChat: ChatMessage[] | null = resumableDraft
    ? (inferChatQKeys(resumableDraft.chat) as ChatMessage[])
    : null;
  const restoredStep: Step | null = resumableDraft
    ? resolveRestoredStep({
        step: resumableDraft.step,
        qIndex: resumableDraft.qIndex,
        chat: restoredChat!,
        selectedKind: resumableDraft.selectedKind,
        restore: restoreParam,
      })
    : null;
  const restoredAnswers: StyleAnswers | null = resumableDraft
    ? { ...EMPTY_ANSWERS, ...(resumableDraft.styleAnswers as Partial<StyleAnswers>) }
    : null;

  // v3.227 H-1 [ArtistDraft]: 사진 사용 의도 복원 + 사진 재요구 판정. 로컬 photoUri는 항상 null로
  // 시작하므로(URI 비영속) 의도='photo'로 사진 단계를 지난 draft는 사진 단계(welcome)로 되돌린다.
  // 질문 답변·qIndex·화풍 컨셉은 보존 → 재업로드 후 멈췄던 단계로 복귀. 사진 없이는 진행 불가.
  const restoredPhotoIntentRaw: ArtistPhotoIntent = resumableDraft
    ? resolveDraftPhotoIntent(resumableDraft)
    : restoreParam
      ? useCharacterTaskStore.getState().photoIntent
      : null;
  // v3.232 K12: 어린이는 사진 의도를 이어받지 않는다(사진 재요구·사진 소스 복원 없음)
  const restoredPhotoIntent: ArtistPhotoIntent =
    isChild && restoredPhotoIntentRaw === 'photo' ? null : restoredPhotoIntentRaw;
  // v3.227 W0 후속: 같은 앱 세션(서버 실패 후 재진입 등)에서 store 메모리에 사진이 남아 있으면 그 사진을
  // 그대로 이어서 쓴다 — 사진 재요구 안내를 띄우지 않는다(재요구는 파일이 실제로 사라진 경우만).
  const memoryPhoto: { uri: string; name: string } | null = (() => {
    if (restoredPhotoIntent !== 'photo') return null;
    const st = useCharacterTaskStore.getState();
    return st.photoUri ? { uri: st.photoUri, name: st.photoName || '' } : null;
  })();
  // v3.227 H-1(W1): [이전 사진 사용]으로 고른 서버 원본(텍스트 경로 — draft 영속)도 사진 소스로 인정
  const restoredReuse: string | null =
    restoredPhotoIntent === 'photo'
      ? (resumableDraft ? resumableDraft.reuseOriginalObjectName ?? null : useCharacterTaskStore.getState().reuseOriginalObjectName)
      : null;
  const initialPhotoResume: PhotoResumeTarget | null =
    resumableDraft && restoredStep && restoredPhotoIntent === 'photo' && restoredStep !== 'welcome' && !memoryPhoto && !restoredReuse
      ? { step: restoredStep, qIndex: resumableDraft.qIndex, reason: 'reupload' }
      : null;
  const [photoIntent, setPhotoIntent] = useState<ArtistPhotoIntent>(restoredPhotoIntent);
  const [photoResume, setPhotoResume] = useState<PhotoResumeTarget | null>(initialPhotoResume);

  const scrollRef = useRef<ScrollView>(null);
  const [step, setStep] = useState<Step>(
    initialPhotoResume ? 'welcome' : restoredStep ?? 'welcome'
  );
  // v3.82: forceKind 진입이어도 kind 언급 문구는 표시하지 않음(내부 로직만 유지)
  // v3.112: 신규 추가(forceKind 없음)는 실사/가상 선택부터 — 첫 인사도 선택 유도로 분기
  const [chat, setChat] = useState<ChatMessage[]>(() => {
    if (!restoredChat && isChild) {
      // v3.232 K12: 어린이 첫 인사(사진 요청·실사 선택 유도 없음) + 초안 폐기 안내
      return [
        { type: 'director', text: KIDS_GREETING(titleLabel) },
        ...(kidsDraftDroppedRef.current ? [{ type: 'director' as const, text: KIDS_DRAFT_DROPPED_BUBBLE }] : []),
      ];
    }
    if (!restoredChat) {
      return [
        {
          type: 'director',
          text: forceKind
            ? `안녕하세요 ${titleLabel}님! 아티스트의 얼굴 사진을 한 장 올려주세요.`
            : `안녕하세요 ${titleLabel}님! 어떤 아티스트를 만들까요? 실사로 만들기와 캐릭터로 만들기 중에 골라주세요.`,
        },
      ];
    }
    const base: ChatMessage[] = initialPhotoResume
      ? // v3.227 H-1: 기존 "사진 선택: …" 버블은 재업로드 안내로 치환(텍스트 답변 버블은 보존 — 인덱스 1:1)
        restoredChat.map((m) =>
          m.type === 'user' && m.text.startsWith(PHOTO_BUBBLE_PREFIX)
            ? { type: 'director' as const, text: PHOTO_REUPLOAD_BUBBLE }
            : m
        )
      : restoredChat;
    // v3.231 A2·A3: 확인 단계로 열 때 안내(직전 버블과 같으면 생략 — 반복 복귀 시 누적 방지)
    if (initialPhotoResume) return base;
    const withPrompt = (prompt: string): ChatMessage[] => {
      const last = base[base.length - 1];
      return last && last.type === 'director' && last.text === prompt
        ? base
        : [...base, { type: 'director' as const, text: prompt }];
    };
    if (restoreParam) return withPrompt(RESTORE_REVIEW_PROMPT);
    // v3.231 L3: 사진 바꾸기 도중 재시작 — 마지막 버블이 "바꿀 사진을 올려주세요…"로 남지 않게 현재 질문/안내를 다시 보여준다
    const lastMsg = base[base.length - 1];
    if (lastMsg && lastMsg.type === 'director' && lastMsg.text === PHOTO_CHANGE_BUBBLE && restoredStep) {
      const withPhotoNow = resumableDraft!.selectedKind !== 'virtual' && (!!memoryPhoto || !!restoredReuse);
      const prompt = stepPromptFor(restoredStep, resumableDraft!.qIndex, withPhotoNow, false);
      if (prompt) return withPrompt(prompt);
    }
    // 구 초안 승격(실사 마지막 답 뒤 questioning → review)
    if (restoredStep === 'review' && resumableDraft!.step !== 'review') return withPrompt(REVIEW_PROMPT);
    // 구 초안 승격(가상 마지막 답 뒤 questioning / 가상 review → style) — 화풍 질문을 다시 보여준다
    if (restoredStep === 'style' && resumableDraft!.step !== 'style') return withPrompt(isChild ? KIDS_STYLE_STEP_PROMPT : STYLE_STEP_PROMPT);
    return base;
  });

  // v3.219 [ArtistDraft]: photoUri는 draft 영속 제외(로컬 파일 URI — 재시작 후 소멸 가능).
  // 화면 이탈 복원 시에도 사진은 다시 올리는 흐름(텍스트 답변만 보존)이다.
  // v3.227 H-1: 대신 사진 사용 의도(photoIntent)를 영속해, 의도='photo'면 사진 단계를 다시 요구한다.
  const [photoUri, setPhotoUri] = useState<string | null>(memoryPhoto ? memoryPhoto.uri : null);
  const [photoName, setPhotoName] = useState<string>(memoryPhoto ? memoryPhoto.name : '');
  // v3.227 H-1(W1): [이전 사진 사용] 서버 원본 경로(사진 파일 대신 생성 Form original_object_name)
  const [reuseOriginal, setReuseOriginal] = useState<string | null>(restoredReuse);
  // [이전 사진 사용] 후보(신서버 + 본인 원본이 있을 때만 노출)
  const [prevOriginal, setPrevOriginal] = useState<string | null>(null);
  // v3.227 A-보완: 추적 중(processing·done-unsaved) 아티스트 job — 있으면 새로 만들기 대신 카드만(중복 생성 차단 ①)
  const activeJob = useActiveArtistJob();
  const userJobs = useUserArtistJobs();

  // 6단계 질문
  const [qIndex, setQIndex] = useState(resumableDraft ? resumableDraft.qIndex : 0);
  const [styleAnswers, setStyleAnswers] = useState<StyleAnswers>(restoredAnswers ?? EMPTY_ANSWERS);
  const [currentInput, setCurrentInput] = useState(resumableDraft ? resumableDraft.currentInput : '');

  // v3.231 [ArtistAnswerEdit]: 답변 수정 중 상태(비파괴 — step·qIndex·currentInput 은 그대로 두고 입력 영역만
  // 그 질문으로 바꿔 보여준다 → 완료/취소 시 자동으로 원래 진행 위치). 연쇄 편집은 대상만 교체(복귀 지점 불변).
  // 편집 상태는 영속하지 않는다 — 초안에는 원래 진행 위치만 기록(편집 중 재시작 = 미커밋 값 버림·배너 없음).
  const [answerEdit, setAnswerEdit] = useState<AnswerEditState | null>(null);
  // v3.231 A1-차단: 의상 화면 이동 대기(1초 setTimeout) 중 편집·버튼 재탭 차단
  const [leaving, setLeaving] = useState(false);
  // v3.231 A3: 확인 단계의 출처 — 'restore'(Cody 취소 복귀: 화풍·사진이 store에 보존됨 → 의상 재개) /
  // 'answers'(답변 직후: 기존 handleStartGeneration 동작 — 의상 초기화 후 Cody)
  // ('처음부터'·질문 처음부터 다시 = 새 입력이므로 'answers' 로 전환 — 이전 의상 선택이 새 시트에 섞이지 않게)
  const [reviewOrigin, setReviewOrigin] = useState<'restore' | 'answers'>(restoredViaCody ? 'restore' : 'answers');
  // v3.231: '처음부터' 이후에는 이전 입력으로 '이어서 만들기'를 다시 권하지 않는다
  const [resumeDismissed, setResumeDismissed] = useState(false);

  const [initialLoading, setInitialLoading] = useState(true);

  // v3.112(대표): 실사/가상 명시 선택 — 신규 추가(forceKind 없음)는 null로 시작해
  // welcome에서 두 선택 카드로 고른다. forceKind(재생성·레거시 빈 kind) 진입 시 고정.
  // 기존 v3.80 토글(isVirtualMode boolean)은 selectedKind 파생값으로 대체.
  const [selectedKind, setSelectedKind] = useState<'real' | 'virtual' | null>(
    // v3.232 K12: 어린이는 가상 자동 선택(실사 카드 없음)
    isChild ? 'virtual' : resumableDraft ? resumableDraft.selectedKind : forceKind ?? null
  );
  const isVirtualMode = selectedKind === 'virtual';
  const [styleSamples, setStyleSamples] = useState<StyleSample[]>([]);
  const [styleLoading, setStyleLoading] = useState(false);
  const [styleLoadError, setStyleLoadError] = useState(false);
  const [selectedPresetKey, setSelectedPresetKey] = useState<string | null>(null);
  const [styleUpload, setStyleUpload] = useState<{ uri: string; name: string } | null>(null);
  const [styleImgLoaded, setStyleImgLoaded] = useState<Record<string, boolean>>({});
  // 질문 완료 후 화풍 스텝을 거치는 동안 보관되는 컨셉 텍스트
  // v3.231: 승격·복원으로 화풍 단계를 여는데 보관 컨셉이 비어 있으면 답변으로 다시 계산
  const [pendingConceptText, setPendingConceptText] = useState(
    resumableDraft
      ? resumableDraft.pendingConceptText || (restoredStep === 'style' && restoredAnswers ? conceptTextFrom(restoredAnswers) : '')
      : ''
  );
  // v3.219 [ArtistDraft]: 복원 안내 버블(인라인 '처음부터' 액션) 노출 여부
  const [showResumeNotice, setShowResumeNotice] = useState(!!resumableDraft);

  // v3.219 [ArtistDraft]: 복원 부수 처리 — 화풍 스텝 복원이면 샘플 재로드(파일/네트워크 상태는 미보존)
  useEffect(() => {
    if (!resumableDraft) return;
    if (__DEV__) {
      console.info('[ArtistDraft] draft 복원 — 이어서 진행', {
        step: resumableDraft.step, restoredStep, qIndex: resumableDraft.qIndex, chatLen: resumableDraft.chat.length,
        photoIntent: restoredPhotoIntent,
      });
    }
    if (restoreParam) {
      // v3.231 A3: Cody 취소 복귀 — 대화 복원 + 확인 단계(의상 재개·답변 편집)
      console.info('[ArtistDraft] restore 대화 복원', {
        kind: resumableDraft.selectedKind, regen: !!resumableDraft.targetCharacterId, chatLen: resumableDraft.chat.length,
      });
    } else if (restoredStep !== resumableDraft.step) {
      console.info('[ArtistInput] 구 초안 단계 승격', { from: resumableDraft.step, to: restoredStep, qIndex: resumableDraft.qIndex });
    }
    // v3.227 H-1: 복원된 의도를 taskStore에 동기화 — ArtistLoading 생성 직전 가드가 읽는다
    if (restoredPhotoIntent) useCharacterTaskStore.getState().setInput({ photoIntent: restoredPhotoIntent });
    // v3.231: 복원된 실사/캐릭터 선택도 동기화 — 앱 재시작 후 설명만(사진 단계 생략)으로 이어가면
    // store 기본값('real')이 남아 캐릭터 초안이 실사로 생성될 수 있었다(사진 확정 경로만 kind 를 기록)
    if (resumableDraft.selectedKind && !restoreParam) {
      useCharacterTaskStore.getState().setInput({ characterKind: resumableDraft.selectedKind });
    }
    if (restoredReuse) useCharacterTaskStore.getState().setInput({ reuseOriginalObjectName: restoredReuse });
    if (restoredPhotoIntent === 'photo' && (memoryPhoto || restoredReuse)) {
      // v3.227 W0 후속: 메모리 사진·[이전 사진 사용] 원본이 있으면 사진 재요구 없이 이어서 진행
      console.info('[ArtistDraft] 사진 유지 — 재요구 생략', { memory: !!memoryPhoto, reuse: !!restoredReuse });
    }
    if (initialPhotoResume) {
      console.info('[ArtistDraft] 사진 재요구', {
        step: initialPhotoResume.step, qIndex: initialPhotoResume.qIndex, kind: resumableDraft.selectedKind,
      });
      return; // 화풍 샘플은 사진 재업로드 후 style 단계로 복귀할 때 로드
    }
    if (restoredStep === 'style') loadStyleSamples();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // v3.232 K12 [KidsGate]: 어린이 — 가상 고정·화풍 이미지 잔존값 제거, 실사 고정 진입(재생성·레거시 실사 슬롯)은 차단.
  // (isChild 가 늦게 확정돼도 다시 적용. 성인은 조건 false 로 아무것도 하지 않는다)
  useEffect(() => {
    if (!isChild) return;
    if (forceKind === 'real') {
      console.info('[KidsGate] artist virtual-only — 실사 고정 진입 차단', { regen: !!regenCharacterId });
      showAlert(KIDS_TEXT.restrictedTitle, KIDS_REAL_BLOCKED_MSG);
      navigation.goBack();
      return;
    }
    console.info('[KidsGate] artist virtual-only', { restored: !!resumableDraft, dropped: kidsDraftDroppedRef.current });
    if (selectedKind !== 'virtual') setSelectedKind('virtual');
    useCharacterTaskStore.getState().setInput({ characterKind: 'virtual', styleImageUri: null, styleImageName: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isChild]);

  // v3.219 [ArtistDraft]: 진행 대화를 store에 미러링(커버 v3.202 H-⑤ 패턴) — 사용자 진행이
  // 있을 때만 기록. 텍스트/enum만 담기므로 store persist(partialize)로 앱 재시작에도 생존.
  useEffect(() => {
    const hasProgress = chat.some((m) => m.type === 'user');
    if (!hasProgress) return;
    useCharacterTaskStore.getState().setDraft({
      // v3.227 H-1: 사진 재요구 중(welcome)에는 멈췄던 단계를 기록 — 다시 이탈해도 재업로드 후 같은 지점으로
      step: photoResume ? photoResume.step : step,
      chat,
      qIndex,
      styleAnswers: { ...styleAnswers },
      currentInput,
      selectedKind,
      pendingConceptText,
      targetCharacterId: regenCharacterId ?? null,
      forceKind: forceKind ?? null,
      photoIntent,
      reuseOriginalObjectName: reuseOriginal,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, chat, qIndex, styleAnswers, currentInput, selectedKind, pendingConceptText, photoIntent, photoResume, reuseOriginal]);

  // v3.219 [ArtistDraft]: '처음부터' — draft 폐기 후 초기 상태로(대화·답변·진행도 리셋)
  const handleRestartFromScratch = () => {
    if (__DEV__) console.info('[ArtistDraft] 처음부터 — draft 폐기·초기화');
    useCharacterTaskStore.getState().clearDraft();
    setStep('welcome');
    setChat([
      {
        type: 'director',
        text: isChild
          ? KIDS_GREETING(titleLabel) // v3.232 K12
          : forceKind
          ? `안녕하세요 ${titleLabel}님! 아티스트의 얼굴 사진을 한 장 올려주세요.`
          : `안녕하세요 ${titleLabel}님! 어떤 아티스트를 만들까요? 실사로 만들기와 캐릭터로 만들기 중에 골라주세요.`,
      },
    ]);
    setQIndex(0);
    setStyleAnswers(EMPTY_ANSWERS);
    setCurrentInput('');
    setSelectedKind(isChild ? 'virtual' : forceKind ?? null); // v3.232 K12: 어린이 = 가상 고정
    setPendingConceptText('');
    setPhotoUri(null);
    setPhotoName('');
    // v3.227 H-1: 사진 의도·재요구 지점도 초기화(처음부터 = 사진/설명 선택부터 다시)
    setPhotoIntent(null);
    setPhotoResume(null);
    setReuseOriginal(null);
    useCharacterTaskStore.getState().setInput({ photoIntent: null, reuseOriginalObjectName: null });
    setSelectedPresetKey(null);
    setStyleUpload(null);
    setShowResumeNotice(false);
    // v3.231: 편집 중이던 상태·이전 입력 '이어서 만들기' 권유도 정리
    setAnswerEdit(null);
    setResumeDismissed(true);
    setReviewOrigin('answers');
  };

  // Tab 헤더 좌측에 ← 버튼 주입 (web/모바일 공통 — Map으로 복귀)
  useLayoutEffect(() => {
    const parent = navigation.getParent();
    if (!parent) return;
    parent.setOptions({
      headerLeft: () => (
        <TouchableOpacity
          onPress={() => navigation.popTo('Map')} // v3.222: RN7 navigate 는 Map 을 새로 push — popTo 로 스택 정리
          style={{ paddingHorizontal: 12, paddingVertical: 6 }}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <AppText style={{ fontSize: 26, color: colors.text.primary, fontWeight: '300' }}>‹</AppText>
        </TouchableOpacity>
      ),
    });
    return () => {
      parent.setOptions({ headerLeft: undefined });
    };
  }, [navigation]);
  // v3.105: 작업실 화면은 미니플레이어 숨김 + 백그라운드 재생 유지(대표 방침) —
  // 하단 빈 공간(bottomLift) 대신 ArtistResult 관행(setMiniHidden)으로 통일. blur 시 복원.
  useFocusEffect(
    useCallback(() => {
      usePlayerStore.getState().setMiniHidden(true);
      if (__DEV__) console.info('[ArtistInput] 미니플레이어 숨김(focus)');
      return () => {
        usePlayerStore.getState().setMiniHidden(false);
      };
    }, [])
  );

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
  }, [chat, step]);

  // 초기: 목록 실측으로 계약 판정(multi/legacy)
  // v3.103(B-1): /character/list가 characters:[] 인데 slots.used>=1 이면 레거시(마이그레이션
  // 미실행) 계정 → 구 계약(me/save, character_id·kind 미지정)으로 생성해야 함.
  // v3.109: 미리보기 카드가 사라져 이 이펙트는 계약 판정만 수행.
  useEffect(() => {
    if (__DEV__ && (forceKind || regenCharacterId)) {
      console.info('[ArtistInput] 진입 파라미터', { forceKind, characterId: regenCharacterId ?? null });
    }
    // 재생성 대상 cid 세팅(신규 진입이면 이전 잔존값 클리어)
    // v3.105: Cody 취소 복귀(restore)면 클리어 금지 — 재생성 흐름 중 취소 시 대상 cid 보존
    if (!restoreParam) {
      useCharacterTaskStore.getState().setInput({ targetCharacterId: regenCharacterId ?? null });
    }
    if (!user) {
      setInitialLoading(false);
      return;
    }
    // v3.227 A-보완: 로컬 기록 없는 생성 결과 회수(30초 스로틀·구서버 404 무시) — welcome 카드 원천
    void refreshRecoverable({ reason: 'ArtistInput' });
    (async () => {
      try {
        const { characters, slots } = await listArtists();
        // v3.227 H-1(W1): [이전 사진 사용] 후보 — 신서버(original_object_name Form 지원)에서만.
        // 재생성 대상의 원본 우선, 없으면 대표→최근 실사 아티스트 원본.
        void (async () => {
          try {
            const cap = await ensureServerCapability();
            if (cap !== 'yes') return;
            const reals = characters.filter((c) => c.kind === 'real' && (c as any).original_photo_object_name);
            const target = regenCharacterId ? reals.find((c) => c.character_id === regenCharacterId) : undefined;
            const pick = target ?? reals.find((c) => c.is_default) ?? reals[0];
            const obj: string | null = pick ? String((pick as any).original_photo_object_name) : null;
            if (obj) setPrevOriginal((cur) => cur ?? obj);
          } catch {
            /* 후보 없음 — 버튼 미노출 */
          }
        })();
        if (characters.length > 0 || slots.used === 0) {
          // 서버 다중 체제(신규 계정 포함) — 신 계약으로 생성
          useCharacterTaskStore.getState().setInput({ legacyContract: false });
        } else {
          // 레거시 계정 — 구 계약(슬롯 면제)으로 생성/저장
          useCharacterTaskStore.getState().setInput({ legacyContract: true });
          if (__DEV__) console.info('[ArtistInput] 레거시 계정 판정 — 구 계약(me/save) 사용', { slots });
        }
      } catch (err: any) {
        // 목록 실측 실패 — 계약 판정 불가. 신 계약 기본값 유지(신규 생성은 양 계약 모두 안전)
        console.error('[ArtistInput] 아티스트 목록 로드 실패', { status: err?.response?.status, message: err?.message });
      } finally {
        setInitialLoading(false);
      }
    })();
  }, [user]);

  // v3.227 H-1(W1): 추적·회수 job의 원본(사진으로 만든 job)이 있으면 [이전 사진 사용] 후보로 우선
  useEffect(() => {
    const withOriginal = userJobs.find((j) => j.characterKind === 'real' && j.result?.original_object_name);
    const obj = withOriginal?.result?.original_object_name;
    if (!obj) return;
    ensureServerCapability().then((cap) => {
      if (cap === 'yes') setPrevOriginal(obj);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userJobs.length]);

  const pushDirector = (text: string) =>
    setChat((prev) => [...prev, { type: 'director' as const, text }]);
  // v3.231 [ArtistAnswerEdit]: 질문 답 버블은 qKey(어느 질문의 답인지)를 함께 기록 — 편집 대상 식별
  const pushUser = (text: string, qKey?: StyleAnswerKey) => {
    // v3.219 [ArtistDraft]: 이어서 답변 시작 — 복원 안내 버블 접기
    setShowResumeNotice(false);
    setChat((prev) => [...prev, qKey ? { type: 'user' as const, text, qKey } : { type: 'user' as const, text }]);
  };

  // 질문 단계 공통 진입
  const startQuestioning = () => {
    setReviewOrigin('answers'); // v3.231: 질문을 처음부터 다시 = 새 입력
    pushDirector(QUESTIONS[0].question);
    setQIndex(0);
    setStyleAnswers(EMPTY_ANSWERS);
    setCurrentInput('');
    setStep('questioning');
  };

  // v3.227 H-1: 사진 재요구 후 사진(또는 명시적 텍스트 전환)을 받으면 멈췄던 단계로 복귀.
  // 재요구 중이 아니면 기존대로 질문 처음부터. 텍스트 전환인데 답변이 하나도 없으면 처음부터
  // (텍스트 전용은 설명이 필요 — handleStartGeneration 가드와 같은 기준).
  // v3.231 A2: 확인 단계(review) 복귀 지원 — 실사는 review, 가상은 화풍(단 Cody 취소 복귀로 연 review 는 review 유지).
  const resumeOrStartQuestioning = (target: PhotoResumeTarget | null, viaTextOnly: boolean, withPhotoNow = false) => {
    setPhotoResume(null);
    if (!target || (viaTextOnly && !buildFinalText(styleAnswers).trim())) {
      startQuestioning();
      return;
    }
    if (__DEV__) console.info('[ArtistDraft] 사진 단계 통과 — 멈췄던 단계로 복귀', {
      step: target.step, qIndex: target.qIndex, viaTextOnly, reason: target.reason ?? 'reupload',
    });
    const reviewKeepsVirtual = reviewOrigin === 'restore';
    if (isVirtualMode && (target.step === 'style' || (target.step === 'review' && !reviewKeepsVirtual))) {
      // 화풍 단계 복귀 — 보관 컨셉이 비어 있으면 답변으로 다시 계산
      if (!pendingConceptText) setPendingConceptText(conceptTextFrom(styleAnswers));
      pushDirector(isChild ? KIDS_STYLE_STEP_PROMPT : STYLE_STEP_PROMPT);
      setStep('style');
      loadStyleSamples();
      return;
    }
    if (target.step === 'review' || target.step === 'style') {
      // 실사 확인 단계(화풍 단계였는데 실사로 바뀐 경우 포함) — 답변은 보존, 확인 후 의상으로
      setQIndex(QUESTIONS.length - 1);
      pushDirector(reviewOrigin === 'restore' ? RESTORE_REVIEW_PROMPT : REVIEW_PROMPT);
      setStep('review');
      return;
    }
    const qi = Math.min(target.qIndex, QUESTIONS.length - 1);
    setQIndex(qi);
    pushDirector(questionTextFor(QUESTIONS[qi], withPhotoNow && !isVirtualMode));
    setStep('questioning');
  };

  // v3.227 H-1: 사진 의도='photo'인데 사진이 없으면 사진 단계로 되돌린다(방어 — 정상 흐름에선 복원 시 이미 차단)
  // v3.227 H-1(W1): 이번 생성에 쓸 사진 소스(파일 또는 [이전 사진 사용] 서버 원본)
  const hasPhotoSource = !!photoUri || !!reuseOriginal;
  // v3.227 H-2: 외모 질문 안내 분기 — 실사 + 사진 소스가 있을 때만
  const photoQuestionMode = !isVirtualMode && hasPhotoSource;

  const requirePhotoAgain = (from: Step) => {
    console.info('[ArtistDraft] 사진 재요구', { step: from, qIndex });
    setAnswerEdit(null);
    setPhotoResume({ step: from, qIndex, reason: 'reupload' });
    pushDirector(PHOTO_REUPLOAD_BUBBLE);
    setStep('welcome');
  };

  // ── v3.231 A1-b [ArtistAnswerEdit]: 사진 버블 탭 = 사진만 바꾸기(답 보존) ─────
  // 기존 사진 재요구 메커니즘(photoResume → welcome → 사진 확정 시 멈췄던 단계로 복귀)을 재사용하되,
  // 기존 사진(photoUri·[이전 사진 사용] 원본·의도)은 새 사진이 확정될 때까지 그대로 둔다 —
  // 선택 창을 닫거나 앱을 다시 켜도 기존 사진 유지, [지금 사진 그대로 두기]로 원래 단계 복귀.
  const startPhotoChange = () => {
    if (isChild) return; // v3.232 K12: 어린이는 사진 바꾸기 없음(버블 탭 비활성 — 방어)
    console.info('[ArtistAnswerEdit] 사진 바꾸기', { step, qIndex, kind: selectedKind, hadPhoto: hasPhotoSource });
    setAnswerEdit(null);
    setShowResumeNotice(false);
    setPhotoResume({ step, qIndex, reason: 'change' });
    pushDirector(PHOTO_CHANGE_BUBBLE);
    setStep('welcome');
  };
  const cancelPhotoChange = () => {
    const target = photoResume;
    if (!target || target.reason !== 'change') return;
    console.info('[ArtistAnswerEdit] 사진 바꾸기 취소 — 기존 사진 유지', { step: target.step, qIndex: target.qIndex });
    setPhotoResume(null);
    // v3.231 L3: 멈췄던 질문/안내를 다시 보여준다(직전 버블과 같으면 생략 — 중복 버블 없음)
    const prompt = stepPromptFor(target.step, target.qIndex, photoQuestionMode, reviewOrigin === 'restore');
    if (prompt) {
      setChat((prev) => {
        const last = prev[prev.length - 1];
        return last && last.type === 'director' && last.text === prompt ? prev : [...prev, { type: 'director' as const, text: prompt }];
      });
    }
    setStep(target.step);
    if (target.step === 'style' && styleSamples.length === 0) loadStyleSamples();
  };

  // ── 사진 확정 + 얼굴인증 동의 선진행(v3.163) ─────
  // v3.230: D10(본인인증 조기 안내)은 대표 지시로 취소 — 본인인증 요구·유도 없음.
  // 사진은 즉시 확정하고, 실사면 얼굴 인증 진행 가능(faceIdentityRoute='proceed' — 서버 S3 identity_required:false
  // 또는 인증된 계정)+미동의 계정만 동의 화면(consentOnly)으로 보낸다
  // (best-effort: 조회 실패해도 입력 흐름은 계속 — 생성 시점 서버 게이트가 후방 방어).
  const acceptPhotoWithConsentPrecheck = (accept: () => void, where: 'pick' | 'reuse') => {
    accept();
    if (isVirtualMode) return;
    getFaceVerifyStatus()
      .then((st) => {
        if (st?.enabled && faceIdentityRoute(st) === 'proceed' && st.consent_needed) {
          console.info('[ArtistInput] 얼굴인증 동의 선진행 → FaceVerify(consentOnly)', { where });
          (navigation as any).navigate('FaceVerify', { consentOnly: true });
        }
      })
      .catch((err: any) => console.warn('[ArtistInput] face status 확인 실패(계속 진행)', err?.response?.status));
  };

  // ── Photo pick → 사진 확약(MAIDOL v137) → 6단계 질문 시작 ─────
  const handlePickPhoto = async () => {
    if (isChild) {
      // v3.232 K12: 버튼 숨김 — 방어
      console.info('[KidsGate] artist virtual-only — 사진 선택 차단');
      showAlert(KIDS_TEXT.restrictedTitle, KIDS_TEXT.photoBlocked);
      return;
    }
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'image/*' });
      if (!res.canceled && res.assets && res.assets[0]) {
        const file = res.assets[0];
        // v3.76: 사진 확약 — 본인/동의 확인 + 보관·비학습 고지. 미확인 시 진행 불가.
        showAlert(
          '사진 확인',
          '이 사진은 본인이거나, 사진 속 인물의 동의를 받았음을 확인해주세요.\n\n사진은 캐릭터 생성에만 사용되며 AI 학습에 쓰이지 않아요.',
          [
            { text: '취소', style: 'cancel' },
            {
              text: '확인했어요',
              onPress: () => acceptPhotoWithConsentPrecheck(() => {
                if (__DEV__) console.info('[ArtistInput] 사진 확약 완료', { name: file.name, isVirtualMode });
                setPhotoUri(file.uri);
                setPhotoName(file.name);
                setPhotoIntent('photo'); // v3.227 H-1: 사진 사용 의도 영속(draft)
                setReuseOriginal(null); // 새 사진이 [이전 사진 사용]보다 우선
                // v3.80: 실사 진입 시 characterKind:'real' 명시 (가상 모드 잔존 방지)
                taskStore.setInput({ portraitConfirmed: true, photoIntent: 'photo', reuseOriginalObjectName: null, characterKind: isVirtualMode ? 'virtual' : 'real' });
                pushUser(`${PHOTO_BUBBLE_PREFIX}${file.name}`);
                resumeOrStartQuestioning(photoResume, false, true);
                // v3.163(대표): 얼굴인증 수집·이용 동의는 "만들기" 클릭이 아니라 사진 업로드
                // 시점에 미리 — 실사+본인인증 완료+미동의 사용자만 동의 화면(consentOnly)으로.
                // v3.230: 상태 조회는 acceptPhotoWithConsentPrecheck로 통합(동작 동일 — 사진 확정 후 조회).
              }, 'pick'),
            },
          ]
        );
      }
    } catch {
      showAlert('오류', '사진을 선택하지 못했어요.');
    }
  };

  // ── v3.76(MAIDOL v161): 사진 없이 텍스트만으로 생성 ─────
  const handleTextOnly = () => {
    if (__DEV__) console.info('[ArtistInput] 텍스트-only 경로 시작', { isVirtualMode });
    setPhotoUri(null);
    setPhotoName('');
    // v3.227 H-1: 명시적 텍스트 전용 선택 — 의도 'text' 영속 + store의 이전 사진도 여기서만 비운다
    // (setInput 호출부는 사진이 있을 때만 photoUri를 갱신하므로, 잔존 사진이 텍스트 경로에 실리지 않게)
    setPhotoIntent('text');
    setReuseOriginal(null);
    // v3.80: 실사 진입 시 characterKind:'real' 명시 (가상 모드 잔존 방지)
    taskStore.setInput({
      portraitConfirmed: false,
      photoIntent: 'text',
      reuseOriginalObjectName: null,
      photoUri: null,
      photoName: null,
      characterKind: isVirtualMode ? 'virtual' : 'real',
    });
    pushUser(TEXT_ONLY_BUBBLE);
    pushDirector('좋아요! 설명만 듣고 상상해서 만들어드릴게요. 대신 조금 더 자세히 알려주세요!');
    const resumeTarget = photoResume;
    setTimeout(() => resumeOrStartQuestioning(resumeTarget, true), 400);
  };

  // ── v3.227 H-1(W1): [이전 사진 사용] — 서버에 남은 본인 원본으로 만들기(실사 전용) ─────
  // 확약 다이얼로그를 다시 띄운다(본인 사진 재확인 유지). 서버는 소유권 검증 후 같은 바이트로
  // 얼굴 인증 게이트를 그대로 수행한다(인증 우회 없음).
  const handleReusePrevPhoto = () => {
    const obj = prevOriginal;
    if (!obj || isChild) return; // v3.232 K12: 어린이는 [이전 사진 사용] 없음(버튼 숨김 — 방어)
    showAlert(
      '사진 확인',
      '이전에 올린 사진으로 만들어요. 이 사진은 본인이거나, 사진 속 인물의 동의를 받았음을 확인해주세요.\n\n사진은 캐릭터 생성에만 사용되며 AI 학습에 쓰이지 않아요.',
      [
        { text: '취소', style: 'cancel' },
        {
          text: '확인했어요',
          onPress: () => acceptPhotoWithConsentPrecheck(() => {
            console.info('[ArtistInput] 이전 사진 사용 확약', { kind: 'real' });
            setPhotoUri(null);
            setPhotoName('');
            setReuseOriginal(obj);
            setPhotoIntent('photo');
            taskStore.setInput({
              portraitConfirmed: true,
              photoIntent: 'photo',
              reuseOriginalObjectName: obj,
              photoUri: null,
              photoName: null,
              characterKind: 'real',
            });
            pushUser(REUSE_PHOTO_BUBBLE);
            resumeOrStartQuestioning(photoResume, false, true);
            // 사진 업로드 경로와 같은 얼굴인증 동의 선진행 — acceptPhotoWithConsentPrecheck가 처리
          }, 'reuse'),
        },
      ]
    );
  };

  // ── v3.112: 실사/가상 명시 선택(구 v3.80 토글 대체) ─────
  // 선택 시 characterKind를 store에 반영하고, 화풍 잔존값(이전 선택의 preset/업로드)은 클리어.
  const handleSelectKind = (kind: 'real' | 'virtual') => {
    if (isChild && kind === 'real') return; // v3.232 K12: 어린이는 실사 카드 없음(방어)
    if (__DEV__) console.info('[ArtistInput] 스타일 선택', { kind });
    setSelectedKind(kind);
    taskStore.setInput({
      characterKind: kind,
      stylePreset: null,
      styleImageUri: null,
      styleImageName: null,
    });
    if (kind === 'virtual') {
      pushUser('그림으로 만들게요');
      pushDirector(isChild ? KIDS_VIRTUAL_PICKED_BUBBLE : '좋아요! 캐릭터로 만들어드릴게요. 사진을 올리면 그 인상을 참고하고, 사진 없이 설명만으로도 만들 수 있어요. 마지막에 화풍(그림체)을 고르게 돼요.');
    } else {
      pushUser('실사로 만들게요');
      pushDirector('좋아요! 실사 스타일로 만들어드릴게요. 사진을 올리거나, 사진 없이 설명만으로 시작할 수 있어요.');
    }
  };

  // v3.112: 선택 되돌리기 — forceKind 진입에서는 노출되지 않음(kind 고정)
  const handleResetKind = () => {
    if (__DEV__) console.info('[ArtistInput] 스타일 다시 선택');
    setSelectedKind(null);
    pushUser('다른 스타일로 바꿀래요');
    pushDirector('네! 실사로 만들기와 캐릭터로 만들기 중에 다시 골라주세요.');
  };

  // ── v3.80: 화풍 샘플 로드 (무인증·무비용 GET) ─────
  const loadStyleSamples = async () => {
    setStyleLoading(true);
    setStyleLoadError(false);
    try {
      const samples = await fetchStyleSamples();
      setStyleSamples(samples);
      if (samples.length === 0) setStyleLoadError(true);
    } catch (err: any) {
      console.error('[ArtistInput] style-samples 로드 실패', { status: err?.response?.status, message: err?.message });
      setStyleLoadError(true);
    } finally {
      setStyleLoading(false);
    }
  };

  // v3.80: 화풍 직접 업로드 — 샘플 선택과 상호 배타
  const handlePickStyleImage = async () => {
    if (isChild) {
      // v3.232 K12: 화풍 이미지 업로드 버튼 숨김 — 방어
      console.info('[KidsGate] artist virtual-only — 화풍 이미지 업로드 차단');
      showAlert(KIDS_TEXT.restrictedTitle, KIDS_TEXT.photoBlocked);
      return;
    }
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: 'image/*' });
      if (!res.canceled && res.assets && res.assets[0]) {
        const file = res.assets[0];
        if (__DEV__) console.info('[ArtistInput] 화풍 이미지 업로드 선택', { name: file.name });
        setStyleUpload({ uri: file.uri, name: file.name });
        setSelectedPresetKey(null);
      }
    } catch {
      showAlert('오류', '이미지를 선택하지 못했어요.');
    }
  };

  // v3.80: 화풍 확정 → 코디 선택 화면으로 (기존 실사 흐름과 동일 진입점)
  const handleStyleConfirm = () => {
    if (!selectedPresetKey && !styleUpload) {
      showAlert('알림', isChild ? '화풍을 하나 골라주세요.' : '화풍을 하나 골라주세요. 샘플 중에 고르거나 이미지를 직접 올릴 수 있어요.');
      return;
    }
    // v3.227 H-1: 사진 의도인데 사진(또는 [이전 사진 사용] 원본)이 없으면 진행 불가 — 사진 단계로
    if (photoIntent === 'photo' && !hasPhotoSource) {
      requirePhotoAgain('style');
      return;
    }
    if (leaving) return;
    if (__DEV__) console.info('[ArtistInput] 화풍 확정', { preset: selectedPresetKey, upload: styleUpload?.name });
    pushUser(
      styleUpload
        ? `화풍 이미지: ${styleUpload.name}`
        : `화풍: ${resolveArtStyleLabel(selectedPresetKey, styleSamples)}`
    );
    pushDirector('좋아요! 이제 어떤 옷을 입혀줄지 골라볼까요?');

    // 새 시트 → 이전 캐릭터의 outfit 정보는 폐기
    useOutfitStore.getState().clear();
    // v3.227 H-1: photoUri/photoName은 사진이 있을 때만 갱신(null 덮어쓰기 금지 — 사진 소실 회귀)
    taskStore.setInput({
      ...(photoUri ? { photoUri, photoName } : {}),
      ...(!photoUri && reuseOriginal ? { reuseOriginalObjectName: reuseOriginal } : {}),
      photoIntent,
      userText: pendingConceptText,
      conceptText: pendingConceptText, // v3.105: 취소/실패 복원용 순수 컨셉 보존
      stylePreset: styleUpload ? null : selectedPresetKey,
      styleImageUri: styleUpload?.uri ?? null,
      styleImageName: styleUpload?.name ?? null,
      // v3.231 A1-파생: 성별·이름·나이도 확정 시점 답으로(초안 복원으로 화풍 단계에 들어온 경우 pending 이 비어 있었음)
      ...pendingFromAnswers(styleAnswers),
    });

    setLeaving(true); // v3.231 A1-차단: 이동 대기 중 편집·재탭 차단
    setAnswerEdit(null);
    setTimeout(() => {
      navigation.replace('ArtistCody', { mode: 'sheet' });
    }, 1000);
  };

  const handleChipTap = (chip: string) => {
    setCurrentInput((prev) => toggleChip(prev, chip));
  };

  const handleAnswerNext = (skip: boolean) => {
    const q = QUESTIONS[qIndex];
    const answer = skip ? '' : currentInput.trim();
    const newAnswers: StyleAnswers = { ...styleAnswers, [q.key]: answer };
    setStyleAnswers(newAnswers);

    // v3.231 [ArtistAnswerEdit]: 답 버블에 질문 키 기록(생략 버블 포함)
    if (answer) pushUser(answer, q.key);
    else pushUser(`(${q.short} 생략)`, q.key);

    if (qIndex + 1 < QUESTIONS.length) {
      const next = QUESTIONS[qIndex + 1];
      setTimeout(() => pushDirector(questionTextFor(next, photoQuestionMode)), 150);
      setQIndex(qIndex + 1);
      setCurrentInput('');
    } else {
      // 마지막 질문 → 만들기 단계로 진입
      handleStartGeneration(newAnswers);
    }
  };

  // ── 컨셉 입력 완료 → (실사) 확인 단계 / (가상) 화풍 단계 ─────
  // (기본 착장 프롬프트 제거. 옷은 ArtistCody에서 선택, 미선택 시 디폴트 fallback)
  // v3.231 A2: 실사는 마지막 답과 동시에 의상 화면으로 넘기지 않고 확인 단계(review)에서 [의상 고르러 가기]로 —
  // 파생 값 설정·의상 초기화·Cody 이동은 버튼(goToCodyFromReview)이 수행(동작 동일, 시점만 버튼으로).
  const handleStartGeneration = (answers: StyleAnswers) => {
    const userInput = buildFinalText(answers);
    // v3.227 H-1: 사진 의도인데 사진(또는 [이전 사진 사용] 원본)이 없으면 진행 불가 — 사진 단계로(답변은 보존)
    if (photoIntent === 'photo' && !hasPhotoSource) {
      // v3.231: 복귀 지점 = 실사 확인 단계 / 가상 화풍 단계(마지막 질문 재질문 → 분위기 버블 중복 방지)
      requirePhotoAgain(isVirtualMode ? 'style' : 'review');
      return;
    }
    // v3.76: 텍스트-only 경로(사진 없음)에서는 설명이 최소 하나는 필요
    if (!hasPhotoSource && !userInput.trim()) {
      showAlert('알림', '사진이 없으면 설명이 필요해요. 질문에 하나 이상 답해주세요.');
      startQuestioning();
      return;
    }

    // v3.80: 가상화 모드는 화풍 선택 스텝을 거친 뒤 ArtistCody로 (handleStyleConfirm에서 진행)
    if (isVirtualMode) {
      // 캐릭터 컨셉 텍스트만 저장. 의상은 다음 화면에서 결정.
      // v3.82: 성별 답변 보관 — 생성 성공 시(ArtistLoading) 슬롯별 프로필에 기록
      // v3.109: 이름 답변 보관 — 생성 성공 시 save의 name 필드로 서버 영속(스킵=null → 기본 명명)
      // v3.164: 나이 서버 영속
      taskStore.setInput(pendingFromAnswers(answers));
      setPendingConceptText(conceptTextFrom(answers));
      pushDirector(isChild ? KIDS_STYLE_STEP_PROMPT : STYLE_STEP_PROMPT);
      setStep('style');
      loadStyleSamples();
      return;
    }

    console.info('[ArtistInput] review 진입', { kind: 'real', photo: hasPhotoSource });
    setTimeout(() => pushDirector(REVIEW_PROMPT), 150);
    setCurrentInput('');
    setStep('review');
  };

  // ── v3.231 A2·A3: 확인 단계 [의상 고르러 가기] ─────
  // 답변 직후(answers): 기존 handleStartGeneration 실사 분기 그대로 — 파생 값·컨셉 저장, 의상 초기화, 1초 뒤 Cody.
  // Cody 취소 복귀(restore): 기존 handleResume(의상 선택·화풍 보존 재개) — 편집·사진 바꾸기 결과만 store에 반영.
  const goToCodyFromReview = () => {
    if (leaving) return;
    // v3.227 H-1: 사진 의도인데 사진(또는 [이전 사진 사용] 원본)이 없으면 진행 불가 — 사진 단계로(답변은 보존)
    if (photoIntent === 'photo' && !hasPhotoSource) {
      requirePhotoAgain('review');
      return;
    }
    const userInput = buildFinalText(styleAnswers);
    if (!hasPhotoSource && !userInput.trim()) {
      showAlert('설명이 필요해요', '사진 없이 만들 때는 한 가지 이상 답해주세요.');
      return;
    }
    const conceptText = conceptTextFrom(styleAnswers);
    // v3.105: conceptText = 취소/실패 복원용 순수 컨셉 (Cody가 userText를 의상 desc와 합쳐 덮어씀)
    // v3.227 H-1: photoUri/photoName은 사진이 있을 때만 갱신(null 덮어쓰기 금지 — 사진 소실 회귀)
    taskStore.setInput({
      ...pendingFromAnswers(styleAnswers),
      ...(photoUri ? { photoUri, photoName } : {}),
      ...(!photoUri && reuseOriginal ? { reuseOriginalObjectName: reuseOriginal } : {}),
      photoIntent,
      userText: conceptText,
      conceptText,
    });
    setAnswerEdit(null);
    setLeaving(true);
    if (reviewOrigin === 'restore') {
      console.info('[ArtistInput] 의상 이동', { origin: 'restore', kind: selectedKind });
      navigation.replace('ArtistCody', { mode: 'sheet' });
      return;
    }
    console.info('[ArtistInput] 의상 이동', { origin: 'answers', kind: selectedKind });
    pushDirector(GO_CODY_BUBBLE);
    // 새 시트 → 이전 캐릭터의 outfit 정보는 폐기
    useOutfitStore.getState().clear();
    setTimeout(() => {
      // 옷 선택 화면으로. mode='sheet' 전달 → ArtistCody가 초기 생성 분기로 동작.
      navigation.replace('ArtistCody', { mode: 'sheet' });
    }, 1000);
  };

  // ── v3.231 A1 [ArtistAnswerEdit]: 답변 편집(작곡 디렉터 비파괴 방식) ─────
  const blockReason = editBlockReason({
    initialLoading,
    hasActiveJob: !!activeJob,
    photoResume: !!photoResume,
    leaving,
    step,
  });
  // v3.232 K12: 어린이는 사진 바꾸기 없음 — 사진/설명 선택 버블은 편집 대상이 아니다(-1 = 없음)
  const photoBubbleIdx = isChild ? -1 : latestPhotoBubbleIndex(chat);

  const handleUserBubbleTap = (idx: number) => {
    const msg = chat[idx];
    if (!msg || msg.type !== 'user') return;
    const isPhotoBubble = idx === photoBubbleIdx;
    if (!msg.qKey && !isPhotoBubble) return; // 실사/캐릭터 선택·화풍 버블 — 편집 대상 아님
    if (blockReason) {
      console.info(`[ArtistAnswerEdit] 거부 reason=${blockReason}`, { idx });
      return;
    }
    if (isPhotoBubble) {
      showAlert('사진을 바꿀까요?', '답해둔 내용은 그대로 두고 사진만 다시 골라요.', [
        { text: '취소', style: 'cancel' },
        { text: '사진 바꾸기', onPress: startPhotoChange },
      ]);
      return;
    }
    const next = beginAnswerEdit(chat, idx, styleAnswers);
    if (!next) return;
    // v3.219 규칙(작곡 동일): 답변 수정 시작도 "이어서" — 복원 안내 접기
    setShowResumeNotice(false);
    // 연쇄 편집: 이전 편집의 미커밋 값은 버리고 대상만 바꾼다(진행 위치는 원래 값 그대로라 복귀 지점 불변)
    console.info('[ArtistAnswerEdit] 열기', {
      key: next.qKey, idx, step, qIndex, len: next.input.length, chained: !!answerEdit,
    });
    setAnswerEdit(next);
  };

  const cancelAnswerEdit = () => {
    if (!answerEdit) return;
    console.info('[ArtistAnswerEdit] 취소', { key: answerEdit.qKey, step, qIndex });
    setAnswerEdit(null);
  };

  const commitEdit = (clear: boolean) => {
    if (!answerEdit) return;
    const edit = clear ? { ...answerEdit, input: '' } : answerEdit;
    const res = commitAnswerEdit({ chat, answers: styleAnswers, edit, hasPhotoSource });
    if (!res.ok) {
      console.info(`[ArtistAnswerEdit] 거부 reason=${res.reason === 'empty-without-photo' ? 'empty' : res.reason}`, {
        key: edit.qKey,
      });
      if (res.reason === 'empty-without-photo') {
        showAlert('설명이 필요해요', '사진 없이 만들 때는 한 가지 이상 답해주세요.');
      } else {
        setAnswerEdit(null); // 대화가 바뀌어 대상이 사라짐 — 편집 닫기
      }
      return; // 거부(설명 필요) 시 편집 화면은 유지 — 다른 값을 넣거나 [취소]
    }
    setAnswerEdit(null);
    if (!res.changed) {
      console.info('[ArtistAnswerEdit] 커밋(변경 없음)', { key: edit.qKey });
      return;
    }
    setStyleAnswers(res.answers);
    setChat(res.chat);
    console.info('[ArtistAnswerEdit] 커밋', { key: edit.qKey, len: res.answers[edit.qKey].length, step, qIndex });
    const derived = derivedAfterEdit({ step, answers: res.answers });
    if (derived.store) taskStore.setInput(derived.store);
    if (derived.pendingConceptText !== undefined) setPendingConceptText(derived.pendingConceptText);
    if (derived.store || derived.pendingConceptText !== undefined) {
      console.info('[ArtistAnswerEdit] 파생 재계산', {
        step,
        keys: [...Object.keys(derived.store ?? {}), ...(derived.pendingConceptText !== undefined ? ['pendingConceptText'] : [])],
      });
    }
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyBox}>
          <AppText style={styles.emptyTitle}>로그인이 필요해요</AppText>
          <AppText style={styles.emptyDesc}>아티스트 디렉터와 함께 나만의 아티스트를 만들어보세요!</AppText>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.getParent()?.navigate('Settings')}
          >
            <AppText style={styles.primaryBtnText}>로그인하기</AppText>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (initialLoading) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyBox}>
          <ActivityIndicator size="large" color={colors.accent.primary} />
        </View>
      </View>
    );
  }

  // v3.105: 이어서 만들기 — Cody 취소(restore) 또는 직전 생성 실패(apiError) 시
  // store에 보존된 컨셉/사진/화풍으로 의상 선택부터 재개 (입력 데이터 보존 — 대표 지적)
  // v3.227 H-1: 사진 의도인데 store에 사진이 없으면 숨김 — 의상 단계로 건너뛰면 사진 없이 생성된다
  const resumeMissingPhoto = photoIntent === 'photo' && !taskStore.photoUri && !taskStore.reuseOriginalObjectName;
  // v3.231: 사진 바꾸기·재요구 중(photoResume)·'처음부터' 이후에는 이전 입력 재개 버튼을 숨긴다(이전 사진으로 새는 것 방지)
  // v3.232 K12: 어린이는 가상·사진 없는 입력만 이어서 만들기(실사·사진 입력이 남은 store 는 재개 안 함)
  const kidsResumeBlocked =
    isChild &&
    (taskStore.characterKind !== 'virtual' || taskStore.photoIntent === 'photo' || !!taskStore.photoUri ||
      !!taskStore.reuseOriginalObjectName || !!taskStore.styleImageUri);
  const canResume =
    (restoreParam || !!taskStore.apiError) && !!(taskStore.conceptText || taskStore.userText) && !resumeMissingPhoto &&
    !photoResume && !resumeDismissed && !kidsResumeBlocked;
  const handleResume = () => {
    if (__DEV__) console.info('[ArtistInput] 이어서 만들기 — 의상 선택 재개', {
      restoreParam, hadError: !!taskStore.apiError,
    });
    navigation.replace('ArtistCody', { mode: 'sheet' });
  };

  const renderInputArea = () => {
    // v3.227 A-보완 중복 생성 차단 ①: 추적 중(만드는 중·저장 안 한 완성본)이면 새로 만들기 대신 추적 카드만
    if (activeJob) {
      return (
        <View style={styles.inputArea}>
          <GenerationJobCard navigation={navigation} />
          <AppText style={styles.textOnlyHint}>
            {activeJob.lastStatus === 'processing'
              ? '이미 아티스트를 만드는 중이에요. 완성된 뒤에 새로 만들 수 있어요.'
              : '완성된 아티스트를 먼저 확인해주세요. 저장하거나 닫으면 새로 만들 수 있어요.'}
          </AppText>
        </View>
      );
    }
    // v3.231 A1 [ArtistAnswerEdit]: 답변 수정 입력 영역 — 그 질문의 칩·입력칸을 기존 답으로 연다(디렉터 버블 추가 없음)
    if (answerEdit) {
      const q = questionOf(answerEdit.qKey);
      const tokens = answerEdit.input.split(',').map((t) => t.trim()).filter(Boolean);
      return (
        <View style={styles.inputArea}>
          <View style={styles.qProgress}>
            <AppText style={styles.qProgressText}>수정 중 · {q.short}</AppText>
            {photoQuestionMode && PHOTO_MODE_KEYS.has(q.key) ? (
              <AppText style={styles.editPhotoHint}>{PHOTO_MODE_HINT}</AppText>
            ) : null}
          </View>
          {q.chips.length > 0 && (
            <View style={styles.chipsRow}>
              {q.chips.map((chip) => {
                const sel = tokens.includes(chip);
                return (
                  <TouchableOpacity
                    key={chip}
                    style={[styles.chip, sel && styles.chipSelected]}
                    onPress={() => setAnswerEdit((cur) => (cur ? { ...cur, input: toggleChip(cur.input, chip) } : cur))}
                  >
                    <AppText style={[styles.chipText, sel && styles.chipTextSelected]}>{chip}</AppText>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
          <TextInput
            style={styles.textInput}
            value={answerEdit.input}
            onChangeText={(t) => setAnswerEdit((cur) => (cur ? { ...cur, input: t } : cur))}
            placeholder={q.placeholder}
            placeholderTextColor={colors.text.muted}
            multiline
          />
          <View style={styles.twoBtnRow}>
            <TouchableOpacity style={styles.skipBtn} onPress={() => commitEdit(true)}>
              <AppText style={styles.skipBtnText}>비우기(건너뛰기)</AppText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyBtn} onPress={() => commitEdit(false)}>
              <AppText style={styles.applyBtnText}>수정 완료</AppText>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    if (step === 'welcome') {
      // v3.81: "이미 아티스트가 있어요" 교체 게이트 제거 — 진입 관리는 MyArtists가 담당.
      // 이 화면은 항상 생성 UI (Map 미보유 경로·MyArtists 경유 진입 모두 welcome부터).
      return (
        <View style={styles.inputArea}>
          {/* v3.227: 실패·환불 안내 등 추적 카드(차단 대상이 아닌 것만 — 차단 대상은 위에서 처리) */}
          <GenerationJobCard navigation={navigation} />
          {canResume && (
            <TouchableOpacity style={styles.resumeBtn} onPress={handleResume}>
              <AppText style={styles.resumeBtnText}>이어서 만들기 — 입력해둔 내용으로 의상 선택</AppText>
              <AppText style={styles.resumeBtnDesc} numberOfLines={2}>
                {taskStore.conceptText || taskStore.userText}
              </AppText>
            </TouchableOpacity>
          )}
          {/* v3.112(대표): 실사/가상 선택을 명시 노출 — 신규 추가(forceKind 없음)는
              두 선택 카드부터. 선택(또는 forceKind 고정) 후에 사진/텍스트-only 버튼 표시. */}
          {selectedKind === null ? (
            <>
              {!isChild && (
              <TouchableOpacity style={styles.kindCard} onPress={() => handleSelectKind('real')}>
                <AppText style={styles.kindCardTitle}>실사로 만들기</AppText>
                <AppText style={styles.kindCardDesc}>사진 또는 설명으로 실제 사람 같은 아티스트를 만들어요</AppText>
              </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.kindCard} onPress={() => handleSelectKind('virtual')}>
                <AppText style={styles.kindCardTitle}>캐릭터로 만들기</AppText>
                <AppText style={styles.kindCardDesc}>원하는 화풍(그림체)을 골라 캐릭터 아티스트를 만들어요</AppText>
              </TouchableOpacity>
            </>
          ) : (
            <>
              {/* v3.232 K12: 어린이는 사진 올리기·이전 사진 사용 없음(사진 없이 만들기만) */}
              {!isChild && (
              <TouchableOpacity style={styles.primaryBtn} onPress={handlePickPhoto}>
                <AppText style={styles.primaryBtnText}>사진 올리기</AppText>
              </TouchableOpacity>
              )}
              {/* v3.227 H-1(W1): [이전 사진 사용] — 실사 + 신서버 + 본인 원본이 있을 때만 */}
              {!isChild && !isVirtualMode && prevOriginal && (
                <PrevPhotoButton objectName={prevOriginal} onPress={handleReusePrevPhoto} />
              )}
              {/* v3.76(MAIDOL v161): 텍스트-only 경로 — 사진 없이 설명만으로 생성 */}
              <TouchableOpacity style={styles.textOnlyBtn} onPress={handleTextOnly}>
                <AppText style={styles.textOnlyBtnText}>사진 없이 만들기</AppText>
              </TouchableOpacity>
              {/* v3.231 A1-b: 사진 바꾸기 중 — 기존 사진(또는 설명만) 그대로 원래 단계로 */}
              {photoResume?.reason === 'change' && (
                <TouchableOpacity style={styles.textOnlyBtn} onPress={cancelPhotoChange}>
                  <AppText style={styles.textOnlyBtnText}>지금 사진 그대로 두기</AppText>
                </TouchableOpacity>
              )}
              {/* v3.112: 선택 되돌리기 — forceKind(재생성·레거시) 진입 시 숨김(kind 강제 유지)
                  v3.231 D2: 사진 바꾸기 중에는 숨김(실사↔캐릭터 전환은 '처음부터'로만) */}
              {!isChild && !forceKind && photoResume?.reason !== 'change' && (
                <TouchableOpacity style={styles.kindResetBtn} onPress={handleResetKind}>
                  <AppText style={styles.kindResetBtnText}>
                    {isVirtualMode ? '그림 선택됨 — 다시 고르기' : '실사 선택됨 — 다시 고르기'}
                  </AppText>
                </TouchableOpacity>
              )}
              {isChild && (
                <AppText style={styles.textOnlyHint}>사진 없이 설명만으로 캐릭터 아티스트를 만들어요.</AppText>
              )}
              {!isChild && (
              <AppText style={styles.textOnlyHint}>
                {photoResume?.reason === 'change'
                  ? '새 사진을 올리면 답해둔 내용 그대로 멈췄던 곳부터 이어서 진행해요.'
                  : photoResume
                  ? '올려두었던 사진은 다시 올려야 해요. 사진을 올리면 멈췄던 질문부터 이어서 진행해요.'
                  : isVirtualMode
                  ? '캐릭터로 만들기: 위 버튼으로 사진을 올리거나, 사진 없이 시작하세요.'
                  : '사진 없이 설명만으로 아티스트를 만들 수도 있어요.'}
              </AppText>
              )}
            </>
          )}
        </View>
      );
    }
    // v3.80: 가상화 모드 — 화풍 선택 스텝
    if (step === 'style') {
      return (
        <View style={styles.inputArea}>
          <View style={styles.qProgress}>
            <AppText style={styles.qProgressText}>화풍 선택 · 그림체를 골라주세요</AppText>
          </View>
          {styleLoading ? (
            <View style={{ paddingVertical: 24, alignItems: 'center' }}>
              <ActivityIndicator size="large" color={colors.accent.primary} />
              <AppText style={styles.styleLoadingText}>화풍 샘플을 불러오는 중...</AppText>
            </View>
          ) : styleLoadError ? (
            <View style={{ paddingVertical: 12, alignItems: 'center' }}>
              <AppText style={styles.styleErrorText}>화풍 샘플을 불러오지 못했어요.</AppText>
              <TouchableOpacity style={styles.retryBtn} onPress={loadStyleSamples}>
                <AppText style={styles.retryBtnText}>다시 시도</AppText>
              </TouchableOpacity>
            </View>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {styleSamples.map((s) => {
                const sel = selectedPresetKey === s.key;
                const loaded = !!styleImgLoaded[s.key];
                return (
                  <TouchableOpacity
                    key={s.key}
                    style={[styles.styleCard, sel && styles.styleCardSelected]}
                    onPress={() => {
                      // 샘플 선택 ↔ 직접 업로드 상호 배타
                      setSelectedPresetKey(s.key);
                      setStyleUpload(null);
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={styles.styleCardImgWrap}>
                      <Image
                        source={{ uri: `${BACKEND_BASE_URL}${s.preview_url}` }}
                        style={styles.styleCardImg}
                        onLoadEnd={() => setStyleImgLoaded((prev) => ({ ...prev, [s.key]: true }))}
                      />
                      {!loaded && (
                        <View style={styles.styleCardImgLoading}>
                          <ActivityIndicator size="small" color={colors.accent.primary} />
                        </View>
                      )}
                    </View>
                    <AppText style={[styles.styleCardLabel, sel && styles.styleCardLabelSelected]}>
                      {s.label}
                    </AppText>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
          {/* v3.232 K12: 어린이는 화풍 이미지 직접 업로드 없음(프리셋만) */}
          {!isChild && (
          <TouchableOpacity
            style={[styles.styleUploadBtn, styleUpload && styles.styleUploadBtnActive]}
            onPress={handlePickStyleImage}
          >
            <AppText style={[styles.styleUploadBtnText, styleUpload && styles.styleUploadBtnTextActive]}>
              {styleUpload ? `업로드됨: ${styleUpload.name}` : '화풍 이미지 직접 업로드'}
            </AppText>
          </TouchableOpacity>
          )}
          {/* v3.109: 세로 잘림 재수정 — flex:0(웹에서 flex-basis 압축) 대신 grow/shrink만 끄고
              minHeight 확보(applyBtn 공통). 높이는 내용대로(auto) 유지된다. */}
          <TouchableOpacity
            style={[styles.applyBtn, styles.styleConfirmBtn, !selectedPresetKey && !styleUpload && { opacity: 0.5 }]}
            onPress={handleStyleConfirm}
          >
            <AppText style={styles.applyBtnText}>이 화풍으로 만들기</AppText>
          </TouchableOpacity>
        </View>
      );
    }
    // v3.231 A2·A3: 확인 단계 — 답변 편집(말풍선 탭) 후 [의상 고르러 가기](과금 아님 — ⭐ 표기 없음)
    if (step === 'review') {
      return (
        <View style={styles.inputArea}>
          <View style={styles.qProgress}>
            <AppText style={styles.qProgressText}>마지막 확인 · 고칠 답은 말풍선을 눌러주세요</AppText>
          </View>
          <TouchableOpacity
            style={[styles.primaryBtn, leaving && { opacity: 0.5 }]}
            onPress={goToCodyFromReview}
            disabled={leaving}
          >
            <AppText style={styles.primaryBtnText}>의상 고르러 가기</AppText>
          </TouchableOpacity>
        </View>
      );
    }
    if (step === 'questioning') {
      const q = QUESTIONS[qIndex];
      const isLast = qIndex === QUESTIONS.length - 1;
      const tokens = currentInput.split(',').map((t) => t.trim()).filter(Boolean);
      return (
        <View style={styles.inputArea}>
          <View style={styles.qProgress}>
            <AppText style={styles.qProgressText}>
              {qIndex + 1} / {QUESTIONS.length} · {q.short}
            </AppText>
          </View>
          {/* v3.109: 칩 없는 질문(이름 등)은 칩 영역 자체를 생략 */}
          {q.chips.length > 0 && (
          <View style={styles.chipsRow}>
            {q.chips.map((chip) => {
              const sel = tokens.includes(chip);
              return (
                <TouchableOpacity
                  key={chip}
                  style={[styles.chip, sel && styles.chipSelected]}
                  onPress={() => handleChipTap(chip)}
                >
                  <AppText style={[styles.chipText, sel && styles.chipTextSelected]}>{chip}</AppText>
                </TouchableOpacity>
              );
            })}
          </View>
          )}
          <TextInput
            style={styles.textInput}
            value={currentInput}
            onChangeText={setCurrentInput}
            placeholder={q.placeholder}
            placeholderTextColor={colors.text.muted}
            multiline
          />
          <View style={styles.twoBtnRow}>
            <TouchableOpacity style={styles.skipBtn} onPress={() => handleAnswerNext(true)}>
              <AppText style={styles.skipBtnText}>건너뛰기</AppText>
            </TouchableOpacity>
            <TouchableOpacity style={styles.applyBtn} onPress={() => handleAnswerNext(false)}>
              {/* v3.231 A2: 마지막 답 뒤에는 확인 단계(실사)·화풍 단계(가상)로 — 바로 만들지 않음 */}
              <AppText style={styles.applyBtnText}>{isLast ? '답변 완료' : '다음'}</AppText>
            </TouchableOpacity>
          </View>
        </View>
      );
    }
    return null;
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 140 : 80}
    >
      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16 }}
      >
        {/* v3.109: "현재 아티스트"/꾸미기 카드 제거 — 추가·재생성 흐름 모두 생성 UI만 표시.
            꾸미기는 MyArtists → ArtistResult 경로가 담당(기능 무변경). */}
        {chat.map((msg, idx) => {
          // v3.231 [ArtistAnswerEdit]: 질문 답 버블 = "탭해서 수정", 최근 사진/설명 선택 버블 = "탭해서 사진 바꾸기"
          // (편집 차단 중에는 힌트 없음. 실사/캐릭터 선택·화풍 버블은 편집 대상 아님)
          const isUser = msg.type === 'user';
          const editable = isUser && !blockReason && (!!msg.qKey || idx === photoBubbleIdx);
          const editing = !!answerEdit && answerEdit.idx === idx;
          return (
            <View
              key={idx}
              style={[styles.msgRow, isUser ? styles.userRow : styles.dirRow]}
            >
              {msg.type === 'director' && (
                <View style={styles.dirPortrait}>
                  <Image source={ARTIST_PORTRAIT} style={styles.dirPortraitImg} />
                </View>
              )}
              <TouchableOpacity
                activeOpacity={0.8}
                disabled={!isUser || (!msg.qKey && idx !== photoBubbleIdx)}
                onPress={() => handleUserBubbleTap(idx)}
                style={[styles.bubble, isUser ? styles.userBubble : styles.dirBubble, editing && styles.userBubbleEditing]}
              >
                <AppText
                  style={[
                    styles.bubbleText,
                    isUser ? { color: colors.text.primary } : { color: colors.bg.deepest },
                  ]}
                >
                  {msg.text}
                </AppText>
                {editable && !editing && (
                  <AppText style={styles.editHint}>
                    {msg.qKey ? '탭해서 수정' : msg.text === TEXT_ONLY_BUBBLE ? '탭해서 사진 올리기' : '탭해서 사진 바꾸기'}
                  </AppText>
                )}
              </TouchableOpacity>
            </View>
          );
        })}
        {/* v3.219 [ArtistDraft]: 복원 안내 버블 — 디렉터 대화 톤 + 인라인 '처음부터' 액션 */}
        {showResumeNotice && (
          <View style={[styles.msgRow, styles.dirRow]}>
            <View style={styles.dirPortrait}>
              <Image source={ARTIST_PORTRAIT} style={styles.dirPortraitImg} />
            </View>
            <View style={[styles.bubble, styles.dirBubble]}>
              <AppText style={[styles.bubbleText, { color: colors.bg.deepest }]}>
                {photoResume
                  ? '진행하던 아티스트 만들기를 이어서 할게요! 얼굴 사진은 다시 올려주셔야 해요 — 올리면 답해둔 내용 그대로 멈췄던 곳부터 이어가요. 새로 시작하고 싶으면 아래 버튼을 눌러주세요.'
                  : '진행하던 아티스트 만들기를 이어서 할게요! 새로 시작하고 싶으면 아래 버튼을 눌러주세요.'}
              </AppText>
              <TouchableOpacity style={styles.restartInlineBtn} onPress={handleRestartFromScratch}>
                <AppText style={styles.restartInlineBtnText}>처음부터</AppText>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </ScrollView>

      {/* v3.105: 미니플레이어 숨김 정책 — bottomLift(하단 공백) 제거 */}
      <View>
        {/* v3.231 A1: 답변 수정 배너(작곡 디렉터 규격) — [취소] = 미반영, 원래 진행 위치 그대로 */}
        {answerEdit && !activeJob && (
          <View style={styles.rewindBanner}>
            <AppText style={styles.rewindBannerText}>
              {questionOf(answerEdit.qKey).short} 답변을 수정 중이에요
            </AppText>
            <TouchableOpacity onPress={cancelAnswerEdit} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <AppText style={styles.rewindBannerCancel}>취소</AppText>
            </TouchableOpacity>
          </View>
        )}
        {renderInputArea()}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.deepest },
  emptyBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  emptyIcon: { fontSize: 64, marginBottom: 16 },
  emptyTitle: { fontSize: 20, color: colors.text.primary, fontWeight: '700', marginBottom: 8 },
  emptyDesc: {
    fontSize: 14, color: colors.text.secondary, textAlign: 'center',
    lineHeight: 22, marginBottom: 20,
  },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 12 },
  dirRow: { justifyContent: 'flex-start', paddingRight: 40 },
  userRow: { justifyContent: 'flex-end', paddingLeft: 40 },
  dirPortrait: {
    width: 44, height: 44, borderRadius: 22, overflow: 'hidden',
    borderWidth: 1.5, borderColor: colors.accent.primary,
    marginRight: 8, backgroundColor: colors.bg.surface2,
  },
  // 95x405 전신 → 얼굴 + 목+어깨 살짝: 1.1x zoom + top 약간 음수
  dirPortraitImg: {
    width: 44 * 1.1,
    height: (44 * 1.1) * 405 / 95,
    position: 'absolute',
    top: -44 / 15,
    left: -(44 * 1.1 - 44) / 2,
  },
  bubble: { borderRadius: 16, padding: 12, maxWidth: '80%' },
  dirBubble: { backgroundColor: colors.text.primary, borderBottomLeftRadius: 4 },
  userBubble: {
    backgroundColor: colors.accent.primary, borderBottomRightRadius: 4, alignSelf: 'flex-end',
  },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  // v3.231 [ArtistAnswerEdit]: 답변 수정 힌트·수정 중 버블·수정 배너(작곡 MusicGenerationScreen 규격)
  editHint: { fontSize: 10, color: 'rgba(255,255,255,0.55)', marginTop: 4, textAlign: 'right' },
  userBubbleEditing: { borderWidth: 1.5, borderColor: colors.text.primary },
  editPhotoHint: { color: colors.text.muted, fontSize: 11, marginTop: 4 },
  rewindBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: 16,
    marginBottom: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent.primary,
    backgroundColor: colors.bg.surface1,
  },
  rewindBannerText: { flex: 1, color: colors.accent.primary, fontSize: 12, fontWeight: '700' },
  rewindBannerCancel: { color: colors.text.secondary, fontSize: 12, fontWeight: '700', paddingHorizontal: 8 },

  inputArea: {
    borderTopWidth: 1, borderTopColor: colors.bg.surface1,
    padding: 14, paddingBottom: 24, backgroundColor: colors.bg.deepest,
  },
  primaryBtn: {
    backgroundColor: colors.accent.primary, borderRadius: 14,
    paddingVertical: 14, alignItems: 'center', marginBottom: 8,
  },
  primaryBtnText: { color: colors.text.primary, fontWeight: '700', fontSize: 15 },
  // v3.76: 텍스트-only 경로 버튼(보조 스타일) + 힌트
  textOnlyBtn: {
    borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 14,
    paddingVertical: 12, alignItems: 'center', marginBottom: 6,
  },
  textOnlyBtnText: { color: colors.text.secondary, fontWeight: '600', fontSize: 14 },
  textOnlyHint: { color: colors.text.muted, fontSize: 11, textAlign: 'center' },
  // v3.227 H-1(W1): [이전 사진 사용]
  reuseBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderColor: colors.accent.primary, borderRadius: 14,
    paddingVertical: 10, paddingHorizontal: 12, marginBottom: 8, backgroundColor: colors.bg.surface1,
  },
  reuseThumb: { width: 36, height: 36, borderRadius: 8, backgroundColor: colors.bg.surface2 },
  reuseBtnText: { color: colors.accent.primary, fontWeight: '700', fontSize: 14 },
  reuseBtnDesc: { color: colors.text.muted, fontSize: 11, marginTop: 2 },

  // v3.219 [ArtistDraft]: 복원 안내 버블 인라인 '처음부터' 액션
  restartInlineBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: colors.accent.primary,
    borderRadius: 12,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  restartInlineBtnText: {
    color: colors.accent.primary,
    fontSize: 12,
    fontWeight: '700',
  },
  // v3.105: 이어서 만들기(입력 보존 재개) 버튼
  resumeBtn: {
    borderWidth: 1, borderColor: colors.accent.primary, borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 12, marginBottom: 8,
    backgroundColor: colors.bg.surface1,
  },
  resumeBtnText: { color: colors.accent.primary, fontWeight: '700', fontSize: 14 },
  resumeBtnDesc: { color: colors.text.muted, fontSize: 11, lineHeight: 15, marginTop: 4 },

  // v3.112: 실사/가상 선택 카드(구 v3.80 토글 대체) + 되돌리기
  kindCard: {
    borderWidth: 1.5, borderColor: colors.accent.primary, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 14, marginBottom: 8,
    backgroundColor: colors.bg.surface1,
  },
  kindCardTitle: { color: colors.accent.primary, fontWeight: '700', fontSize: 15, marginBottom: 4 },
  kindCardDesc: { color: colors.text.secondary, fontSize: 12, lineHeight: 17 },
  kindResetBtn: {
    paddingVertical: 8, alignItems: 'center', marginBottom: 4,
  },
  kindResetBtnText: { color: colors.text.muted, fontSize: 12, fontWeight: '600' },
  styleLoadingText: { color: colors.text.secondary, fontSize: 12, marginTop: 10 },
  styleErrorText: { color: colors.text.secondary, fontSize: 13, marginBottom: 10, textAlign: 'center' },
  retryBtn: {
    paddingVertical: 10, paddingHorizontal: 24, borderRadius: 10,
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.accent.primary,
  },
  retryBtnText: { color: colors.accent.primary, fontSize: 13, fontWeight: '700' },
  styleCard: {
    width: 110, marginRight: 10, borderRadius: 12, padding: 6,
    backgroundColor: colors.bg.surface1, borderWidth: 1.5, borderColor: colors.border.subtle,
    alignItems: 'center',
  },
  styleCardSelected: { borderColor: colors.accent.primary, backgroundColor: colors.bg.surface2 },
  styleCardImgWrap: {
    width: 96, height: 120, borderRadius: 8, overflow: 'hidden',
    backgroundColor: colors.bg.surface2, marginBottom: 6,
  },
  styleCardImg: { width: 96, height: 120, resizeMode: 'cover' },
  styleCardImgLoading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center', alignItems: 'center',
  },
  styleCardLabel: { color: colors.text.secondary, fontSize: 12, fontWeight: '600' },
  styleCardLabelSelected: { color: colors.accent.primary, fontWeight: '700' },
  styleUploadBtn: {
    borderWidth: 1, borderColor: colors.border.subtle, borderRadius: 12,
    paddingVertical: 11, alignItems: 'center', marginBottom: 8,
    minHeight: 48, justifyContent: 'center', // v3.109: 같은 스텝 버튼 동일 점검 — 세로 여유 확보
    backgroundColor: colors.bg.surface1,
  },
  styleUploadBtnActive: { borderColor: colors.accent.primary },
  styleUploadBtnText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },
  styleUploadBtnTextActive: { color: colors.accent.primary, fontWeight: '700' },

  qProgress: { marginBottom: 8 },
  qProgressText: { color: colors.accent.primary, fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  chip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16,
    backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle,
  },
  chipSelected: { backgroundColor: colors.accent.primary, borderColor: colors.accent.primary },
  chipText: { color: colors.text.secondary, fontSize: 12, fontWeight: '600' },
  chipTextSelected: { color: colors.text.primary },

  textInput: {
    backgroundColor: colors.bg.surface1, borderWidth: 1, borderColor: colors.border.subtle,
    borderRadius: 12, padding: 12, color: colors.text.primary,
    fontSize: 14, minHeight: 56, maxHeight: 120, marginBottom: 8,
  },
  twoBtnRow: { flexDirection: 'row', gap: 10 },
  skipBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, alignItems: 'center',
    minHeight: 48, justifyContent: 'center',
    backgroundColor: colors.bg.surface2, borderWidth: 1, borderColor: colors.border.subtle,
  },
  skipBtnText: { color: colors.text.secondary, fontSize: 13, fontWeight: '600' },
  // v3.109: 버튼 세로 잘림 방지 — minHeight 48 + 세로 중앙정렬, 압축 금지(flexShrink 0)
  applyBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: 'center',
    minHeight: 48, justifyContent: 'center',
    backgroundColor: colors.accent.primary,
  },
  // v3.109: 화풍 확정 버튼 — 세로 스택에서 flex:1(applyBtn)을 무효화하되 flex:0의
  // 웹 flex-basis 압축 부작용 없이 내용 높이(auto)로 렌더
  styleConfirmBtn: { flexGrow: 0, flexShrink: 0, flexBasis: 'auto' },
  applyBtnText: {
    color: colors.text.primary, fontSize: 13, fontWeight: '700',
    // v3.109: 고정 lineHeight(18) 제거 — OS 글자 확대 시 글리프가 줄박스에 잘리던 원인
  },
});
