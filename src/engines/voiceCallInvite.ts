/**
 * 「协作者主动打电话过来」这件事的中间表示。
 *
 * 它和用户按「语音通话」是方向相反的两件事：那边要振铃再让角色决定接不接，
 * 这边是角色已经决定要打了，剩下的只有用户接不接。所以这里没有 accept 字段，
 * 只有一个「有人打进来了」的请求，交给界面去响。
 *
 * 这个模块保持纯粹（不引 React、不引 store），因为它同时被工具执行层（写请求）
 * 和界面层（读请求）用到。
 */

/** 来电界面上那行理由的长度上限：再长就不像随手说的了。 */
export const VOICE_CALL_INVITE_MAX_REASON_CHARS = 60;

/**
 * 一通来电最多响这么久。用户没看见（比如正在别的世界里）就让它自己过期，
 * 不然几分钟后突然弹一个来电更莫名其妙。
 */
export const VOICE_CALL_INVITE_TTL_MS = 60_000;

/**
 * 来电响了这么久还没人接，就自动挂断，并通知对方「没接」、唤醒它回应。
 * 比 TTL 短：TTL 是「这通请求自己作废」的兜底，这里是「该自动收线」的体感阈值。
 */
export const VOICE_CALL_MISSED_AUTO_END_MS = 30_000;

export type VoiceCallInvite = {
  id: string;
  collaboratorId: string;
  /** 显示在来电界面上的名字；空串表示还没拿到人设名。 */
  collaboratorName: string;
  conversationId: string;
  /** 可选的一行理由，例如「想跟你说件事」。 */
  reason: string;
  createdAt: number;
  expiresAt: number;
};

export type VoiceCallInviteRequest = {
  collaboratorId: string;
  collaboratorName?: string;
  conversationId: string;
  reason?: string;
  now?: number;
  id?: string;
};

let inviteSequence = 0;

function nextInviteId(now: number) {
  inviteSequence += 1;
  return `voice-call-${now.toString(36)}-${inviteSequence.toString(36)}`;
}

export function normalizeVoiceCallReason(value: string | undefined | null) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, VOICE_CALL_INVITE_MAX_REASON_CHARS);
}

export function createVoiceCallInvite(request: VoiceCallInviteRequest): VoiceCallInvite {
  const now = request.now ?? Date.now();
  return {
    id: request.id?.trim() || nextInviteId(now),
    collaboratorId: request.collaboratorId,
    collaboratorName: request.collaboratorName?.trim() ?? '',
    conversationId: request.conversationId,
    reason: normalizeVoiceCallReason(request.reason),
    createdAt: now,
    expiresAt: now + VOICE_CALL_INVITE_TTL_MS
  };
}

export function isVoiceCallInviteExpired(invite: VoiceCallInvite, now = Date.now()) {
  return invite.expiresAt <= now;
}

/**
 * 界面上一句「XX 想跟你通话」。名字拿不到时不硬编一个「对方」占位，
 * 交给调用方用自己的兜底文案 —— 这里只负责拼名字。
 */
export function describeVoiceCallInvite(invite: VoiceCallInvite, someoneLabel: string) {
  const name = invite.collaboratorName.trim() || someoneLabel;
  return { name, reason: invite.reason };
}
