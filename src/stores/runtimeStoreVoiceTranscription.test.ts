import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE_TRANSCRIPTION_SETTINGS,
  mergeVoiceTranscriptionSettings,
  normalizeVoiceTranscriptionSettings,
  transcriptionDefaultsForProvider
} from './runtimeStoreVoiceTranscription';

describe('normalizeVoiceTranscriptionSettings', () => {
  it('applies the default provider profile', () => {
    expect(normalizeVoiceTranscriptionSettings(undefined)).toEqual(DEFAULT_VOICE_TRANSCRIPTION_SETTINGS);
  });

  it('swaps a foreign provider default for the active provider one', () => {
    // Stored while OpenAI compatible was selected, then the vendor changed.
    const settings = normalizeVoiceTranscriptionSettings({
      enabled: true,
      providerType: 'minimax',
      path: '/audio/transcriptions',
      model: 'whisper-1',
      apiKey: 'sk-test'
    });
    expect(settings.path).toBe('/speech_to_text');
    expect(settings.model).toBe('asr-1.0');
  });

  it('keeps a hand written path and model', () => {
    const settings = normalizeVoiceTranscriptionSettings({
      providerType: 'elevenlabs',
      path: '/my/proxy',
      model: 'scribe_v2'
    });
    expect(settings.path).toBe('/my/proxy');
    expect(settings.model).toBe('scribe_v2');
  });

  it('drops an unknown provider back to the default', () => {
    const settings = normalizeVoiceTranscriptionSettings({
      providerType: 'nope' as never,
      path: '/speech_to_text',
      model: 'asr-1.0'
    });
    expect(settings.providerType).toBe('openai-compatible');
    expect(settings.path).toBe('/audio/transcriptions');
    expect(settings.model).toBe('whisper-1');
  });
});

describe('transcriptionDefaultsForProvider', () => {
  it('returns the vendor endpoint and model together', () => {
    expect(transcriptionDefaultsForProvider('elevenlabs')).toEqual({
      providerType: 'elevenlabs',
      path: '/speech-to-text',
      model: 'scribe_v1'
    });
  });
});

describe('mergeVoiceTranscriptionSettings', () => {
  it('stamps the update time', () => {
    const merged = mergeVoiceTranscriptionSettings(DEFAULT_VOICE_TRANSCRIPTION_SETTINGS, {
      enabled: true,
      providerType: 'minimax'
    });
    expect(merged.enabled).toBe(true);
    expect(merged.model).toBe('asr-1.0');
    expect(typeof merged.lastUpdatedAt).toBe('number');
  });
});
