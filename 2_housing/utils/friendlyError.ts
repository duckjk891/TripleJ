// v3.326 [FriendlyError] 사용자에게 시스템 오류 원문을 보여주지 않는다(대표 2026-10-10: "저런 시스템 오류를
// 보여주면 안 됨 — 오류 번호마다 팝업 처리"). 서버의 한국어 안내는 그대로 쓰고, 기술 문구(영문 예외·HTTP·JSON·
// 외부 API 이름)는 상태 코드별 쉬운 안내 + 짧은 오류 코드로 바꾼다. 원문은 콘솔·원격 로그에만 남긴다.

/** 기술 문구 판별(순수) — 영문 예외·HTTP 상태·JSON·스택·외부 서비스명·한글 없는 긴 영문 */
export function isTechnicalMessage(raw: unknown): boolean {
  if (typeof raw !== 'string') return raw != null;
  const s = raw.trim();
  if (!s) return false;
  if (/(traceback|exception|valueerror|typeerror|keyerror|runtimeerror|errno)/i.test(s)) return true;
  if (/\b(undefined|null|NaN)\b/.test(s) && !/[가-힣]/.test(s)) return true;
  if (/(openai|suno|gemini|anthropic|elevenlabs|minio|mongo|postgres|redis|httpx|axios|uvicorn|fastapi)/i.test(s)) return true;
  if (/(http\s*\d{3}|status code \d{3}|\bE\d{3}\b.*error|request failed|network error|timeout of \d+ms|ECONN|ETIMEDOUT)/i.test(s)) return true;
  if (/[{}]|"\w+"\s*:|\[\s*\{/.test(s)) return true;
  const hangul = (s.match(/[가-힣]/g) || []).length;
  const latin = (s.match(/[A-Za-z]/g) || []).length;
  return hangul === 0 && latin >= 12;
}

/** 오류 코드별 안내(순수). status 0/undefined = 네트워크 */
export function statusMessage(status?: number | null): { title: string; body: string; code: string } {
  const code = status ? `E${status}` : 'E-NET';
  if (!status) return { title: '연결 오류', body: '인터넷 연결이 불안정해요. 연결을 확인한 뒤 다시 시도해 주세요.', code };
  if (status === 400 || status === 422) return { title: '알림', body: '요청을 처리하지 못했어요. 입력한 내용을 확인한 뒤 다시 시도해 주세요.', code };
  if (status === 401) return { title: '로그인 필요', body: '로그인이 필요하거나 로그인이 만료됐어요. 다시 로그인해 주세요.', code };
  if (status === 402) return { title: '⭐ 부족', body: '⭐가 부족해요. 출석·미션으로 ⭐를 모은 뒤 다시 시도해 주세요.', code };
  if (status === 403) return { title: '알림', body: '이 기능을 사용할 수 있는 권한이 없어요.', code };
  if (status === 404) return { title: '알림', body: '찾을 수 없어요. 삭제되었거나 주소가 바뀌었을 수 있어요.', code };
  if (status === 408) return { title: '알림', body: '응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.', code };
  if (status === 409) return { title: '알림', body: '이미 처리 중이거나 처리된 요청이에요. 잠시 후 다시 확인해 주세요.', code };
  if (status === 413) return { title: '알림', body: '파일이 너무 커요. 더 작은 파일로 다시 시도해 주세요.', code };
  if (status === 415) return { title: '알림', body: '지원하지 않는 파일 형식이에요. jpg·png·webp 이미지로 다시 시도해 주세요.', code };
  if (status === 429) return { title: '알림', body: '요청이 많아요. 잠시 후 다시 시도해 주세요.', code };
  if (status >= 500) return { title: '일시적인 오류', body: '서버에 일시적인 문제가 있어요. 잠시 후 다시 시도해 주세요.', code };
  return { title: '알림', body: '문제가 생겼어요. 잠시 후 다시 시도해 주세요.', code };
}

/** 화면에 보여줄 문구(순수) — 한국어 안내면 그대로, 기술 문구·빈 값이면 fallback 또는 상태 코드 안내 */
export function friendlyText(raw: unknown, opts: { status?: number | null; fallback?: string } = {}): string {
  if (typeof raw === 'string' && raw.trim() && !isTechnicalMessage(raw)) return raw.trim();
  if (opts.fallback) return opts.fallback;
  // v3.329: 화면에는 안내 문구만 — 오류 코드(E500 등)는 표시하지 않는다(대표 10-10 "(E500) 같은 건 필요없다"). 코드는 콘솔 로그용.
  return statusMessage(opts.status).body;
}

/** axios 오류 객체 → 안내 문구 */
export function friendlyErrorMessage(err: any, fallback?: string): string {
  const status = err?.response?.status ?? (err?.response ? null : 0);
  const data = err?.response?.data;
  const raw = (typeof data?.error === 'string' && data.error) || (typeof data?.detail === 'string' && data.detail) || '';
  return friendlyText(raw, { status: status ?? undefined, fallback });
}

/** 팝업 최후 방어선용(엄격) — 확실한 시스템 오류 흔적만. 노래 제목 등 일반 영문은 건드리지 않는다 */
export function looksLikeSystemError(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  return /(traceback|exception|valueerror|typeerror|keyerror|http\s*\d{3}|status code \d{3}|"message"\s*:|"error"\s*:|"detail"\s*:|request failed|errno|openai .*error|\binvalid_request|image_generation_user_error)/i.test(raw);
}
