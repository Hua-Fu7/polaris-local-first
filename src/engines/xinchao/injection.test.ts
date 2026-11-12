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

const calmSnapshot = {
  revision: 3,
  drives: [{ key: 'duty', value: 0.45 }]
};

describe('shouldInjectXinchaoContext', () => {
  let storage: ReturnType<typeof createStorage>;

  beforeEach(() => {
    storage = createStorage();
    vi.stubGlobal('window', { localStorage: storage });
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('贴一次之后就安静下来，状态没变不再重复提醒', async () => {
    const { shouldInjectXinchaoContext } = await import('./injection');
    const args = { collaboratorId: 'rune', conversationId: 'conv-1', snapshot: calmSnapshot };

    expect(shouldInjectXinchaoContext(args)).toBe(true);
    expect(shouldInjectXinchaoContext(args)).toBe(false);
    expect(shouldInjectXinchaoContext(args)).toBe(false);
  });

  it('状态变了（revision 变了）再贴一次', async () => {
    const { shouldInjectXinchaoContext } = await import('./injection');
    const base = { collaboratorId: 'rune', conversationId: 'conv-1' };

    expect(shouldInjectXinchaoContext({ ...base, snapshot: calmSnapshot })).toBe(true);
    expect(shouldInjectXinchaoContext({ ...base, snapshot: { ...calmSnapshot, revision: 4 } })).toBe(true);
  });

  it('有驱力过了涌线也再贴一次', async () => {
    const { shouldInjectXinchaoContext } = await import('./injection');
    const base = { collaboratorId: 'rune', conversationId: 'conv-1' };

    expect(shouldInjectXinchaoContext({ ...base, snapshot: calmSnapshot })).toBe(true);
    // 同一个 revision，但责任感冲到 0.7——这是一次真正的"涌"
    expect(shouldInjectXinchaoContext({
      ...base,
      snapshot: { revision: 3, drives: [{ key: 'duty', value: 0.7 }] }
    })).toBe(true);
    // 已经贴过这次涌，再来一轮就静音
    expect(shouldInjectXinchaoContext({
      ...base,
      snapshot: { revision: 3, drives: [{ key: 'duty', value: 0.72 }] }
    })).toBe(false);
  });

  it('换对话会重新贴一次', async () => {
    const { shouldInjectXinchaoContext } = await import('./injection');

    expect(shouldInjectXinchaoContext({ collaboratorId: 'rune', conversationId: 'a', snapshot: calmSnapshot })).toBe(true);
    expect(shouldInjectXinchaoContext({ collaboratorId: 'rune', conversationId: 'b', snapshot: calmSnapshot })).toBe(true);
  });

  it('没有快照就不贴', async () => {
    const { shouldInjectXinchaoContext } = await import('./injection');
    expect(shouldInjectXinchaoContext({ collaboratorId: 'rune', conversationId: 'conv-1', snapshot: null })).toBe(false);
  });

  it('用户在面板里关掉之后，一律不贴', async () => {
    const { shouldInjectXinchaoContext, setXinchaoInjectionEnabled, isXinchaoInjectionEnabled } =
      await import('./injection');
    const args = { collaboratorId: 'rune', conversationId: 'conv-1', snapshot: calmSnapshot };

    expect(isXinchaoInjectionEnabled()).toBe(true);
    setXinchaoInjectionEnabled(false);
    expect(isXinchaoInjectionEnabled()).toBe(false);
    // 就算状态变了、换了对话，关掉就是关掉
    expect(shouldInjectXinchaoContext(args)).toBe(false);
    expect(shouldInjectXinchaoContext({ ...args, snapshot: { ...calmSnapshot, revision: 99 } })).toBe(false);
    expect(shouldInjectXinchaoContext({ ...args, conversationId: 'conv-2' })).toBe(false);

    setXinchaoInjectionEnabled(true);
    expect(shouldInjectXinchaoContext(args)).toBe(true);
  });
});
