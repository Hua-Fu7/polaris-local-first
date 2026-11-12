import { describe, expect, it } from 'vitest';
import { createTriggerMessage } from './triggerMessage';
import type { PolarisTriggerRule } from '../../types/domain';
import type { RuntimeTriggerEvent } from '../../stores/runtimeStoreTriggers';

function createRule(): PolarisTriggerRule {
  return {
    id: 'trigger-1',
    name: '晚安',
    enabled: true,
    source: 'schedule',
    webhookSecret: 'secret-1',
    schedule: { kind: 'daily', time: '22:30' },
    target: { collaboratorId: 'nova', conversationMode: 'follow-latest', conversationId: null },
    action: { prompt: '看看我今天状态' },
    createdAt: 1000,
    updatedAt: 1000,
    lastRunAt: null,
    nextRunAt: 2000,
    lastError: null
  };
}

describe('createTriggerMessage', () => {
  it('labels scheduled trigger messages as scheduled wakeups', () => {
    const message = createTriggerMessage(createRule(), null);

    expect(message.content).toBe('（定时唤醒：晚安）');
    expect(message.requestRole).toBe('user');
    expect(message.requestContent).toBe('看看我今天状态');
  });

  it('keeps trigger instructions out of the visible timeline message', () => {
    const event: RuntimeTriggerEvent = {
      id: 'event-1',
      ruleId: 'trigger-1',
      prompt: '我刚到家',
      source: 'shortcut',
      receivedAt: 1000
    };

    const message = createTriggerMessage(createRule(), event);

    expect(message.role).toBe('system');
    expect(message.origin).toBe('trigger-runtime');
    expect(message.content).toBe('（快捷指令唤醒：晚安）');
    expect(message.content).not.toContain('醒来的原因');
    expect(message.requestRole).toBe('user');
    expect(message.requestContent).toBe('看看我今天状态\n\n我刚到家');
    expect(message.requestContent).not.toContain('主动唤醒事件');
    expect(message.requestContent).not.toContain('不要解释触发器');
  });

  it('appends the decision layer direction as a labelled hint, not as a finished line', () => {
    const message = createTriggerMessage(createRule(), null, '上次那个配色的对比度');

    expect(message.requestContent).toBe('看看我今天状态\n\n本次主动开口的方向：上次那个配色的对比度');
    expect(message.content).toBe('（定时唤醒：晚安）');
  });

  it('treats a blank decision direction as no direction at all', () => {
    const message = createTriggerMessage(createRule(), null, '   ');

    expect(message.requestContent).toBe('看看我今天状态');
  });

  it('keeps the wakeup prompt ahead of the decision direction', () => {
    const event: RuntimeTriggerEvent = {
      id: 'event-2',
      ruleId: 'trigger-1',
      prompt: '我刚到家',
      source: 'notification',
      receivedAt: 1000
    };

    const message = createTriggerMessage(createRule(), event, '问问他今天怎么样');

    expect(message.requestContent).toBe('看看我今天状态\n\n本次主动开口的方向：问问他今天怎么样\n\n我刚到家');
  });
});
