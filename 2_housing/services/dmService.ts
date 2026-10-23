import api from './api';

// v3.407 [DmEdit] 보낸 DM 메시지 삭제·수정 — 서버 /api/dm/conversations/{cid}/messages/{mid}
// 계약: 발신자 본인만(남의 메시지 403), 삭제된 메시지 수정 409, 글 1~2000자(사진 메시지는 빈 글 허용).
// 응답 {message, preview_updated, last_message_text} — message 는 서버 직렬화 그대로(deleted/edited 표식 포함).
// 실시간: 상대·내 다른 기기에 WS message_deleted / message_edited ({conversation_id, message_id, message, last_message_text}).

export interface DmMessageChangeResult {
  message: any | null;
  previewUpdated: boolean;
  lastMessageText: string | null;
}

const toResult = (data: any): DmMessageChangeResult => ({
  message: data?.message ?? null,
  previewUpdated: !!data?.preview_updated,
  lastMessageText: data?.last_message_text ?? null,
});

export async function deleteDmMessage(conversationId: string, messageId: string): Promise<DmMessageChangeResult> {
  if (__DEV__) console.info('[DmEdit] 삭제 요청', { conversationId, messageId });
  try {
    const res = await api.delete(`/dm/conversations/${conversationId}/messages/${messageId}`);
    return toResult(res.data);
  } catch (err: any) {
    console.error('[DmEdit] 삭제 실패', { conversationId, messageId, status: err?.response?.status });
    throw err;
  }
}

export async function editDmMessage(conversationId: string, messageId: string, text: string): Promise<DmMessageChangeResult> {
  if (__DEV__) console.info('[DmEdit] 수정 요청', { conversationId, messageId, len: text.length });
  try {
    const res = await api.patch(`/dm/conversations/${conversationId}/messages/${messageId}`, { text });
    return toResult(res.data);
  } catch (err: any) {
    console.error('[DmEdit] 수정 실패', { conversationId, messageId, status: err?.response?.status });
    throw err;
  }
}
