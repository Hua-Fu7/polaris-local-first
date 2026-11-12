import { createMessage } from '../../engines/chatMessageFactory';
import type { ChatAttachment, ChatMessage, VoiceGenerationSettings } from '../../types/domain';
import { clearVoiceMessageRequest, type VoiceMessageRequest } from './voiceMessageRequestStore';
import {
  synthesiseVoiceMessage,
  type VoiceMessageSynthesisDeps
} from './voiceMessageSynthesis';

export type VoiceMessageApprovalResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: string };

/**
 * 拼出那条语音消息：一条 assistant 消息，正文是文字稿，附件是刚合成好的音频。
 *
 * 长度/顺序都跟普通回复一样，所以它在时间线里就是一条普通消息，只是被
 * `MessageRow` 画成语音条而不是气泡。
 */
export function buildVoiceMessageReply(args: {
  request: VoiceMessageRequest;
  transcript: string;
  attachment: ChatAttachment;
}): ChatMessage {
  const message = createMessage('assistant', args.transcript, [args.attachment]);
  return {
    ...message,
    assistantName: args.request.collaboratorName,
    speakerCollaboratorId: args.request.collaboratorId
  };
}

/**
 * 用户点了「允许」：合成 → 落成本地附件 → 作为一条语音消息写进会话 → 收掉申请。
 *
 * 失败时申请留着（卡片还在），用户可以再点一次；成功才 `clearVoiceMessageRequest`。
 */
export async function approveVoiceMessage(args: {
  request: VoiceMessageRequest;
  settings: VoiceGenerationSettings;
  /** 把这条消息写进对应会话；返回 false 表示会话已经不在了。 */
  deliver: (message: ChatMessage) => Promise<boolean> | boolean;
  signal?: AbortSignal;
  deps?: VoiceMessageSynthesisDeps;
}): Promise<VoiceMessageApprovalResult> {
  const synthesis = await synthesiseVoiceMessage({
    request: args.request,
    settings: args.settings,
    signal: args.signal,
    deps: args.deps
  });
  if (!synthesis.ok) return { ok: false, error: synthesis.error };

  const message = buildVoiceMessageReply({
    request: args.request,
    transcript: synthesis.transcript,
    attachment: synthesis.attachment
  });

  const delivered = await args.deliver(message);
  if (!delivered) {
    return { ok: false, error: '这条会话已经不在本机了，语音没能发出去。' };
  }

  clearVoiceMessageRequest(args.request.id);
  return { ok: true, message };
}
