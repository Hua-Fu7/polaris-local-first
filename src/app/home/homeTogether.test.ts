import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TOGETHER_DATE,
  formatTogetherSince,
  readTogetherDate,
  resolveTogetherDays,
  writeTogetherDate
} from './homeTogether';

function createStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
    clear: () => { map.clear(); },
    key: (index: number) => [...map.keys()][index] ?? null,
    get length() { return map.size; }
  };
}

describe('homeTogether', () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    storage = createStorage();
    vi.stubGlobal('window', { localStorage: storage, dispatchEvent: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('counts the first day as day one', () => {
    expect(resolveTogetherDays('2026-06-17', new Date(2026, 5, 17, 9, 30))).toBe(1);
  });

  it('counts across months', () => {
    expect(resolveTogetherDays('2026-06-17', new Date(2026, 6, 17, 1))).toBe(31);
  });

  it('never reports less than one day', () => {
    expect(resolveTogetherDays('2026-06-17', new Date(2026, 0, 1))).toBe(1);
  });

  it('falls back to the default date when the stored value is junk', () => {
    storage.setItem('polaris:home-together-date:v1', 'not-a-date');
    expect(readTogetherDate()).toBe(DEFAULT_TOGETHER_DATE);
  });

  it('remembers a date the user picks', () => {
    writeTogetherDate('2025-12-24');
    expect(readTogetherDate()).toBe('2025-12-24');
    expect(storage.getItem('polaris:home-together-date:v1')).toBe('2025-12-24');
  });

  it('formats the since line', () => {
    expect(formatTogetherSince('2026-06-17')).toBe('2026.06.17');
  });
});
