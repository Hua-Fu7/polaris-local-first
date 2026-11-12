import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../types/domain';
import { removeMessageTurn, resolveMessageTurnRange } from './messageTurnRange';

function message(id: string, role: ChatMessage['role'], overrides: Partial<ChatMessage> = {}) {
  return { id, role, content: id, timestamp: 1, ...overrides } as ChatMessage;
}

// 第二轮故意夹了工具消息和续写，确认它们跟着这一轮一起走。
const conversation = [
  message('u-1', 'user'),
  message('a-1', 'assistant'),
  message('u-2', 'user'),
  message('a-2', 'assistant'),
  message('tool-2', 'system', { origin: 'tool-runtime', toolInvocation: { kind: 'runCode' } as never }),
  message('a-2b', 'assistant'),
  message('u-3', 'user'),
  message('a-3', 'assistant')
];

describe('resolveMessageTurnRange', () => {
  it('spans from the user message up to the next user message', () => {
    expect(resolveMessageTurnRange(conversation, 'u-2')).toEqual({ start: 2, end: 6 });
  });

  it('runs to the end of the list for the last turn', () => {
    expect(resolveMessageTurnRange(conversation, 'u-3')).toEqual({ start: 6, end: 8 });
  });

  it('returns null for an unknown id', () => {
    expect(resolveMessageTurnRange(conversation, 'nope')).toBeNull();
  });

  it('returns null when the id is not a user message', () => {
    expect(resolveMessageTurnRange(conversation, 'a-1')).toBeNull();
  });
});

describe('removeMessageTurn', () => {
  it('cuts one turn out of the middle and keeps the later turns', () => {
    expect(removeMessageTurn(conversation, 'u-2')?.map((item) => item.id)).toEqual([
      'u-1',
      'a-1',
      'u-3',
      'a-3'
    ]);
  });

  it('drops the tail turn when it is the last one', () => {
    expect(removeMessageTurn(conversation, 'u-3')?.map((item) => item.id)).toEqual([
      'u-1',
      'a-1',
      'u-2',
      'a-2',
      'tool-2',
      'a-2b'
    ]);
  });

  it('returns null instead of mangling the list for an unknown id', () => {
    expect(removeMessageTurn(conversation, 'nope')).toBeNull();
  });
});
