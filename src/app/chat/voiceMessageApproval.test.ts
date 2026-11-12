import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatAttachment, ChatMessage, VoiceGenerationSettings } from '../../types/domain';
import type { VoiceGenerationResult } from '../../engines/voiceGenerationClient';
import {
  clearVoiceMessageRequest,
  readVoiceMessageRequest,
  requestVoiceMessage
} from './voiceMessageRequestStore';
import { approveVoiceMessage } from './voiceMessageApproval';

const settings: VoiceGenerationSettings = {
  enabled: true,
  providerType: 'elevenlabs',
  baseUrl: 'https://api.elevenlabs.io/v1',
  apiKey: 'key',
  model: 'eleven_v4',
  voice: 'O5hbZp6U3sOHTP1htXRs',
  format: 'mp3'
};

const speech: VoiceGenerationResult = {
  blob: new Blob(['mp3-bytes'], { type: 'audio/mpeg' }),
  mimeType: 'audio/mpeg',
  model: 'eleven_v4',
  voice: 'O5hbZp6U3sOHTP1htXRs',
  format: 'mp3'
};

const attachment: ChatAttachment = {
  id: 'attachment-1',
  assetId: 'asset-1',
  kind: 'file',
  name: 'Polaris-voice-20260614000102.mp3',
  mimeType: 'audio/mpeg',
  size: 9
};

function createPendingRequest() {
  return requestVoiceMessage({
    conversationId: 'conversation-1',
    collaboratorId: 'collaborator-1',
    collaboratorName: 'Rune',
    text: '晚安，早点睡',
    durationSeconds: 2
  });
}

describe('approveVoiceMessage', () => {
  afterEach(() => {
    clearVoiceMessageRequest();
  });

  it('delivers one assistant message whose audio attachment renders as a voice bar', async () => {
    const request = createPendingRequest();
    const delivered: ChatMessage[] = [];

    const result = await approveVoiceMessage({
      request,
      settings,
      deliver: (message) => {
        delivered.push(message);
        return true;
      },
      deps: { synthesise: vi.fn(async () => speech), storeAudio: vi.fn(async () => attachment) }
    });

    expect(result.ok).toBe(true);
    expect(delivered).toHaveLength(1);
    const message = delivered[0];
    expect(message.role).toBe('assistant');
    // 正文就是文字稿：语音条展开后显示它。
    expect(message.content).toBe('晚安，早点睡');
    expect(message.attachments).toEqual([attachment]);
    expect(message.assistantName).toBe('Rune');
    expect(message.speakerCollaboratorId).toBe('collaborator-1');
    // 发出去之后卡片就该消失。
    expect(readVoiceMessageRequest('conversation-1')).toBeNull();
  });

  it('keeps the request when synthesis fails so the user can try again', async () => {
    const request = createPendingRequest();
    const deliver = vi.fn();

    const result = await approveVoiceMessage({
      request,
      settings,
      deliver,
      deps: {
        synthesise: vi.fn(async () => {
          throw new Error('额度不够了');
        }),
        storeAudio: vi.fn()
      }
    });

    expect(result.ok).toBe(false);
    expect(deliver).not.toHaveBeenCalled();
    expect(readVoiceMessageRequest('conversation-1')?.id).toBe(request.id);
  });

  it('keeps the request when the conversation is already gone', async () => {
    const request = createPendingRequest();

    const result = await approveVoiceMessage({
      request,
      settings,
      deliver: () => false,
      deps: { synthesise: vi.fn(async () => speech), storeAudio: vi.fn(async () => attachment) }
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('语音没能发出去');
    expect(readVoiceMessageRequest('conversation-1')?.id).toBe(request.id);
  });
});
