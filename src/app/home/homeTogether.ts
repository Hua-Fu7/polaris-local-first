/**
 * 「在一起 N 天」的起点日期。
 *
 * 存在本机（localStorage）：用户可以点天数改成自己的日子。
 */

const STORAGE_KEY = 'polaris:home-together-date:v1';

/** 用户指定的日子：2026-06-17。 */
export const DEFAULT_TOGETHER_DATE = '2026-06-17';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDate(value: string | null | undefined) {
  const trimmed = value?.trim() ?? '';
  return DATE_PATTERN.test(trimmed) ? trimmed : '';
}

export function readTogetherDate(): string {
  if (typeof window === 'undefined') return DEFAULT_TOGETHER_DATE;
  try {
    return normalizeDate(window.localStorage.getItem(STORAGE_KEY)) || DEFAULT_TOGETHER_DATE;
  } catch {
    return DEFAULT_TOGETHER_DATE;
  }
}

export function writeTogetherDate(date: string) {
  if (typeof window === 'undefined') return;
  const normalized = normalizeDate(date) || DEFAULT_TOGETHER_DATE;
  try {
    window.localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // 存不下就算了：下次打开还是默认那天。
  }
  window.dispatchEvent(new CustomEvent('polaris:home-together-updated', { detail: normalized }));
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** 从起点到今天一共多少天（当天算第 1 天）。 */
export function resolveTogetherDays(startDate: string, now: Date = new Date()): number {
  const normalized = normalizeDate(startDate) || DEFAULT_TOGETHER_DATE;
  const [year, month, day] = normalized.split('-').map((part) => Number(part));
  const start = new Date(year, month - 1, day);
  if (Number.isNaN(start.getTime())) return 1;
  const days = Math.floor((startOfDay(now).getTime() - start.getTime()) / 86_400_000);
  return Math.max(1, days + 1);
}

/** 2026-06-17 → 2026.06.17 */
export function formatTogetherSince(date: string): string {
  const normalized = normalizeDate(date) || DEFAULT_TOGETHER_DATE;
  return normalized.replace(/-/g, '.');
}
