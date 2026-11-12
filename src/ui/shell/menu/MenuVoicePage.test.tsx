import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOICE_CALL_ORB_COLOR,
  VOICE_CALL_ORB_COLOR_SWATCHES
} from '../../../stores/runtimeStoreCustomization';
import { DEFAULT_VOICE_TRANSCRIPTION_SETTINGS } from '../../../stores/runtimeStoreVoiceTranscription';
import type { VoiceGenerationSettings, VoiceTranscriptionSettings } from '../../../types/domain';
import { MenuVoicePage } from './MenuVoicePage';

const voiceGeneration: VoiceGenerationSettings = {
  enabled: true,
  providerType: 'openai-compatible',
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-test',
  model: 'tts-1',
  voice: 'alloy',
  path: '/audio/speech',
  format: 'mp3'
};

function recognitionSection(html: string) {
  const index = html.indexOf('语音识别');
  return index === -1 ? '' : html.slice(index);
}

function swatchChecked(html: string, color: string) {
  const tag = new RegExp(`<button[^>]*aria-label="${color}"[^>]*>`).exec(html);
  return tag ? tag[0].includes('aria-checked="true"') : null;
}

function resetButtonDisabled(html: string) {
  const tag = /<button[^>]*voice-call-orb-color-reset[^>]*>/.exec(html);
  return tag ? /\sdisabled/.test(tag[0]) : null;
}

function render(voiceTranscription: VoiceTranscriptionSettings, voiceCallOrbColor: string | null = null) {
  return renderToStaticMarkup(
    <MenuVoicePage
      voiceGeneration={voiceGeneration}
      voiceTranscription={voiceTranscription}
      voiceCallOrbColor={voiceCallOrbColor}
      onBack={() => {}}
      onSetVoiceGeneration={() => {}}
      onSetVoiceTranscription={() => {}}
      onSetVoiceCallOrbColor={() => {}}
    />
  );
}

describe('MenuVoicePage speech recognition section', () => {
  it('renders the recognition section heading and toggle when disabled', () => {
    const html = render({ ...DEFAULT_VOICE_TRANSCRIPTION_SETTINGS });
    expect(html).toContain('语音识别');
    // 关闭时只显示开关，不展开接口配置
    expect(html).not.toContain('whisper-1');
    expect(html).not.toContain('接口细节');
  });

  it('reveals endpoint fields when recognition is enabled', () => {
    const html = render({
      ...DEFAULT_VOICE_TRANSCRIPTION_SETTINGS,
      enabled: true
    });
    const section = recognitionSection(html);
    expect(section).toContain('whisper-1');
    expect(section).toContain('复用朗读接口的 Base URL 与 Key');
    expect(section).toContain('将跟随朗读接口的 Base URL 与 Key。');
    // 复用朗读地址时，识别区不再重复出现 Base URL 输入框
    expect(section).not.toContain('https://api.example.com/v1');
    expect(section).not.toContain('填写语音供应商的 API Key');
  });

  it('asks for a dedicated Base URL when reuse is turned off', () => {
    const html = render({
      ...DEFAULT_VOICE_TRANSCRIPTION_SETTINGS,
      enabled: true,
      reuseVoiceBaseUrl: false,
      baseUrl: 'https://stt.example.com/v1',
      apiKey: 'sk-stt'
    });
    const section = recognitionSection(html);
    expect(section).toContain('https://stt.example.com/v1');
    expect(section).toContain('sk-stt');
  });

  it('hides the endpoint path until the details toggle is used', () => {
    const html = render({
      ...DEFAULT_VOICE_TRANSCRIPTION_SETTINGS,
      enabled: true
    });
    const section = recognitionSection(html);
    expect(section).toContain('接口细节');
    expect(section).not.toContain('/audio/transcriptions');
  });

  it('offers the three speech-to-text vendors', () => {
    const html = render({
      ...DEFAULT_VOICE_TRANSCRIPTION_SETTINGS,
      enabled: true
    });
    const section = recognitionSection(html);
    expect(section).toContain('接口类型');
    expect(section).toContain('OpenAI 兼容');
    expect(section).toContain('MiniMax T2A');
    expect(section).toContain('ElevenLabs TTS');
  });

  it('shows the MiniMax ASR defaults when that vendor is selected', () => {
    const html = render({
      ...DEFAULT_VOICE_TRANSCRIPTION_SETTINGS,
      enabled: true,
      providerType: 'minimax',
      path: '/speech_to_text',
      model: 'asr-1.0'
    });
    const section = recognitionSection(html);
    expect(section).toContain('asr-1.0');
    expect(section).not.toContain('whisper-1');
    // MiniMax 的识别没有额外提示
    expect(section).not.toContain('api.elevenlabs.io');
  });

  it('shows the ElevenLabs Scribe defaults plus the proxy note', () => {
    const html = render({
      ...DEFAULT_VOICE_TRANSCRIPTION_SETTINGS,
      enabled: true,
      providerType: 'elevenlabs',
      path: '/speech-to-text',
      model: 'scribe_v1'
    });
    const section = recognitionSection(html);
    expect(section).toContain('scribe_v1');
    expect(section).toContain('api.elevenlabs.io');
  });

  it('warns when reuse would borrow another vendor endpoint', () => {
    const withMismatch = render({
      ...DEFAULT_VOICE_TRANSCRIPTION_SETTINGS,
      enabled: true,
      providerType: 'minimax',
      path: '/speech_to_text',
      model: 'asr-1.0'
    });
    expect(recognitionSection(withMismatch)).toContain('朗读和识别选的不是同一家接口');

    // 朗读同样是 OpenAI 兼容时不提示
    const aligned = render({
      ...DEFAULT_VOICE_TRANSCRIPTION_SETTINGS,
      enabled: true
    });
    expect(recognitionSection(aligned)).not.toContain('朗读和识别选的不是同一家接口');

    // 识别有自己独立的地址/Key 时也不提示
    const dedicated = render({
      ...DEFAULT_VOICE_TRANSCRIPTION_SETTINGS,
      enabled: true,
      providerType: 'minimax',
      path: '/speech_to_text',
      model: 'asr-1.0',
      reuseVoiceBaseUrl: false,
      baseUrl: 'https://stt.example.com/v1',
      apiKey: 'sk-stt'
    });
    expect(recognitionSection(dedicated)).not.toContain('朗读和识别选的不是同一家接口');
  });
});

describe('MenuVoicePage call appearance section', () => {
  it('offers the orb colour swatches', () => {
    const html = render({ ...DEFAULT_VOICE_TRANSCRIPTION_SETTINGS });
    expect(html).toContain('通话外观');
    expect(html).toContain('圆环颜色');
    for (const color of VOICE_CALL_ORB_COLOR_SWATCHES) {
      expect(html).toContain(`aria-label="${color}"`);
    }
  });

  it('marks the built-in grey as chosen while nothing is customised', () => {
    const html = render({ ...DEFAULT_VOICE_TRANSCRIPTION_SETTINGS });
    expect(swatchChecked(html, DEFAULT_VOICE_CALL_ORB_COLOR)).toBe(true);
    expect(swatchChecked(html, '#8b7cf6')).toBe(false);
  });

  it('moves the selection onto the stored colour', () => {
    const html = render({ ...DEFAULT_VOICE_TRANSCRIPTION_SETTINGS }, '#8b7cf6');
    expect(swatchChecked(html, '#8b7cf6')).toBe(true);
    expect(swatchChecked(html, DEFAULT_VOICE_CALL_ORB_COLOR)).toBe(false);
  });

  it('keeps reset disabled until a colour has been picked', () => {
    // Nothing customised yet: grey is already the default, so there is nothing to reset.
    expect(resetButtonDisabled(render({ ...DEFAULT_VOICE_TRANSCRIPTION_SETTINGS }))).toBe(true);
    expect(resetButtonDisabled(render({ ...DEFAULT_VOICE_TRANSCRIPTION_SETTINGS }, '#2fb8a8'))).toBe(false);
  });
});
