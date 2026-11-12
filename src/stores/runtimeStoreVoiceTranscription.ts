import type { VoiceTranscriptionProviderType, VoiceTranscriptionSettings } from '../types/domain';
import { VOICE_TRANSCRIPTION_PROVIDER_PROFILES } from '../engines/speechTranscriptionClient';

const TRANSCRIPTION_PROVIDER_TYPES = new Set<VoiceTranscriptionProviderType>(
  Object.keys(VOICE_TRANSCRIPTION_PROVIDER_PROFILES) as VoiceTranscriptionProviderType[]
);

const DEFAULT_PROVIDER_TYPE: VoiceTranscriptionProviderType = 'openai-compatible';
const DEFAULT_PROFILE = VOICE_TRANSCRIPTION_PROVIDER_PROFILES[DEFAULT_PROVIDER_TYPE];

export const DEFAULT_VOICE_TRANSCRIPTION_SETTINGS: VoiceTranscriptionSettings = {
  enabled: false,
  providerType: DEFAULT_PROVIDER_TYPE,
  baseUrl: '',
  path: DEFAULT_PROFILE.path,
  apiKey: '',
  model: DEFAULT_PROFILE.model,
  language: '',
  reuseVoiceBaseUrl: true
};

/**
 * Settings written under one provider keep their path/model when the user
 * switches to another one, which would silently keep hitting the wrong
 * endpoint. A value that exactly matches some *other* provider's default is
 * therefore read as "not customised" and replaced by the current provider's
 * default; anything the user typed by hand stays untouched.
 */
function isForeignProviderDefault(
  value: string,
  key: 'path' | 'model',
  providerType: VoiceTranscriptionProviderType
): boolean {
  if (!value) return false;
  if (VOICE_TRANSCRIPTION_PROVIDER_PROFILES[providerType][key] === value) return false;
  return Object.values(VOICE_TRANSCRIPTION_PROVIDER_PROFILES).some((profile) => profile[key] === value);
}

/** Provider switch payload: writes the vendor's endpoint and model in one go. */
export function transcriptionDefaultsForProvider(
  providerType: VoiceTranscriptionProviderType
): Pick<VoiceTranscriptionSettings, 'providerType' | 'path' | 'model'> {
  const profile = VOICE_TRANSCRIPTION_PROVIDER_PROFILES[providerType];
  return { providerType, path: profile.path, model: profile.model };
}

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeProviderType(value: unknown): VoiceTranscriptionProviderType {
  return typeof value === 'string' && TRANSCRIPTION_PROVIDER_TYPES.has(value as VoiceTranscriptionProviderType)
    ? value as VoiceTranscriptionProviderType
    : DEFAULT_PROVIDER_TYPE;
}

function normalizeTimestamp(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeVoiceTranscriptionSettings(value: unknown): VoiceTranscriptionSettings {
  const settings = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<VoiceTranscriptionSettings>
    : {};
  const providerType = normalizeProviderType(settings.providerType);
  const profile = VOICE_TRANSCRIPTION_PROVIDER_PROFILES[providerType];
  const path = normalizeString(settings.path);
  const model = normalizeString(settings.model);

  return {
    enabled: settings.enabled === true,
    providerType,
    baseUrl: normalizeString(settings.baseUrl),
    path: !path || isForeignProviderDefault(path, 'path', providerType) ? profile.path : path,
    apiKey: normalizeString(settings.apiKey),
    model: !model || isForeignProviderDefault(model, 'model', providerType) ? profile.model : model,
    language: normalizeString(settings.language),
    reuseVoiceBaseUrl: settings.reuseVoiceBaseUrl !== false,
    lastUpdatedAt: normalizeTimestamp(settings.lastUpdatedAt)
  };
}

export function mergeVoiceTranscriptionSettings(
  current: VoiceTranscriptionSettings,
  patch: Partial<VoiceTranscriptionSettings>
): VoiceTranscriptionSettings {
  return normalizeVoiceTranscriptionSettings({
    ...current,
    ...patch,
    lastUpdatedAt: Date.now()
  });
}
