import type { ObBrainSettings } from '../types/domain';
import { OB_RECALL_DEFAULT_BUDGET_MS } from '../engines/ombreBrain/obRecall';

/**
 * OB 超时的上下限。
 *
 * 下限 300ms：再短基本必然失败，等于关掉了召回。
 * 上限 10s：超过这个数，"失败静默"就变成"聊天卡住"，宁可判失败。
 */
export const OB_TIMEOUT_MIN_MS = 300;
export const OB_TIMEOUT_MAX_MS = 10_000;

export const DEFAULT_OB_BRAIN_SETTINGS: ObBrainSettings = {
  enabled: false,
  baseUrl: '',
  timeoutMs: OB_RECALL_DEFAULT_BUDGET_MS
};

function normalizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTimeout(value: unknown) {
  const numeric = typeof value === 'number' && Number.isFinite(value)
    ? Math.floor(value)
    : OB_RECALL_DEFAULT_BUDGET_MS;
  return Math.min(OB_TIMEOUT_MAX_MS, Math.max(OB_TIMEOUT_MIN_MS, numeric));
}

function normalizeTimestamp(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function normalizeObBrainSettings(value: unknown): ObBrainSettings {
  const settings = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<ObBrainSettings>
    : {};

  return {
    enabled: settings.enabled === true,
    // 地址只去空白、不做别的加工：校验交给客户端，填错了要能原样显示回输入框。
    baseUrl: normalizeString(settings.baseUrl),
    timeoutMs: normalizeTimeout(settings.timeoutMs),
    lastUpdatedAt: normalizeTimestamp(settings.lastUpdatedAt)
  };
}

export function mergeObBrainSettings(
  current: ObBrainSettings,
  patch: Partial<ObBrainSettings>
): ObBrainSettings {
  return normalizeObBrainSettings({
    ...current,
    ...patch,
    lastUpdatedAt: Date.now()
  });
}
