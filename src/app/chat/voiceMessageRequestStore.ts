/**
 * “小机想发一条语音”的待确认状态。
 *
 * 一次申请只活在进程内存里：重启后没有意义，也不该做成持久待办。
 * 申请里不带音频——真正的合成要等用户点「允许」之后才发生，
 * 所以这里存下来只是“想问一句”，一分额度都不花。
 */

export type VoiceMessageRequest = {
  id: string;
  conversationId: string;
  /** 发起申请的协作者，用来在卡片上写名字。 */
  collaboratorId: string;
  collaboratorName: string;
  /** 要念出来的那句话。 */
  text: string;
  /** 估算时长（秒）；算不出来就不显示。 */
  durationSeconds?: number;
  createdAt: number;
};

const UPDATE_EVENT = 'polaris:voice-message-request-updated';

let pending: VoiceMessageRequest | null = null;

function emit() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT, { detail: pending }));
}

function createId() {
  return `voice-request-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
}

export function requestVoiceMessage(args: {
  conversationId: string;
  collaboratorId: string;
  collaboratorName: string;
  text: string;
  durationSeconds?: number;
}): VoiceMessageRequest {
  pending = {
    id: createId(),
    conversationId: args.conversationId,
    collaboratorId: args.collaboratorId,
    collaboratorName: args.collaboratorName,
    text: args.text,
    durationSeconds: args.durationSeconds,
    createdAt: Date.now()
  };
  emit();
  return pending;
}

export function readVoiceMessageRequest(conversationId?: string): VoiceMessageRequest | null {
  if (!pending) return null;
  if (!conversationId) return pending;
  return pending.conversationId === conversationId ? pending : null;
}

export function clearVoiceMessageRequest(id?: string) {
  if (!pending) return;
  if (id && pending.id !== id) return;
  pending = null;
  emit();
}

export function subscribeVoiceMessageRequests(listener: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  const handler = () => listener();
  window.addEventListener(UPDATE_EVENT, handler);
  return () => window.removeEventListener(UPDATE_EVENT, handler);
}

const CJK_PATTERN = /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g;

/**
 * 估算这句话念出来大概几秒，只用来在卡片上写「约 N″」。
 *
 * 汉字按每秒 4.5 个字、其它字符按每秒 14 个算；算不准没关系，真时长最后由音频决定。
 */
export function estimateVoiceSeconds(text: string): number | undefined {
  const normalized = text.trim();
  if (!normalized) return undefined;
  const cjkCount = (normalized.match(CJK_PATTERN) ?? []).length;
  const otherCount = Math.max(0, normalized.length - cjkCount);
  const seconds = cjkCount / 4.5 + otherCount / 14;
  return Math.max(1, Math.round(seconds));
}
