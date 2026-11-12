import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '../../types/domain';
import { buildXinchaoReplyContext, readXinchaoSnapshot, resetXinchaoState } from './runtime';

function installLocalStorage() {
  const store = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); }
  };
  vi.stubGlobal('localStorage', localStorage);
  vi.stubGlobal('window', {
    localStorage,
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  });
  vi.stubGlobal('CustomEvent', class {
    detail: unknown;
    constructor(_type: string, init?: { detail?: unknown }) {
      this.detail = init?.detail;
    }
  });
  return localStorage;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('xinchao runtime', () => {
  it('settles and records a user interaction once per message id', () => {
    installLocalStorage();
    const messages: ChatMessage[] = [{
      id: 'message-1',
      role: 'user',
      content: '这个 bug 修好了',
      timestamp: 1
    }];
    const now = new Date('2026-09-29T08:00:00.000Z');

    const first = buildXinchaoReplyContext({ collaboratorId: 'rune', messages, now });
    expect(first.lastInteraction).toBe('task_progress');
    expect(first.drives.length).toBeGreaterThan(0);
    expect(first.thoughts.length).toBeGreaterThan(0);
    expect(first.thoughts[0]?.text).toContain('这件事');

    const second = buildXinchaoReplyContext({ collaboratorId: 'rune', messages, now: new Date('2026-09-29T08:05:00.000Z') });
    expect(second.lastInteraction).toBe('task_progress · 已计入');
  });

  it('resets the local state for one collaborator', () => {
    const storage = installLocalStorage();
    const message: ChatMessage = { id: 'message-2', role: 'user', content: '抱抱', timestamp: 1 };
    buildXinchaoReplyContext({ collaboratorId: 'rune', messages: [message] });
    expect(storage.getItem('polaris:xinchao:state:v1:rune')).toBeTruthy();

    resetXinchaoState('rune');
    expect(storage.getItem('polaris:xinchao:state:v1:rune')).toBeNull();
    expect(readXinchaoSnapshot('rune').revision).toBe(0);
  });
});
