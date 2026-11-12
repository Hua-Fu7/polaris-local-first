import { createMessage } from '../../engines/chatMessageFactory';
import type { ChatMessage, PolarisTriggerRule } from '../../types/domain';
import type { RuntimeTriggerEvent } from '../../stores/runtimeStoreTriggers';

function buildTriggerRequestContent(
  rule: PolarisTriggerRule,
  event: RuntimeTriggerEvent | null,
  decisionPrompt?: string | null
) {
  // decisionPrompt 来自主动消息决策层：它只给"这次想聊什么"的方向，
  // 最终怎么说仍然交给回复链路，所以这里额外加一层说明避免被当成要照抄的成品话术。
  const decisionDirection = decisionPrompt?.trim();
  return [
    rule.action.prompt,
    decisionDirection ? `本次主动开口的方向：${decisionDirection}` : null,
    event?.prompt ?? null
  ]
    .filter((line): line is string => Boolean(line?.trim()))
    .join('\n\n');
}

function buildTriggerTimelineContent(rule: PolarisTriggerRule, event: RuntimeTriggerEvent | null) {
  const sourceLabel = event?.source === 'shortcut'
    ? '快捷指令唤醒'
    : event?.source === 'notification'
      ? '通知唤醒'
      : rule.source === 'schedule'
        ? '定时唤醒'
        : '主动唤醒';
  return `（${sourceLabel}：${rule.name}）`;
}

export function createTriggerMessage(
  rule: PolarisTriggerRule,
  event: RuntimeTriggerEvent | null,
  decisionPrompt?: string | null
): ChatMessage {
  return {
    ...createMessage('system', buildTriggerTimelineContent(rule, event), undefined, 'trigger-runtime'),
    requestRole: 'user',
    requestContent: buildTriggerRequestContent(rule, event, decisionPrompt)
  };
}
