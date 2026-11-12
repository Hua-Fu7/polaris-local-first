import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearVoiceMessageRequest,
  readVoiceMessageRequest,
  requestVoiceMessage,
  subscribeVoiceMessageRequests
} from './voiceMessageRequestStore';

function createRequest(conversationId = 'conversation-1') {
  return requestVoiceMessage({
    conversationId,
    collaboratorId: 'collaborator-1',
    collaboratorName: '小机',
    text: '在吗',
    durationSeconds: 3
  });
}

describe('voiceMessageRequestStore', () => {
  afterEach(() => {
    clearVoiceMessageRequest();
  });

  it('keeps the request only for the conversation that asked for it', () => {
    createRequest('conversation-1');

    expect(readVoiceMessageRequest('conversation-1')?.text).toBe('在吗');
    expect(readVoiceMessageRequest('conversation-2')).toBeNull();
  });

  it('drops the request once the user dismisses it', () => {
    const request = createRequest();
    clearVoiceMessageRequest(request.id);

    expect(readVoiceMessageRequest('conversation-1')).toBeNull();
  });

  it('ignores a clear that names a different request', () => {
    const request = createRequest();
    clearVoiceMessageRequest('voice-request-someone-else');

    expect(readVoiceMessageRequest('conversation-1')?.id).toBe(request.id);
  });

  it('does not synthesise anything while the request is pending', () => {
    const request = createRequest();

    // 申请里只有“要念的那句话”，没有音频：点允许之前一分额度都不该花。
    expect(request.text).toBe('在吗');
    expect(request).not.toHaveProperty('assetId');
    expect(request).not.toHaveProperty('audioUrl');
  });

  it('keeps subscribers in the loop', () => {
    const target = new EventTarget();
    const originalWindow = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = target;
    const listener = vi.fn();
    const unsubscribe = subscribeVoiceMessageRequests(listener);

    try {
      const request = createRequest();
      expect(listener).toHaveBeenCalledTimes(1);

      clearVoiceMessageRequest(request.id);
      expect(listener).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
      (globalThis as { window?: unknown }).window = originalWindow;
    }
  });
});
