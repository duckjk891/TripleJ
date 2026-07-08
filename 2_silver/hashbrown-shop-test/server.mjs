import 'dotenv/config';
import express from 'express';
import cors from 'cors';
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
const TTS_VOICE = process.env.TTS_VOICE || 'nova';
const TTS_INSTRUCTIONS =
  '한국어로 어르신께 말하듯 따뜻하고 또박또박, 너무 빠르지 않게 읽어주세요.';

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

  console.log(`[stt:${requestId}] calling OpenAI transcriptions model=${model} file=audio.${ext}`);
  const startedAt = Date.now();
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}` },
    body: form,
  });
  const elapsedMs = Date.now() - startedAt;
  console.log(`[stt:${requestId}] OpenAI response model=${model} status=${response.status} elapsed=${elapsedMs}ms`);
  return response;
}

// POST /api/stt — raw 오디오 바이너리 → 텍스트
app.post('/api/stt', express.raw({ type: 'audio/*', limit: '25mb' }), async (req, res) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  res.header('X-Request-Id', requestId);

  const contentType = req.headers['content-type'] || '';
  const byteLength = Buffer.isBuffer(req.body) ? req.body.length : 0;
  console.log(`[stt:${requestId}] incoming contentType=${contentType} bytes=${byteLength}`);

  if (!Buffer.isBuffer(req.body) || byteLength === 0) {
    return sendError(res, 400, 'EMPTY_AUDIO', '오디오 데이터가 비어 있습니다.', requestId);
  }

  try {
    let response = await callTranscription(requestId, STT_MODEL, req.body, contentType);

    if (!response.ok && STT_MODEL !== STT_FALLBACK_MODEL) {
      const failedBody = await response.text().catch(() => '');
      console.warn(`[stt:${requestId}] model=${STT_MODEL} failed status=${response.status} body=${failedBody.slice(0, 300)} — falling back to ${STT_FALLBACK_MODEL}`);
      response = await callTranscription(requestId, STT_FALLBACK_MODEL, req.body, contentType);
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      console.error(`[stt:${requestId}] OpenAI STT failed status=${response.status} body=${errBody.slice(0, 300)}`);
      return sendError(res, 502, 'OPENAI_STT_FAILED', '음성 인식에 실패했습니다. 잠시 후 다시 시도해 주세요.', requestId);
    }

    const data = await response.json();
    const text = typeof data.text === 'string' ? data.text : '';
    console.log(`[stt:${requestId}] transcribed textLength=${text.length} preview="${text.slice(0, 50)}"`);
    return res.status(200).json({ text });
  } catch (error) {
    console.error(`[stt:${requestId}] unexpected error:`, error);
    return sendError(res, 502, 'OPENAI_STT_FAILED', '음성 인식에 실패했습니다. 잠시 후 다시 시도해 주세요.', requestId);
  }
});

// POST /api/tts — 텍스트 → mp3 음성
app.post('/api/tts', async (req, res) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  res.header('X-Request-Id', requestId);

  const text = typeof req.body?.text === 'string' ? req.body.text : '';
  const voice = typeof req.body?.voice === 'string' && req.body.voice.trim() ? req.body.voice.trim() : TTS_VOICE;
  console.log(`[tts:${requestId}] incoming textLength=${text.length} voice=${voice}`);

  if (!text.trim()) {
    return sendError(res, 400, 'EMPTY_TEXT', 'text가 비어 있습니다.', requestId);
  }
  if (text.length > 4096) {
    return sendError(res, 400, 'TEXT_TOO_LONG', 'text는 최대 4096자입니다.', requestId);
  }

  try {
    console.log(`[tts:${requestId}] calling OpenAI speech model=${TTS_MODEL}`);
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
      console.error(`[tts:${requestId}] OpenAI TTS failed status=${response.status} elapsed=${elapsedMs}ms body=${errBody.slice(0, 300)}`);
      return sendError(res, 502, 'OPENAI_TTS_FAILED', '음성 합성에 실패했습니다. 잠시 후 다시 시도해 주세요.', requestId);
    }

    const audioBuffer = Buffer.from(await response.arrayBuffer());
    console.log(`[tts:${requestId}] OpenAI response status=${response.status} elapsed=${elapsedMs}ms bytes=${audioBuffer.length}`);
    res.status(200).type('audio/mpeg').send(audioBuffer);
  } catch (error) {
    console.error(`[tts:${requestId}] unexpected error:`, error);
    return sendError(res, 502, 'OPENAI_TTS_FAILED', '음성 합성에 실패했습니다. 잠시 후 다시 시도해 주세요.', requestId);
  }
});

app.post('/api/chat', async (req, res) => {
  try {
    const response = HashbrownOpenAI.stream.text({
      apiKey: OPENAI_API_KEY,
      request: req.body,
    });

    res.header('Content-Type', 'application/octet-stream');

    for await (const chunk of response) {
      res.write(chunk);
    }

    res.end();
  } catch (error) {
    console.error('[chat error]', error);
    if (!res.headersSent) {
      res.status(500).json({ error: String(error) });
    } else {
      res.end();
    }
  }
});

app.listen(port, host, () => {
  console.log(`[ ready ] hashbrown adapter server: http://${host}:${port}/api/chat`);
});
