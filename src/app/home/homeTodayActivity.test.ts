import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../types/domain';
import { countTodayMessages, formatTodayStamp } from './homeTodayActivity';

const now = new Date(2026, 9, 24, 15, 0);

function message(overrides: Partial<ChatMessage> & Pick<ChatMessage, 'id' | 'role'>): ChatMessage {
  return {
    content: '',
    timestamp: now.getTime(),
    ...overrides
  };
}

describe('countTodayMessages', () => {
  it("counts today's conversation only", () => {
    const messages = [
      message({ id: 'u1', role: 'user' }),
      message({ id: 'a1', role: 'assistant' }),
      message({ id: 'a2', role: 'assistant' }),
      message({ id: 'old', role: 'assistant', timestamp: new Date(2026, 9, 23, 23).getTime() })
    ];

    expect(countTodayMessages(messages, now)).toEqual({ me: 1, ai: 2 });
  });

  it('ignores tool receipts', () => {
    const messages = [
      message({ id: 'a1', role: 'assistant' }),
      {
        ...message({ id: 'tool', role: 'system' }),
        toolInvocation: { id: 'tool-1' } as ChatMessage['toolInvocation']
      }
    ];

    expect(countTodayMessages(messages, now)).toEqual({ me: 0, ai: 1 });
  });

  it('ignores messages the trigger runtime wrote on her behalf', () => {
    const messages = [
      message({ id: 'u1', role: 'user', origin: 'trigger-runtime' }),
      message({ id: 'u2', role: 'user', origin: 'user-input' })
    ];

    expect(countTodayMessages(messages, now)).toEqual({ me: 1, ai: 0 });
  });

  it('handles an empty conversation', () => {
    expect(countTodayMessages([], now)).toEqual({ me: 0, ai: 0 });
  });
});

describe('formatTodayStamp', () => {
  it('renders the date and weekday', () => {
    expect(formatTodayStamp(now)).toBe('10 月 24 日 · 周六');
  });
});
