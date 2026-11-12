import { describe, expect, it, vi } from 'vitest';
import {
  resolveTranscriptionProviderType,
  resolveTranscriptionTarget,
  transcribeAudio
} from './speechTranscriptionClient';
import type { VoiceTranscriptionProviderType, VoiceTranscriptionSettings } from '../types/domain';

const baseSettings: VoiceTranscriptionSettings = {
  enabled: true,
  providerType: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test'
};

function settingsFor(providerType: VoiceTranscriptionProviderType): VoiceTranscriptionSettings {
  return { ...baseSettings, providerType };
}

describe('resolveTranscriptionTarget', () => {
  it('defaults to the OpenAI compatible endpoint', () => {
    const target = resolveTranscriptionTarget(settingsFor('openai-compatible'));
    expect(target.url).toBe('https://api.example.com/v1/audio/transcriptions');
    expect(target.model).toBe('whisper-1');
    expect(target.profile.authHeader).toBe('Authorization');
  });

  it('routes MiniMax to speech_to_text with the asr-1.0 model', () => {
    const target = resolveTranscriptionTarget(settingsFor('minimax'));
    expect(target.url).toBe('https://api.example.com/v1/speech_to_text');
    expect(target.model).toBe('asr-1.0');
    expect(target.profile.modelField).toBe('model');
  });

  it('routes ElevenLabs to speech-to-text with Scribe and xi-api-key auth', () => {
    const target = resolveTranscriptionTarget({
      ...settingsFor('elevenlabs'),
      baseUrl: 'https://api.elevenlabs.io/v1'
    });
    expect(target.url).toBe('https://api.elevenlabs.io/v1/speech-to-text');
    expect(target.model).toBe('scribe_v1');
    expect(target.profile.authHeader).toBe('xi-api-key');
    expect(target.profile.modelField).toBe('model_id');
  });

  it('keeps a hand written path and model', () => {
    const target = resolveTranscriptionTarget({
      ...settingsFor('minimax'),
      path: '/custom/stt',
      model: 'asr-custom'
    });
    expect(target.url).toBe('https://api.example.com/v1/custom/stt');
    expect(target.model).toBe('asr-custom');
  });

  it('falls back to the playback config when reuse is on', () => {
    const target = resolveTranscriptionTarget(
      { enabled: true, reuseVoiceBaseUrl: true },
      { baseUrl: 'https://relay.example.com/v1/', apiKey: 'sk-relay' }
    );
    expect(target.url).toBe('https://relay.example.com/v1/audio/transcriptions');
    expect(target.apiKey).toBe('sk-relay');
  });

  it('refuses to build a target while recognition is off', () => {
    expect(() => resolveTranscriptionTarget({ ...baseSettings, enabled: false })).toThrow(/尚未开启/);
  });
});

describe('resolveTranscriptionProviderType', () => {
  it('falls back to openai-compatible for unknown vendors', () => {
    expect(resolveTranscriptionProviderType(undefined)).toBe('openai-compatible');
    expect(resolveTranscriptionProviderType({ providerType: 'nope' as VoiceTranscriptionProviderType }))
      .toBe('openai-compatible');
  });
});

describe('transcribeAudio provider dispatch', () => {
  const audio = new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mp4' });

  function runWithCapture(settings: VoiceTranscriptionSettings, language = '') {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ text: '你好' }), { status: 200 }));
    const target = resolveTranscriptionTarget({ ...settings, language });
    const result = transcribeAudio({
      target,
      audio,
      filename: 'turn.m4a',
      fetchImpl: fetchImpl as unknown as typeof fetch
    });
    return { fetchImpl, result };
  }

  it('posts Bearer auth and a model field for OpenAI compatible endpoints', async () => {
    const { fetchImpl, result } = runWithCapture(settingsFor('openai-compatible'), 'zh');
    await expect(result).resolves.toBe('你好');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.example.com/v1/audio/transcriptions');
    expect(init.headers).toEqual({ Authorization: 'Bearer sk-test' });
    const form = init.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('zh');
    expect(form.get('response_format')).toBe('json');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('sends xi-api-key and model_id for ElevenLabs Scribe', async () => {
    const { fetchImpl, result } = runWithCapture(
      { ...settingsFor('elevenlabs'), baseUrl: 'https://api.elevenlabs.io/v1' },
      'eng'
    );
    await expect(result).resolves.toBe('你好');

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ 'xi-api-key': 'sk-test' });
    const form = init.body as FormData;
    expect(form.get('model_id')).toBe('scribe_v1');
    expect(form.get('language_code')).toBe('eng');
    // Scribe has no response_format switch.
    expect(form.get('response_format')).toBeNull();
  });

  it('pins the MiniMax language with a header instead of a form field', async () => {
    const { fetchImpl, result } = runWithCapture(settingsFor('minimax'), 'zh');
    await expect(result).resolves.toBe('你好');

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toEqual({ Authorization: 'Bearer sk-test', language: 'zh' });
    const form = init.body as FormData;
    expect(form.get('model')).toBe('asr-1.0');
    expect(form.get('language')).toBeNull();
  });

  it('surfaces the vendor error body', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"bad key"}', { status: 401 }));
    const target = resolveTranscriptionTarget(settingsFor('minimax'));
    await expect(transcribeAudio({
      target,
      audio,
      filename: 'turn.m4a',
      fetchImpl: fetchImpl as unknown as typeof fetch
    })).rejects.toThrow(/401/);
  });
});
