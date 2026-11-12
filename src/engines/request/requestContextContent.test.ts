import { describe, expect, it } from 'vitest';
import { buildMessageContent } from './requestContextContent';
import type { RequestMessage } from './requestMessage';

function userMessage(content: string): RequestMessage {
  return {
    id: 'user-test',
    role: 'user',
    content,
    timestamp: 1
  };
}

describe('requestContextContent', () => {
  it('marks standalone digit and punctuation signals before sending them to the model', () => {
    expect(buildMessageContent({ message: userMessage('20'), allowImages: false }))
      .toBe('[用户单独发来] 20');
    expect(buildMessageContent({ message: userMessage('.。????'), allowImages: false }))
      .toBe('[用户单独发来] .。????');
  });

  it('leaves ordinary user text unchanged', () => {
    expect(buildMessageContent({ message: userMessage('那三十'), allowImages: false }))
      .toBe('那三十');
    expect(buildMessageContent({ message: userMessage('数值是 20'), allowImages: false }))
      .toBe('数值是 20');
  });
});