import type { AppBackgroundFit, AppCustomization, CustomFontScope } from '../types/domain';

const BACKGROUND_OPACITY_MIN = 0.12;
const BACKGROUND_OPACITY_MAX = 0.82;
const BACKGROUND_DIM_MIN = 0;
const BACKGROUND_DIM_MAX = 0.72;
const BACKGROUND_BLUR_MIN = 0;
const BACKGROUND_BLUR_MAX = 28;
const STAR_OPACITY_MIN = 0.36;
const STAR_OPACITY_MAX = 1;
const STAR_GLOW_MIN = 0;
const STAR_GLOW_MAX = 1;
const STAR_SCALE_MIN = 0.82;
const STAR_SCALE_MAX = 1.18;
const STAR_WARMTH_MIN = 0;
const STAR_WARMTH_MAX = 1;
export const DEFAULT_APP_STAR_COLOR = '#8edfff';

/** Keep in sync with the `--voice-call-orb-color` fallback in voice-call.css. */
export const DEFAULT_VOICE_CALL_ORB_COLOR = '#8f939a';

export const VOICE_CALL_ORB_COLOR_SWATCHES = [
  DEFAULT_VOICE_CALL_ORB_COLOR,
  '#4f8ff7',
  '#8b7cf6',
  '#2fb8a8',
  '#e874a8',
  '#f0a05a'
] as const;

export const CUSTOM_FONT_SCOPES = ['global', 'titles', 'chat', 'cards'] as const satisfies readonly CustomFontScope[];

export const DEFAULT_CUSTOM_FONT_SCOPE_ASSIGNMENTS: Record<CustomFontScope, string | null> = {
  global: null,
  titles: null,
  chat: null,
  cards: null
};

export const DEFAULT_APP_CUSTOMIZATION: AppCustomization = {
  showChatAvatars: false,
  showCollaboratorName: true,
  showMessageClock: true,
  showModelName: true,
  showTokenUsage: true,
  starColor: null,
  starOpacity: 0.98,
  starGlow: 0.46,
  starScale: 1,
  starWarmth: 0.54,
  voiceCallOrbColor: null,
  backgroundAssetId: null,
  customFontAssetIds: [],
  customFontScopeAssignments: DEFAULT_CUSTOM_FONT_SCOPE_ASSIGNMENTS,
  backgroundOpacity: 0.46,
  backgroundDim: 0.24,
  backgroundBlur: 10,
  backgroundFit: 'cover'
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeBackgroundFit(value: unknown): AppBackgroundFit {
  return value === 'contain' ? 'contain' : 'cover';
}

function normalizeHexColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const shortHex = /^#([0-9a-f]{3})$/i.exec(trimmed);
  if (shortHex) {
    return `#${shortHex[1].split('').map((char) => `${char}${char}`).join('')}`.toLowerCase();
  }
  return /^#[0-9a-f]{6}$/i.test(trimmed) ? trimmed.toLowerCase() : null;
}

function normalizeAssetIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean))];
}

function normalizeCustomFontScopeAssignments(
  value: unknown,
  customFontAssetIds: string[]
): Record<CustomFontScope, string | null> {
  const availableFontIds = new Set(customFontAssetIds);
  const source = value && typeof value === 'object'
    ? value as Partial<Record<CustomFontScope, unknown>>
    : {};

  return CUSTOM_FONT_SCOPES.reduce((assignments, scope) => {
    const assetId = typeof source[scope] === 'string' ? source[scope].trim() : '';
    assignments[scope] = assetId && availableFontIds.has(assetId) ? assetId : null;
    return assignments;
  }, { ...DEFAULT_CUSTOM_FONT_SCOPE_ASSIGNMENTS });
}

export function normalizeAppCustomization(
  customization?: Partial<AppCustomization> | null
): AppCustomization {
  const customFontAssetIds = normalizeAssetIdList(customization?.customFontAssetIds);

  return {
    showChatAvatars: customization?.showChatAvatars ?? DEFAULT_APP_CUSTOMIZATION.showChatAvatars,
    showCollaboratorName: customization?.showCollaboratorName ?? DEFAULT_APP_CUSTOMIZATION.showCollaboratorName,
    showMessageClock: customization?.showMessageClock ?? DEFAULT_APP_CUSTOMIZATION.showMessageClock,
    showModelName: customization?.showModelName ?? DEFAULT_APP_CUSTOMIZATION.showModelName,
    showTokenUsage: customization?.showTokenUsage ?? DEFAULT_APP_CUSTOMIZATION.showTokenUsage,
    starColor: normalizeHexColor(customization?.starColor),
    starOpacity:
      typeof customization?.starOpacity === 'number'
        ? clamp(customization.starOpacity, STAR_OPACITY_MIN, STAR_OPACITY_MAX)
        : DEFAULT_APP_CUSTOMIZATION.starOpacity,
    starGlow:
      typeof customization?.starGlow === 'number'
        ? clamp(customization.starGlow, STAR_GLOW_MIN, STAR_GLOW_MAX)
        : DEFAULT_APP_CUSTOMIZATION.starGlow,
    starScale:
      typeof customization?.starScale === 'number'
        ? clamp(customization.starScale, STAR_SCALE_MIN, STAR_SCALE_MAX)
        : DEFAULT_APP_CUSTOMIZATION.starScale,
    starWarmth:
      typeof customization?.starWarmth === 'number'
        ? clamp(customization.starWarmth, STAR_WARMTH_MIN, STAR_WARMTH_MAX)
        : DEFAULT_APP_CUSTOMIZATION.starWarmth,
    voiceCallOrbColor: normalizeHexColor(customization?.voiceCallOrbColor),
    backgroundAssetId:
      typeof customization?.backgroundAssetId === 'string' && customization.backgroundAssetId.trim()
        ? customization.backgroundAssetId.trim()
        : null,
    customFontAssetIds,
    customFontScopeAssignments: normalizeCustomFontScopeAssignments(
      customization?.customFontScopeAssignments,
      customFontAssetIds
    ),
    backgroundOpacity:
      typeof customization?.backgroundOpacity === 'number'
        ? clamp(customization.backgroundOpacity, BACKGROUND_OPACITY_MIN, BACKGROUND_OPACITY_MAX)
        : DEFAULT_APP_CUSTOMIZATION.backgroundOpacity,
    backgroundDim:
      typeof customization?.backgroundDim === 'number'
        ? clamp(customization.backgroundDim, BACKGROUND_DIM_MIN, BACKGROUND_DIM_MAX)
        : DEFAULT_APP_CUSTOMIZATION.backgroundDim,
    backgroundBlur:
      typeof customization?.backgroundBlur === 'number'
        ? clamp(customization.backgroundBlur, BACKGROUND_BLUR_MIN, BACKGROUND_BLUR_MAX)
        : DEFAULT_APP_CUSTOMIZATION.backgroundBlur,
    backgroundFit: normalizeBackgroundFit(customization?.backgroundFit)
  };
}

export function mergeAppCustomizationPatch(
  customization: AppCustomization,
  patch: Partial<AppCustomization>
): AppCustomization {
  return normalizeAppCustomization({
    ...customization,
    ...patch
  });
}
