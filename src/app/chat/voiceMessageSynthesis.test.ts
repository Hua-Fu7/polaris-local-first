import { describe, expect, it, vi } from 'vitest';
import type { ChatAttachment, VoiceGenerationSettings } from '../../types/domain';
import type { VoiceGenerationResult } from '../../engines/voiceGenerationClient';
import type { VoiceMessageRequest } from './voiceMessageRequestStore';
import { synthesiseVoiceMessage } from './voiceMessageSynthesis';

const enabledSettings: VoiceGenerationSettings = {
  enabled: true,
  providerType: 'elevenlabs',
  baseUrl: 'https://api.elevenlabs.io/v1',
  apiKey: 'key',
  model: 'eleven_v4',
  voice: 'O5hbZp6U3sOHTP1htXRs',
  format: 'mp3'
};

function createRequest(text = '晚安，早点睡'): VoiceMessageRequest {
  return {
    id: 'voice-request-1',
    conversationId: 'conversation-1',
    collaboratorId: 'collaborator-1',
    collaboratorName: 'Rune',
    text,
    createdAt: 1
  };
}

function createSpeech(overrides: Partial<VoiceGenerationResult> = {}): VoiceGenerationResult {
  return {
    blob: new Blob(['mp3-bytes'], { type: 'audio/mpeg' }),
    mimeType: 'audio/mpeg',
    model: 'eleven_v4',
    voice: 'O5hbZp6U3sOHTP1htXRs',
    format: 'mp3',
    ...overrides
  };
}

function createAttachment(): ChatAttachment {
  return {
    id: 'attachment-1',
    assetId: 'asset-1',
    kind: 'file',
    name: 'Polaris-voice-20260101000000.mp3',
    mimeType: 'audio/mpeg',
    size: 9
  };
}

describe('synthesiseVoiceMessage', () => {
  it('synthesises the requested line and stores it as a playable audio attachment', async () => {
    const synthesise = vi.fn(async () => createSpeech());
    const storeAudio = vi.fn(async () => createAttachment());

    const result = await synthesiseVoiceMessage({
      request: createRequest('  晚安，早点睡  '),
      settings: enabledSettings,
      deps: { synthesise, storeAudio, now: () => 1781376062000 }
    });

    expect(synthesise).toHaveBeenCalledWith(expect.objectContaining({
      settings: enabledSettings,
      text: '晚安，早点睡'
    }));
    expect(storeAudio).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'file',
      name: expect.stringMatching(/^Polaris-voice-\d{14}\.mp3$/),
      mimeType: 'audio/mpeg',
      createdAt: 1781376062000
    }));
    expect(result.ok).toBe(true);
    expect(result.ok ? result.transcript : '').toBe('晚安，早点睡');
    // 语音条只认 audio/* 的附件；kind 必须是 file，不能是 image。
    expect(result.ok ? result.attachment.kind : 'image').toBe('file');
  });

  it('never calls the provider when voice generation is switched off', async () => {
    const synthesise = vi.fn();
    const result = await synthesiseVoiceMessage({
      request: createRequest(),
      settings: { ...enabledSettings, enabled: false },
      deps: { synthesise, storeAudio: vi.fn() }
    });

    expect(synthesise).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('还没开启');
  });

  it('asks for the voice provider instead of failing deep inside the request', async () => {
    const synthesise = vi.fn();
    const result = await synthesiseVoiceMessage({
      request: createRequest(),
      settings: { ...enabledSettings, apiKey: '   ' },
      deps: { synthesise, storeAudio: vi.fn() }
    });

    expect(synthesise).not.toHaveBeenCalled();
    expect(result.ok ? '' : result.error).toContain('还没有配置语音接口');
  });

  it('surfaces the provider error and keeps the quota for another try', async () => {
    const result = await synthesiseVoiceMessage({
      request: createRequest(),
      settings: enabledSettings,
      deps: {
        synthesise: vi.fn(async () => {
          throw new Error('额度不够了');
        }),
        storeAudio: vi.fn()
      }
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toBe('额度不够了');
  });

  it('treats an empty audio body as a failure', async () => {
    const storeAudio = vi.fn();
    const result = await synthesiseVoiceMessage({
      request: createRequest(),
      settings: enabledSettings,
      deps: {
        synthesise: vi.fn(async () => createSpeech({ blob: new Blob([], { type: 'audio/mpeg' }) })),
        storeAudio
      }
    });

    expect(storeAudio).not.toHaveBeenCalled();
    expect(result.ok ? '' : result.error).toContain('没有返回音频');
  });

  it('reports a storage failure instead of silently dropping the audio', async () => {
    const result = await synthesiseVoiceMessage({
      request: createRequest(),
      settings: enabledSettings,
      deps: {
        synthesise: vi.fn(async () => createSpeech()),
        storeAudio: vi.fn(async () => {
          throw new Error('磁盘满了');
        })
      }
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toContain('存到本地失败');
  });
});
