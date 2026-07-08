import { Chat, prompt, s } from '@hashbrownai/core';
import {
  exposeComponent,
  useTool,
  useUiChat,
  type UiChatSchemaComponent,
} from '@hashbrownai/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { synthesizeSpeech, transcribeAudio } from '../api';
import { PRODUCTS } from '../data/products';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { useShopStore } from '../store';
import { CartChatCard } from './chat/CartChatCard';
import { MarkdownComponent } from './chat/MarkdownComponent';
import { OrderChatCard } from './chat/OrderChatCard';
import { ProductChatCard } from './chat/ProductChatCard';

/**
 * lastAssistantMessage.content.ui 트리에서 $tag === 'Markdown' 노드의
 * $children(string)만 재귀 수집. Markdown 외 태그(ProductCard/CartCard/OrderCard)는
 * 하위까지 건너뛰므로 상품카드/장바구니/주문 내용은 음성에서 자동 제외된다.
 */
function collectMarkdownText(nodes: UiChatSchemaComponent[]): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.$tag !== 'Markdown') continue;
    if (typeof node.$children === 'string') {
      out.push(node.$children);
    } else if (Array.isArray(node.$children)) {
      out.push(...collectMarkdownText(node.$children));
    }
  }
  return out;
}

/** TTS 입력용으로 마크다운 기호를 간단히 제거 (읽을 때 어색한 기호만) */
function stripMarkdownSyntax(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/(\*\*|__|~~)/g, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .trim();
}

/** iOS 자동재생 정책 해제용 무음 WAV (audio unlock) */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';

/** OpenAI TTS input 한도(4096자) — 초과분은 잘라서 전송 */
const TTS_MAX_CHARS = 4096;

export function ChatPanel() {
  const getProducts = useTool({
    name: 'getProducts',
    description:
      'Get the full list of products in the store (id, name, category, price, description, stock)',
    handler: () => Promise.resolve(PRODUCTS),
    deps: [],
  });

  const getCart = useTool({
    name: 'getCart',
    description: 'Get the current shopping cart contents',
    handler: () => {
      const cart = useShopStore.getState().cart;
      return Promise.resolve(
        cart.map((item) => {
          const product = PRODUCTS.find((p) => p.id === item.productId);
          return {
            productId: item.productId,
            name: product?.name,
            quantity: item.quantity,
            unitPrice: product?.price,
          };
        }),
      );
    },
    deps: [],
  });

  const addToCart = useTool({
    name: 'addToCart',
    description: 'Add a product to the shopping cart',
    schema: s.object('Add to cart input', {
      productId: s.string('The id of the product to add'),
      quantity: s.number('How many to add (default 1)'),
    }),
    handler: (input) =>
      Promise.resolve(useShopStore.getState().addToCart(input.productId, input.quantity)),
    deps: [],
  });

  const removeFromCart = useTool({
    name: 'removeFromCart',
    description: 'Remove a product from the shopping cart entirely',
    schema: s.object('Remove from cart input', {
      productId: s.string('The id of the product to remove'),
    }),
    handler: (input) => {
      useShopStore.getState().removeFromCart(input.productId);
      return Promise.resolve(true);
    },
    deps: [],
  });

  const checkout = useTool({
    name: 'checkout',
    description:
      'Place the order for everything currently in the cart. Only call this after the user has explicitly confirmed the order.',
    handler: () => {
      const result = useShopStore.getState().checkout();
      return Promise.resolve(
        result.ok
          ? { ok: true, orderId: result.order!.id, total: result.order!.total }
          : { ok: false, message: result.message },
      );
    },
    deps: [],
  });

  const {
    messages,
    sendMessage,
    resendMessages,
    isSending,
    isReceiving,
    isRunningToolCalls,
    lastAssistantMessage,
    stop,
  } = useUiChat({
    model: 'gpt-4.1',
    debugName: 'SilverCareShopChat',
    system: prompt`
      당신은 "실버케어몰"의 AI 쇼핑 도우미입니다. 어르신을 위한 의료·보조용품
      (지팡이, 휠체어, 보행보조차, 욕실 안전용품, 혈압계 등)을 파는 쇼핑몰입니다.

      규칙:
      - 항상 한국어로, 어르신도 이해하기 쉽게 짧고 친절하게 답하세요.
      - 상품을 추천하거나 보여줄 때는 반드시 ProductCard 컴포넌트를 사용하세요.
      - 장바구니 내용을 보여줄 때는 CartCard 컴포넌트를 사용하세요.
      - 주문(checkout)은 반드시 사용자에게 주문 내역과 총 금액을 확인받은 뒤에만 실행하세요.
      - checkout이 성공하면 OrderCard 컴포넌트로 주문 결과를 보여주세요.
      - 상품 정보는 추측하지 말고 getProducts 툴로 조회하세요.

      ### EXAMPLES

      <user>무릎이 안 좋은데 지팡이 추천해줘</user>
      <assistant>
        <tool-call>getProducts</tool-call>
      </assistant>
      <assistant>
        <ui>
          <Markdown>무릎이 불편하시면 지지력이 좋은 이 지팡이를 추천드려요:</Markdown>
          <ProductCard productId="cane-01" />
        </ui>
      </assistant>

      <user>그거 2개 장바구니에 담아줘</user>
      <assistant>
        <tool-call>addToCart</tool-call>
      </assistant>
      <assistant>
        <ui>
          <Markdown>장바구니에 담았습니다:</Markdown>
          <CartCard />
          <Markdown>주문하시겠어요?</Markdown>
        </ui>
      </assistant>

      <user>응 주문해줘</user>
      <assistant>
        <tool-call>checkout</tool-call>
      </assistant>
      <assistant>
        <ui>
          <OrderCard orderId="ORD-0001" />
        </ui>
      </assistant>
    `,
    tools: [getProducts, getCart, addToCart, removeFromCart, checkout],
    components: [
      exposeComponent(MarkdownComponent, {
        name: 'Markdown',
        description: 'Show markdown-formatted text to the user',
        children: 'text',
      }),
      exposeComponent(ProductChatCard, {
        name: 'ProductCard',
        description:
          'Show a product card with name, price, description and an add-to-cart button',
        props: {
          productId: s.string('The id of the product to show'),
        },
      }),
      exposeComponent(CartChatCard, {
        name: 'CartCard',
        description: 'Show the current shopping cart contents with total price',
      }),
      exposeComponent(OrderChatCard, {
        name: 'OrderCard',
        description: 'Show a completed order confirmation',
        props: {
          orderId: s.string('The id of the completed order, e.g. ORD-0001'),
        },
      }),
    ],
  });

  const isWorking = isSending || isReceiving || isRunningToolCalls;

  const [inputValue, setInputValue] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const onSubmit = useCallback(() => {
    if (!inputValue.trim()) return;
    const userMessage: Chat.UserMessage = { role: 'user', content: inputValue };
    setInputValue('');
    sendMessage(userMessage);
  }, [inputValue, sendMessage]);

  // ── 음성 입력(STT) ─────────────────────────────
  const {
    isRecording,
    error: recorderError,
    start: startRecording,
    stop: stopRecording,
  } = useVoiceRecorder();
  const [isTranscribing, setIsTranscribing] = useState(false);
  /** 사용자에게 보여줄 짧은 음성 기능 에러 메시지 */
  const [voiceError, setVoiceError] = useState<string | null>(null);

  const onMicClick = useCallback(async () => {
    if (isTranscribing) return;
    setVoiceError(null);

    if (!isRecording) {
      // 1번째 탭: 녹음 시작
      await startRecording();
      return;
    }

    // 2번째 탭: 녹음 종료 → STT → 기존 sendMessage 경로로 자동 전송
    setIsTranscribing(true);
    try {
      const blob = await stopRecording();
      if (!blob || blob.size === 0) {
        console.warn('[ChatPanel] 녹음 결과가 비어 있음:', blob);
        setVoiceError('녹음된 소리가 없습니다. 다시 시도해 주세요.');
        return;
      }
      const text = (await transcribeAudio(blob)).trim();
      if (!text) {
        if (import.meta.env.DEV) {
          console.info('[ChatPanel] STT 결과가 빈 문자열 — 전송 생략');
        }
        setVoiceError('말씀을 인식하지 못했습니다. 다시 시도해 주세요.');
        return;
      }
      if (import.meta.env.DEV) {
        console.info('[ChatPanel] STT 인식 텍스트 전송:', text.slice(0, 50));
      }
      // 입력창에 잠깐 보여주고, 기존 sendMessage 경로 그대로 자동 전송
      setInputValue(text);
      const userMessage: Chat.UserMessage = { role: 'user', content: text };
      sendMessage(userMessage);
      window.setTimeout(() => {
        setInputValue((current) => (current === text ? '' : current));
      }, 800);
    } catch (err) {
      console.error('[ChatPanel] 음성 인식 처리 실패:', err);
      setVoiceError('음성 인식에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setIsTranscribing(false);
    }
  }, [isRecording, isTranscribing, sendMessage, startRecording, stopRecording]);

  // ── 음성 응답(TTS) ─────────────────────────────
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  /** 공유 <audio> 엘리먼트 (unlock 후 재사용 — iOS 자동재생 정책 대응) */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  /** 직전 렌더의 isWorking 값 (true→false 전이 감지용) */
  const prevWorkingRef = useRef(false);
  /** 마지막으로 발화한 assistant 메시지 인덱스 (중복 발화 방지) */
  const lastSpokenIndexRef = useRef(-1);
  /** 발화 세대 토큰 — 새 발화/중지 시 증가시켜 늦게 도착한 오디오를 폐기 */
  const speakSeqRef = useRef(0);

  const getSharedAudio = useCallback(() => {
    if (!audioRef.current) {
      audioRef.current = new Audio();
    }
    return audioRef.current;
  }, []);

  const stopSpeaking = useCallback(() => {
    speakSeqRef.current += 1;
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audio.pause();
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
  }, []);

  // 언마운트 시 재생 정리
  useEffect(() => {
    return () => {
      stopSpeaking();
    };
  }, [stopSpeaking]);

  const onToggleVoice = useCallback(() => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    if (import.meta.env.DEV) {
      console.info('[ChatPanel] 음성응답 토글:', next ? 'ON' : 'OFF');
    }
    if (next) {
      // 켜는 클릭(사용자 제스처) 시점에 무음 재생으로 audio unlock — iOS 대응
      const audio = getSharedAudio();
      audio.src = SILENT_WAV;
      audio
        .play()
        .then(() => {
          if (import.meta.env.DEV) {
            console.info('[ChatPanel] audio unlock 성공');
          }
        })
        .catch((err) => {
          console.warn('[ChatPanel] audio unlock 실패 (재생 시 재시도됨):', err);
        });
    } else {
      stopSpeaking();
    }
  }, [voiceEnabled, getSharedAudio, stopSpeaking]);

  const speakText = useCallback(
    async (text: string) => {
      stopSpeaking(); // 새 발화 시작 전 이전 재생 중지
      const seq = speakSeqRef.current;
      try {
        const blob = await synthesizeSpeech(text);
        if (seq !== speakSeqRef.current) {
          console.warn('[ChatPanel] TTS 응답 도착 전에 발화가 취소됨 — 재생 생략');
          return;
        }
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        const audio = getSharedAudio();
        audio.src = url;
        audio.onended = () => {
          if (audioUrlRef.current === url) {
            URL.revokeObjectURL(url);
            audioUrlRef.current = null;
          }
        };
        await audio.play();
        if (import.meta.env.DEV) {
          console.info('[ChatPanel] TTS 재생 시작:', {
            textLength: text.length,
            blobSize: blob.size,
          });
        }
      } catch (err) {
        console.error('[ChatPanel] TTS 재생 실패:', err);
        setVoiceError('음성 재생에 실패했습니다.');
      }
    },
    [getSharedAudio, stopSpeaking],
  );

  // isWorking true→false 전이(= 스트리밍·툴콜 완료) 시 마지막 응답을 발화
  useEffect(() => {
    const wasWorking = prevWorkingRef.current;
    prevWorkingRef.current = isWorking;

    if (!wasWorking && isWorking) {
      // 새 요청 시작 — 진행 중인 재생을 멈춰 오디오 중첩 방지
      stopSpeaking();
      return;
    }
    if (!(wasWorking && !isWorking)) return;
    if (!voiceEnabled || !lastAssistantMessage) return;

    const uiNodes = lastAssistantMessage.content?.ui;
    if (!uiNodes || uiNodes.length === 0) return;

    const foundIndex = messages.lastIndexOf(lastAssistantMessage);
    const messageIndex = foundIndex >= 0 ? foundIndex : messages.length - 1;
    if (lastSpokenIndexRef.current === messageIndex) {
      if (import.meta.env.DEV) {
        console.info('[ChatPanel] 이미 발화한 메시지 — 중복 발화 생략:', messageIndex);
      }
      return;
    }

    const rawText = collectMarkdownText(uiNodes).join('\n');
    const text = stripMarkdownSyntax(rawText).slice(0, TTS_MAX_CHARS);
    if (!text) {
      if (import.meta.env.DEV) {
        console.info('[ChatPanel] Markdown 텍스트 없음 — 발화 생략');
      }
      return;
    }
    if (import.meta.env.DEV) {
      console.info('[ChatPanel] TTS 추출 텍스트 길이:', text.length);
    }

    lastSpokenIndexRef.current = messageIndex;
    void speakText(text);
  }, [isWorking, voiceEnabled, lastAssistantMessage, messages, speakText, stopSpeaking]);

  const voiceStatusMessage = voiceError ?? recorderError;

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <div className="chat-header-text">
          <h2>💬 AI 쇼핑 도우미</h2>
          <p>예: "지팡이 추천해줘", "그거 2개 담아줘", "주문해줘"</p>
        </div>
        <button
          type="button"
          className={`voice-toggle ${voiceEnabled ? 'voice-toggle-on' : ''}`}
          onClick={onToggleVoice}
          aria-pressed={voiceEnabled}
          aria-label="음성으로 응답 듣기 켜기/끄기"
        >
          {voiceEnabled ? '🔊 음성응답 켜짐' : '🔇 음성응답 꺼짐'}
        </button>
      </div>

      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="chat-welcome">
            안녕하세요! 필요하신 용품을 말씀해 주세요.
            <br />
            대화만으로 상품 추천부터 주문까지 도와드립니다.
          </div>
        )}
        {messages.map((message: any, index: number) => {
          if (message.role === 'user') {
            return (
              <div key={index} className="chat-msg chat-msg-user">
                {message.content}
              </div>
            );
          }
          if (message.role === 'assistant') {
            if (!message.content) return null;
            return (
              <div key={index} className="chat-msg chat-msg-assistant">
                {message.ui}
              </div>
            );
          }
          if (message.role === 'error') {
            return (
              <div key={index} className="chat-msg chat-msg-error">
                ⚠️ {String(message.content)}{' '}
                <button onClick={() => resendMessages()}>다시 시도</button>
              </div>
            );
          }
          return null;
        })}
        {isWorking && <div className="chat-thinking">생각 중…</div>}
      </div>

      {(isRecording || isTranscribing || voiceStatusMessage) && (
        <div
          className={`voice-status ${voiceStatusMessage ? 'voice-status-error' : ''}`}
          role="status"
        >
          {voiceStatusMessage ??
            (isRecording
              ? '🔴 말씀하세요… (버튼을 다시 누르면 전송됩니다)'
              : '👂 듣는 중…')}
        </div>
      )}

      <div className="chat-input-row">
        <button
          type="button"
          className={`mic-btn ${isRecording ? 'mic-btn-recording' : ''}`}
          onClick={() => void onMicClick()}
          disabled={isWorking || isTranscribing}
          aria-label={isRecording ? '녹음 끝내고 보내기' : '음성으로 말하기'}
          title={isRecording ? '녹음 끝내고 보내기' : '음성으로 말하기'}
        >
          🎤
        </button>
        <textarea
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSubmit();
            }
          }}
          placeholder="메시지를 입력하세요…"
          rows={2}
        />
        {!isWorking ? (
          <button className="chat-send" onClick={onSubmit}>
            보내기
          </button>
        ) : (
          <button className="chat-send chat-stop" onClick={() => stop()}>
            중지
          </button>
        )}
      </div>
    </div>
  );
}
