/**
 * 「当前正在进行的通话」在引擎层和界面层之间的桥。
 *
 * 挂断工具（`hangUp`）在引擎层执行（`ToolContext.hangUp`），但它要挂断的是
 * React 层的活动通话会话（`useVoiceCall` 的 controller）。两者之间没有现成的
 * 通道，所以这里用一个模块级的极简桥：界面层在通话开始/结束时登记一个
 * 「挂断回调」，工具执行时调用它。
 *
 * 故意不落盘：一通通话只在进程内存活，重启后毫无意义。和 `voiceCallInviteStore`
 * 是同一套思路——一个是「有人打进来」的桥，这个是「正在通话」的桥。
 *
 * 保持纯粹（不引 React、不引 store），因为它同时被工具执行层（写/触发）
 * 和界面层（登记回调）用到。
 */

type ActiveCallState = {
  conversationId: string;
  collaboratorId: string;
  collaboratorName: string;
  /** 界面层登记的回调：工具执行 hangUp 时调用它真正挂断。 */
  hangUp: () => void;
};

let current: ActiveCallState | null = null;

/**
 * 界面层在通话接通时调用，登记这一通活动通话和它的挂断回调。
 * 返回 true 表示登记成功；同一时间只有一通通话，重复登记会覆盖旧的。
 */
export function registerActiveVoiceCall(state: ActiveCallState): void {
  current = state;
}

/** 界面层在通话结束时调用，清掉登记。 */
export function unregisterActiveVoiceCall(): void {
  current = null;
}

/** 引擎层读：现在有没有一通正在进行的通话。 */
export function readActiveVoiceCall(): ActiveCallState | null {
  return current;
}

/** 引擎层触发：让界面层挂断当前这通电话。返回 false 表示没有活动通话可挂。 */
export function requestActiveVoiceCallHangUp(): boolean {
  const state = current;
  if (!state) return false;
  state.hangUp();
  return true;
}

/** 单测用：清掉可能残留的活动通话。 */
export function resetActiveVoiceCallBridge(): void {
  current = null;
}
