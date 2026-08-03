import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HashbrownOpenAI } from '@hashbrownai/openai';

const host = process.env.HOST ?? 'localhost';
const port = process.env.PORT ? Number(process.env.PORT) : 3100;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is not set. Copy .env.example to .env and set your key.');
}

const STT_MODEL = process.env.STT_MODEL || 'gpt-4o-transcribe';
const STT_FALLBACK_MODEL = 'whisper-1';
const TTS_MODEL = process.env.TTS_MODEL || 'gpt-4o-mini-tts';
const TTS_VOICE = process.env.TTS_VOICE || 'marin';
const TTS_INSTRUCTIONS =
  '당신은 어르신을 모시는 쇼핑 안내 도우미입니다. 상냥하고 나긋나긋한 말투로, 서두르지 않고 한 마디 한 마디 또박또박, 어르신께 차분히 안내해 드리듯 부드럽고 자연스럽게 한국어로 읽어주세요.';

/* ── 로깅: 모든 라인에 KST 시각 접두 + stdout + logs/access.log 동시 기록 ── */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'access.log');
fs.mkdirSync(LOG_DIR, { recursive: true });
// 단일 append 스트림 — fs.appendFile의 비동기 경쟁으로 라인 순서가 섞이는 것 방지
const logStream = fs.createWriteStream(LOG_FILE, { flags: 'a' });

/** KST 시각 문자열 (YYYY-MM-DD HH:mm:ss) */
function ts() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' });
}

function writeLog(isError, line) {
  const full = `[${ts()}] ${line}`;
  (isError ? console.error : console.log)(full);
  logStream.write(full + '\n');
}

const log = (line) => writeLog(false, line);
const logError = (line) => writeLog(true, line);

/** 실 접속자 정보: cf-connecting-ip(터널) → x-forwarded-for 첫 항목(vite xfwd) → socket */
function clientInfo(req) {
  const xff = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  const ip = req.headers['cf-connecting-ip'] || xff || req.socket.remoteAddress || '-';
  const ua = req.headers['user-agent'] || '-';
  const session = req.headers['x-session-id'] || '-';
  return { ip, ua, session };
}

const app = express();

app.use(cors());
app.use(express.json());

/** 공통 에러 응답 헬퍼: { error: { code, message, requestId } } */
function sendError(res, status, code, message, requestId) {
  res.status(status).json({ error: { code, message, requestId } });
}

/** Content-Type → 파일 확장자 매핑 (기타 audio/*는 webm으로 간주) */
function audioExtFromContentType(contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('audio/mp4')) return 'mp4';
  if (ct.includes('audio/mpeg')) return 'mp3';
  return 'webm';
}

/** OpenAI transcription 호출 1회 (내장 fetch/FormData/Blob 사용) */
async function callTranscription(requestId, model, buffer, contentType) {
  const ext = audioExtFromContentType(contentType);
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType }), `audio.${ext}`);
  form.append('model', model);
  form.append('language', 'ko');

  log(`[stt:${requestId}] calling OpenAI transcriptions model=${model} file=audio.${ext}`);
  const startedAt = Date.now();
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const elapsedMs = Date.now() - startedAt;
  log(`[stt:${requestId}] OpenAI response model=${model} status=${response.status} elapsed=${elapsedMs}ms`);
  return response;
}

// POST /api/stt — raw 오디오 바이너리 → 텍스트
app.post('/api/stt', express.raw({ type: 'audio/*', limit: '25mb' }), async (req, res) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  res.header('X-Request-Id', requestId);

  const { ip, ua, session } = clientInfo(req);
  const contentType = req.headers['content-type'] || '';
  const byteLength = Buffer.isBuffer(req.body) ? req.body.length : 0;
  log(
    `[stt:${requestId}] [sess:${session}] [ip:${ip}] incoming contentType=${contentType} bytes=${byteLength} ua="${ua}"`,
  );

  if (!Buffer.isBuffer(req.body) || byteLength === 0) {
    return sendError(res, 400, 'EMPTY_AUDIO', '오디오 데이터가 비어 있습니다.', requestId);
  }

  try {
    let response = await callTranscription(requestId, STT_MODEL, req.body, contentType);

    if (!response.ok && STT_MODEL !== STT_FALLBACK_MODEL) {
      const failedBody = await response.text().catch(() => '');
      logError(
        `[stt:${requestId}] model=${STT_MODEL} failed status=${response.status} body=${failedBody.slice(0, 300)} — falling back to ${STT_FALLBACK_MODEL}`,
      );
      response = await callTranscription(requestId, STT_FALLBACK_MODEL, req.body, contentType);
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      logError(`[stt:${requestId}] OpenAI STT failed status=${response.status} body=${errBody.slice(0, 300)}`);
      return sendError(res, 502, 'OPENAI_STT_FAILED', '음성 인식에 실패했습니다. 잠시 후 다시 시도해 주세요.', requestId);
    }

    const data = await response.json();
    const text = typeof data.text === 'string' ? data.text : '';
    log(`[stt:${requestId}] transcribed textLength=${text.length} preview="${text.slice(0, 50)}"`);
    return res.status(200).json({ text });
  } catch (error) {
    logError(`[stt:${requestId}] unexpected error: ${String(error)}`);
    return sendError(res, 502, 'OPENAI_STT_FAILED', '음성 인식에 실패했습니다. 잠시 후 다시 시도해 주세요.', requestId);
  }
});

// POST /api/tts — 텍스트 → mp3 음성
app.post('/api/tts', async (req, res) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  res.header('X-Request-Id', requestId);

  const { ip, ua, session } = clientInfo(req);
  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  const voice = typeof req.body?.voice === 'string' && req.body.voice.trim() ? req.body.voice.trim() : TTS_VOICE;
  log(
    `[tts:${requestId}] [sess:${session}] [ip:${ip}] incoming textLength=${text.length} voice=${voice} preview="${text.slice(0, 80)}" ua="${ua}"`,
  );

  if (!text.trim()) {
    return sendError(res, 400, 'EMPTY_TEXT', 'text가 비어 있습니다.', requestId);
  }
  if (text.length > 4096) {
    return sendError(res, 400, 'TEXT_TOO_LONG', 'text는 최대 4096자입니다.', requestId);
  }

  try {
    log(`[tts:${requestId}] calling OpenAI speech model=${TTS_MODEL}`);
    const startedAt = Date.now();
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: TTS_MODEL,
        voice,
        input: text,
        response_format: 'mp3',
        instructions: TTS_INSTRUCTIONS,
      }),
    });
    const elapsedMs = Date.now() - startedAt;

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      logError(
        `[tts:${requestId}] OpenAI TTS failed status=${response.status} elapsed=${elapsedMs}ms body=${errBody.slice(0, 300)}`,
      );
      return sendError(res, 502, 'OPENAI_TTS_FAILED', '음성 합성에 실패했습니다. 잠시 후 다시 시도해 주세요.', requestId);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    log(`[tts:${requestId}] OpenAI response status=${response.status} elapsed=${elapsedMs}ms bytes=${audioBuffer.length}`);
    res.status(200).type('audio/mpeg').send(audioBuffer);
  } catch (error) {
    logError(`[tts:${requestId}] unexpected error: ${String(error)}`);
    return sendError(res, 502, 'OPENAI_TTS_FAILED', '음성 합성에 실패했습니다. 잠시 후 다시 시도해 주세요.', requestId);
  }
});

// POST /api/log — 프론트 이용 이벤트 원격 로깅 (대화 내용/장바구니/주문 등)
app.post('/api/log', (req, res) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  res.header('X-Request-Id', requestId);

  const { ip, ua, session } = clientInfo(req);
  const event = typeof req.body?.event === 'string' ? req.body.event.trim().slice(0, 64) : '';
  if (!event) {
    return sendError(res, 400, 'EMPTY_EVENT', 'event가 비어 있습니다.', requestId);
  }

  let dataStr = '';
  if (req.body?.data !== undefined) {
    try {
      dataStr = JSON.stringify(req.body.data).slice(0, 2000);
    } catch {
      dataStr = '(unserializable)';
    }
  }

  log(`[log:${requestId}] [sess:${session}] [ip:${ip}] event=${event} data=${dataStr} ua="${ua}"`);
  res.status(204).end();
});

app.post('/api/chat', async (req, res) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const { ip, ua, session } = clientInfo(req);
  log(
    `[chat:${requestId}] [sess:${session}] [ip:${ip}] incoming messages=${Array.isArray(req.body?.messages) ? req.body.messages.length : '-'} ua="${ua}"`,
  );

  try {
    const response = HashbrownOpenAI.stream.text({
      apiKey: OPENAI_API_KEY,
      request: req.body,
    });

    res.header('Content-Type', 'application/octet-stream');

    let bytes = 0;
    for await (const chunk of response) {
      bytes += chunk.length ?? 0;
      res.write(chunk);
    }

    res.end();
    log(`[chat:${requestId}] stream completed bytes=${bytes}`);
  } catch (error) {
    logError(`[chat:${requestId}] error: ${String(error)}`);
    if (!res.headersSent) {
      res.status(500).json({ error: String(error) });
    } else {
      res.end();
    }
  }
});

app.listen(port, host, () => {
  log(`[ ready ] hashbrown adapter server: http://${host}:${port}/api/chat (log file: logs/access.log)`);
});
