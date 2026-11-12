import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('thinkingDurationStore', () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    storage = createStorage();
    vi.stubGlobal('window', { localStorage: storage });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('remembers how long a reply thought so a reopened chat still shows the number', async () => {
    const { readThinkingDurationMs, saveThinkingDurationMs } = await import('./thinkingDurationStore');

    saveThinkingDurationMs('assistant-1', 12400);

    expect(readThinkingDurationMs('assistant-1')).toBe(12400);
    expect(readThinkingDurationMs('assistant-2')).toBeNull();
  });

  it('survives a restart by reading the value back from storage', async () => {
    const first = await import('./thinkingDurationStore');
    first.saveThinkingDurationMs('assistant-1', 8000);

    // 模拟重启：模块缓存清空，只剩 localStorage 里的那份。
    vi.resetModules();
    const second = await import('./thinkingDurationStore');

    expect(second.readThinkingDurationMs('assistant-1')).toBe(8000);
  });

  it('ignores nonsense durations instead of writing them', async () => {
    const { readThinkingDurationMs, saveThinkingDurationMs } = await import('./thinkingDurationStore');

    saveThinkingDurationMs('assistant-1', 0);
    saveThinkingDurationMs('assistant-2', Number.NaN);
    saveThinkingDurationMs('', 5000);

    expect(readThinkingDurationMs('assistant-1')).toBeNull();
    expect(readThinkingDurationMs('assistant-2')).toBeNull();
  });

  it('drops junk entries that were left in storage', async () => {
    storage.setItem('polaris-thinking-durations-v1', JSON.stringify({
      good: 3000,
      text: 'nope',
      negative: -1
    }));
    const { readThinkingDurationMs } = await import('./thinkingDurationStore');

    expect(readThinkingDurationMs('good')).toBe(3000);
    expect(readThinkingDurationMs('text')).toBeNull();
    expect(readThinkingDurationMs('negative')).toBeNull();
  });

  it('keeps working when localStorage is unavailable', async () => {
    vi.stubGlobal('window', {});
    vi.resetModules();
    const { readThinkingDurationMs, saveThinkingDurationMs } = await import('./thinkingDurationStore');

    expect(() => saveThinkingDurationMs('assistant-1', 4000)).not.toThrow();
    expect(readThinkingDurationMs('assistant-1')).toBe(4000);
  });
  it('keeps the run start so a reply finished in the background still gets its real duration', async () => {
    const { readThinkingStartMs, saveThinkingStartMs, clearThinkingStartMs } = await import('./thinkingDurationStore');

    const start = Date.now() - 95_000;
    saveThinkingStartMs('assistant-bg', start);
    expect(readThinkingStartMs('assistant-bg')).toBe(Math.round(start));

    // 重挂载时再写一次也不能把起点改成"现在"
    saveThinkingStartMs('assistant-bg', Date.now());
    expect(readThinkingStartMs('assistant-bg')).toBe(Math.round(start));

    clearThinkingStartMs('assistant-bg');
    expect(readThinkingStartMs('assistant-bg')).toBeNull();
  });
  it('drops absurd legacy values instead of showing "754457s"', async () => {
    const { readThinkingDurationMs, saveThinkingDurationMs } = await import('./thinkingDurationStore');

    saveThinkingDurationMs('assistant-old', 754_457_000);

    expect(readThinkingDurationMs('assistant-old')).toBeNull();
  });
});
