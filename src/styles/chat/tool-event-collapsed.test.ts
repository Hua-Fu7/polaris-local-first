import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/styles/chat/chat-actions-tools.css', 'utf8');

describe('collapsed tool receipts', () => {
  it('reads as a plain log line instead of a bubble', () => {
    const block = /\.tool-event\.collapsed\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(block).not.toBe('');
    // 每一轮工具调用都会留一条回执：它不该长成气泡，跟真正说的话抢视线。
    expect(block).toContain('background: transparent');
    expect(block).toContain('box-shadow: none');
    expect(block).toContain('backdrop-filter: none');
    expect(block).not.toContain('linear-gradient');
  });

  it('keeps the status colours without painting a container', () => {
    const block = /\.tool-event\.collapsed\.running,([^}]*)\}/.exec(css)?.[1] ?? '';

    expect(block).toContain('background: transparent');
    expect(block).not.toContain('linear-gradient');
  });
});
