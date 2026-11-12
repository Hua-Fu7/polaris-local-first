import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { VoiceMessageRequest } from '../../../../app/chat/voiceMessageRequestStore';
import { VoiceMessageConfirmRow } from './VoiceMessageConfirmRow';

function createRequest(extra?: Partial<VoiceMessageRequest>): VoiceMessageRequest {
  return {
    id: 'voice-request-1',
    conversationId: 'conversation-1',
    collaboratorId: 'collaborator-1',
    collaboratorName: '小机',
    text: '在吗',
    durationSeconds: 12,
    createdAt: 1,
    ...extra
  };
}

function render(request: VoiceMessageRequest) {
  return renderToStaticMarkup(
    createElement(VoiceMessageConfirmRow, {
      request,
      onAllow: vi.fn(),
      onDismiss: vi.fn()
    })
  );
}

describe('VoiceMessageConfirmRow', () => {
  it('puts the confirmation card in its own flow row', () => {
    const html = render(createRequest());

    expect(html).toContain('message-voice-confirm-row');
    expect(html).toContain('message-voice-confirm');
    expect(html).toContain('小机');
    expect(html).toContain('约 12');
  });

  it('shows the two answers: allow and dismiss', () => {
    const html = render(createRequest());

    expect(html).toContain('允许');
    expect(html).toContain('不用');
    // 还没点允许：不该出现“合成中”这种已经把额度花掉的措辞。
    expect(html).not.toContain('合成中');
  });

  it('hides the estimate when the duration is unknown', () => {
    const html = render(createRequest({ durationSeconds: undefined }));

    expect(html).toContain('message-voice-confirm-title');
    expect(html).not.toContain('约');
  });
});
