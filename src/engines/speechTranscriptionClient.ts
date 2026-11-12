import type { VoiceTranscriptionProviderType, VoiceTranscriptionSettings } from '../types/domain';
import { canUseNativeProviderHttp, executeNativeProviderHttpBinaryRequest } from '../native/providerHttp';

/**
 * Speech-to-text for voice call mode.
 *
 * Audio is uploaded as multipart/form-data, but every vendor wants a different
 * endpoint, auth header, multipart field name and language switch, so those
 * request details live in a per-provider profile instead of in user settings.
 * On native builds the request goes through the native HTTP bridge because a
 * WebView fetch to a third-party host is subject to CORS; the plain fetch
 * branch is what desktop and web use.
 */

export type TranscriptionProviderProfile = {
  /** Default path appended to the configured Base URL. */
  path: string;
  /** Default model id for this vendor. */
  model: string;
  /** Multipart field that carries the model id. */
  modelField: string;
  /** Request header that carries the api key. */
  authHeader: string;
  /** Prefix prepended to the api key, e.g. 'Bearer ' ('' when the raw key is expected). */
  authPrefix: string;
  /** Form field for the language hint; '' sends it as a request header instead. */
  languageField: string;
  /** Whether the endpoint understands response_format=json. */
  supportsResponseFormat: boolean;
};

export const VOICE_TRANSCRIPTION_PROVIDER_PROFILES: Record<VoiceTranscriptionProviderType, TranscriptionProviderProfile> = {
  'openai-compatible': {
    path: '/audio/transcriptions',
    model: 'whisper-1',
    modelField: 'model',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    languageField: 'language',
    supportsResponseFormat: true
  },
  // MiniMax ASR: Bearer key, same shape as the OpenAI endpoint, but it pins the
  // language with a request header instead of a form field.
  minimax: {
    path: '/speech_to_text',
    model: 'asr-1.0',
    modelField: 'model',
    authHeader: 'Authorization',
    authPrefix: 'Bearer ',
    languageField: '',
    supportsResponseFormat: true
  },
  // ElevenLabs Scribe: xi-api-key auth, model id travels in `model_id`, and
  // there is no response_format switch (JSON is the only format).
  elevenlabs: {
    path: '/speech-to-text',
    model: 'scribe_v1',
    modelField: 'model_id',
    authHeader: 'xi-api-key',
    authPrefix: '',
    languageField: 'language_code',
    supportsResponseFormat: false
  }
};

export function resolveTranscriptionProviderType(
  settings?: { providerType?: VoiceTranscriptionProviderType } | null
): VoiceTranscriptionProviderType {
  const value = settings?.providerType;
  if (value && Object.prototype.hasOwnProperty.call(VOICE_TRANSCRIPTION_PROVIDER_PROFILES, value)) {
    return value;
  }
  return 'openai-compatible';
}

export type TranscriptionTarget = {
  providerType: VoiceTranscriptionProviderType;
  profile: TranscriptionProviderProfile;
  url: string;
  apiKey: string;
  model: string;
  language: string;
};

export type TranscribeAudioArgs = {
  target: TranscriptionTarget;
  audio: Blob;
  filename: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

function joinEndpoint(baseUrl: string, path: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  const suffix = path.trim().replace(/^\/+/, '');
  return suffix ? `${base}/${suffix}` : base;
}

/**
 * Resolves where a transcription request lands. A blank baseUrl or key falls
 * back to the playback config when reuse is on, so one provider only has to be
 * entered once.
 */
export function resolveTranscriptionTarget(
  settings: VoiceTranscriptionSettings,
  voiceGeneration?: { baseUrl?: string; apiKey?: string } | null
): TranscriptionTarget {
  const reuse = settings.reuseVoiceBaseUrl !== false;
  const baseUrl = settings.baseUrl?.trim() || (reuse ? voiceGeneration?.baseUrl?.trim() ?? '' : '');
  const apiKey = settings.apiKey?.trim() || (reuse ? voiceGeneration?.apiKey?.trim() ?? '' : '');

  if (!settings.enabled) {
    throw new Error('语音识别尚未开启。请先到设置 → 语音里打开「语音识别」。');
  }
  if (!baseUrl) {
    throw new Error('请先填写语音识别的 Base URL。');
  }
  if (!apiKey) {
    throw new Error('请先填写语音识别的 API Key。');
  }

  const providerType = resolveTranscriptionProviderType(settings);
  const profile = VOICE_TRANSCRIPTION_PROVIDER_PROFILES[providerType];

  return {
    providerType,
    profile,
    url: joinEndpoint(baseUrl, settings.path?.trim() || profile.path),
    apiKey,
    model: settings.model?.trim() || profile.model,
    language: settings.language?.trim() || ''
  };
}

type MultipartFile = {
  name: string;
  filename: string;
  contentType: string;
  data: Uint8Array;
};

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function buildMultipartBody(
  boundary: string,
  fields: Array<{ name: string; value: string }>,
  files: MultipartFile[]
): Uint8Array {
  const segments: Uint8Array[] = [];

  for (const field of fields) {
    if (!field.value) continue;
    segments.push(encodeText(
      `--${boundary}\r\nContent-Disposition: form-data; name="${field.name}"\r\n\r\n${field.value}\r\n`
    ));
  }

  for (const file of files) {
    segments.push(encodeText(
      `--${boundary}\r\nContent-Disposition: form-data; name="${file.name}"; filename="${file.filename}"\r\n`
      + `Content-Type: ${file.contentType}\r\n\r\n`
    ));
    segments.push(file.data);
    segments.push(encodeText('\r\n'));
  }

  segments.push(encodeText(`--${boundary}--\r\n`));

  const total = segments.reduce((sum, segment) => sum + segment.length, 0);
  const body = new Uint8Array(total);
  let offset = 0;
  for (const segment of segments) {
    body.set(segment, offset);
    offset += segment.length;
  }
  return body;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function createBoundary(): string {
  return `----polarisSpeech${Date.now().toString(36)}${Math.random().toString(16).slice(2, 10)}`;
}

function readTranscriptionText(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text.trim();
  const nested = record.data;
  if (nested && typeof nested === 'object') {
    const nestedText = (nested as Record<string, unknown>).text;
    if (typeof nestedText === 'string') return nestedText.trim();
  }
  return '';
}

function describeFailure(status: number, body: string): string {
  const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 180);
  return `语音识别接口 ${status}${snippet ? `：${snippet}` : ''}`;
}

export async function transcribeAudio(args: TranscribeAudioArgs): Promise<string> {
  const { target, audio, filename } = args;
  const { profile } = target;
  const boundary = createBoundary();
  const fileBytes = new Uint8Array(await audio.arrayBuffer());
  const contentType = audio.type || 'audio/webm';

  const fields: Array<{ name: string; value: string }> = [
    { name: profile.modelField, value: target.model }
  ];
  if (profile.supportsResponseFormat) {
    fields.push({ name: 'response_format', value: 'json' });
  }
  if (target.language && profile.languageField) {
    fields.push({ name: profile.languageField, value: target.language });
  }

  const headers: Record<string, string> = {
    [profile.authHeader]: `${profile.authPrefix}${target.apiKey}`
  };
  if (target.language && !profile.languageField) {
    headers.language = target.language;
  }

  const bodyBytes = buildMultipartBody(
    boundary,
    fields,
    [{ name: 'file', filename, contentType, data: fileBytes }]
  );
  const multipartContentType = `multipart/form-data; boundary=${boundary}`;

  if (canUseNativeProviderHttp()) {
    let responseStatus = 0;
    let responseBody = '';
    await executeNativeProviderHttpBinaryRequest({
      url: target.url,
      headers,
      bodyBase64: bytesToBase64(bodyBytes),
      contentType: multipartContentType,
      signal: args.signal,
      onResponse: (response) => {
        responseStatus = response.status;
      },
      onTextChunk: (chunk) => {
        responseBody += chunk;
      }
    });

    if (responseStatus < 200 || responseStatus >= 300) {
      throw new Error(describeFailure(responseStatus, responseBody));
    }
    return readTranscriptionText(safeParseJson(responseBody));
  }

  const fetchImpl = args.fetchImpl ?? fetch;
  const form = new FormData();
  for (const field of fields) {
    form.append(field.name, field.value);
  }
  form.append('file', audio, filename);

  const response = await fetchImpl(target.url, {
    method: 'POST',
    headers,
    body: form,
    signal: args.signal
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(describeFailure(response.status, text));
  }
  return readTranscriptionText(safeParseJson(text));
}

function safeParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
