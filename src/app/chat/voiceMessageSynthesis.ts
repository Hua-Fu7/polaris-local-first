import { createStoredAttachment } from '../../infrastructure/assetStore';
import { requestGeneratedSpeech, type VoiceGenerationResult } from '../../engines/voiceGenerationClient';
import type { ChatAttachment, VoiceGenerationFormat, VoiceGenerationSettings } from '../../types/domain';
import type { VoiceMessageRequest } from './voiceMessageRequestStore';

type Synthesis = (args: {
  settings: VoiceGenerationSettings;
  text: string;
  signal?: AbortSignal;
}) => Promise<VoiceGenerationResult>;

type AudioStore = (args: {
  kind: 'file';
  name: string;
  mimeType: string;
  blob: Blob;
  createdAt: number;
}) => Promise<ChatAttachment>;

export type VoiceMessageSynthesisDeps = {
  /** 合成一句（默认走 ElevenLabs / 已配置的语音接口）。 */
  synthesise?: Synthesis;
  /** 把音频落成本地资产并返回附件（默认 createStoredAttachment）。 */
  storeAudio?: AudioStore;
  now?: () => number;
};

export type VoiceMessageSynthesisResult =
  | { ok: true; attachment: ChatAttachment; transcript: string }
  | { ok: false; error: string };

const EXTENSION_BY_FORMAT: Record<VoiceGenerationFormat, string> = {
  mp3: 'mp3',
  opus: 'opus',
  aac: 'aac',
  flac: 'flac',
  wav: 'wav',
  pcm: 'pcm'
};

function formatStamp(timestamp: number) {
  const date = new Date(timestamp);
  const pad = (value: number) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds())
  ].join('');
}

/**
 * 用户点了「允许」之后才走到这里：把申请里那句话合成成音频，并落成本地附件。
 *
 * 附件是 `kind: 'file'` + `audio/*`：`MessageRow` 现有逻辑看到音频附件就会画成语音条，
 * 不需要额外约定。合成失败时返回错误文案，申请仍然留着，用户可以再点一次。
 */
export async function synthesiseVoiceMessage(args: {
  request: VoiceMessageRequest;
  settings: VoiceGenerationSettings;
  signal?: AbortSignal;
  deps?: VoiceMessageSynthesisDeps;
}): Promise<VoiceMessageSynthesisResult> {
  const transcript = args.request.text.trim();
  if (!transcript) {
    return { ok: false, error: '这句话是空的，没法合成语音。' };
  }

  const settings = args.settings;
  if (!settings.enabled) {
    return { ok: false, error: '语音功能还没开启：到设置 → 语音里打开朗读再来。' };
  }
  if (!settings.baseUrl?.trim() || !settings.apiKey?.trim()) {
    return { ok: false, error: '还没有配置语音接口：到设置 → 语音里填好 key 再试。' };
  }

  const synthesise = args.deps?.synthesise ?? requestGeneratedSpeech;
  const storeAudio = args.deps?.storeAudio ?? createStoredAttachment;
  const now = args.deps?.now ?? Date.now;

  let result: VoiceGenerationResult;
  try {
    result = await synthesise({ settings, text: transcript, signal: args.signal });
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '语音合成失败了。'
    };
  }

  if (!result.blob.size) {
    return { ok: false, error: '语音接口没有返回音频内容。' };
  }

  const createdAt = now();
  const extension = EXTENSION_BY_FORMAT[result.format] ?? 'mp3';
  try {
    const attachment = await storeAudio({
      kind: 'file',
      name: `Polaris-voice-${formatStamp(createdAt)}.${extension}`,
      mimeType: result.mimeType,
      blob: result.blob,
      createdAt
    });
    return { ok: true, attachment, transcript };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error
        ? `语音已经生成，但存到本地失败了：${error.message}`
        : '语音已经生成，但存到本地失败了。'
    };
  }
}
