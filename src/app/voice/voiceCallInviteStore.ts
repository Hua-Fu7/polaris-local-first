import {
  isVoiceCallInviteExpired,
  type VoiceCallInvite
} from '../../engines/voiceCallInvite';

/**
 * 「协作者打进来的一通电话」在进程内的落脚点。
 *
 * 工具执行发生在引擎层（`ToolContext`），而响铃要由聊天世界的通话浮层来做，
 * 两者之间没有现成的通道。这里用一个模块级的极简 store 搭桥：工具写、界面读。
 *
 * 故意不落盘：一通没人接的电话在重启后毫无意义，而且它随时可能过期。
 */
let current: VoiceCallInvite | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of [...listeners]) listener();
}

function setCurrent(next: VoiceCallInvite | null) {
  if (current === next) return;
  current = next;
  emit();
}

export function subscribeVoiceCallInvite(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * 给 React 读的快照。必须保持纯粹（同样的 store 状态 → 同样的返回值），
 * 所以这里不做过期清理；过期的判断交给 `readVoiceCallInvite`。
 */
export function getVoiceCallInviteSnapshot(): VoiceCallInvite | null {
  return current;
}

/** 服务端渲染只可能在单测里发生，那里永远没有来电。 */
export function getVoiceCallInviteServerSnapshot(): VoiceCallInvite | null {
  return null;
}

/** 过期的请求读出来就是 null：调用方不必自己再判一次。 */
export function readVoiceCallInvite(now = Date.now()): VoiceCallInvite | null {
  if (current && isVoiceCallInviteExpired(current, now)) {
    setCurrent(null);
  }
  return current;
}

export function publishVoiceCallInvite(invite: VoiceCallInvite) {
  setCurrent(invite);
  return invite;
}

/**
 * 取走并清空。用在用户「接听」的那一刻：一旦接通，这块界面就该消失，
 * 而且不该被后到的渲染再弹一次。
 */
export function takeVoiceCallInvite(id?: string): VoiceCallInvite | null {
  const invite = readVoiceCallInvite();
  if (!invite) return null;
  if (id && invite.id !== id) return null;
  setCurrent(null);
  return invite;
}

/** 用户点了拒接。 */
export function clearVoiceCallInvite(id?: string) {
  const invite = readVoiceCallInvite();
  if (!invite) return;
  if (id && invite.id !== id) return;
  setCurrent(null);
}

/** 单测用：清掉可能残留的来电。 */
export function resetVoiceCallInviteStore() {
  setCurrent(null);
}
