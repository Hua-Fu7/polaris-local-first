import type { ToolAction } from './toolExecutorTypes';
import type { ToolActionDescription } from './toolExecutorDescribe';

export type VoiceCallToolAction = Extract<ToolAction, { kind: 'startVoiceCall' }>;
export type HangUpToolAction = Extract<ToolAction, { kind: 'hangUp' }>;

/**
 * 「主动打电话」这一个动作的自然语言描述。它没有主题/文件耦合，
 * 只需要把「打给谁、为什么打」讲清楚，好让工具卡片读懂这条调用。
 */
export function describeVoiceCallToolAction(action: VoiceCallToolAction): ToolActionDescription {
  const reason = action.reason?.trim();
  return {
    kind: action.kind,
    title: '主动打电话',
    summary: reason
      ? `${action.targetLabel || '给对方打一通语音电话'} · ${reason}`
      : action.targetLabel || '给对方打一通语音电话',
    targetLabel: action.targetLabel
  };
}

/**
 * 「挂断通话」这一个动作的自然语言描述。和打电话相反，它只发生在通话中，
 * 描述里也把「结束这通电话」这件事讲清楚，而不是再套一层打电话的语义。
 */
export function describeHangUpToolAction(action: HangUpToolAction): ToolActionDescription {
  const reason = action.reason?.trim();
  return {
    kind: action.kind,
    title: '挂断通话',
    summary: reason
      ? `${action.targetLabel || '挂断正在进行的语音通话'} · ${reason}`
      : action.targetLabel || '挂断正在进行的语音通话',
    targetLabel: action.targetLabel
  };
}
