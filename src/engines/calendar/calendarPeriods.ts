import { calendarDateFromIso, localDateIso } from './calendarNotes';

const STORAGE_KEY = 'polaris:calendar-periods:v1';
const UPDATE_EVENT = 'polaris:calendar-periods-updated';
export const DEFAULT_PERIOD_CYCLE_DAYS = 26;
export const DEFAULT_PREDICTED_PERIOD_DAYS = 6;

function getStorage() {
  return typeof window !== 'undefined' ? window.localStorage : null;
}

export function readCalendarPeriods(): string[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(STORAGE_KEY) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)))].sort();
  } catch {
    return [];
  }
}

function writeCalendarPeriods(periods: string[]) {
  const storage = getStorage();
  if (!storage) return;
  const normalized = [...new Set(periods)].sort();
  storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent(UPDATE_EVENT));
}

export function setCalendarPeriod(date: string, enabled: boolean) {
  const periods = new Set(readCalendarPeriods());
  if (enabled) periods.add(date);
  else periods.delete(date);
  writeCalendarPeriods([...periods]);
}

export function subscribeCalendarPeriods(listener: () => void) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(UPDATE_EVENT, listener);
  return () => window.removeEventListener(UPDATE_EVENT, listener);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function resolvePredictedPeriods(
  periods: string[],
  cycleDays = DEFAULT_PERIOD_CYCLE_DAYS,
  predictedDays = DEFAULT_PREDICTED_PERIOD_DAYS
) {
  const set = new Set(periods);
  const starts = periods
    .filter((date) => !set.has(localDateIso(addDays(calendarDateFromIso(date), -1))))
    .sort();
  const result = new Map<string, boolean>();
  if (starts.length === 0) return result;

  const lastStart = calendarDateFromIso(starts[starts.length - 1]);
  for (let index = 0; index < predictedDays; index += 1) {
    const date = localDateIso(addDays(lastStart, cycleDays + index));
    if (!set.has(date)) result.set(date, index === predictedDays - 1);
  }
  return result;
}