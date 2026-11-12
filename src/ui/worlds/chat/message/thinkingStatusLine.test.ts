import { describe, expect, it } from 'vitest';
import {
  resolveThinkingStatus,
  resolveThinkingStatusIcon,
  resolveThinkingStatusSegmentKey
} from './thinkingStatusLine';

describe('resolveThinkingStatus', () => {
  it('shows 搜索 when a web tool is running', () => {
    const status = resolveThinkingStatus({
      runningTool: { kind: 'webSearch', targetLabel: 'Anthropic docs' },
      isActive: true
    });

    expect(status).toEqual({ kind: 'search', targetLabel: 'Anthropic docs' });
    expect(resolveThinkingStatusIcon(status!.kind)).toBe('search');
  });

  it('shows 读文件 when a file or document is being read', () => {
    const status = resolveThinkingStatus({
      runningTool: { kind: 'readProjectFile', targetLabel: 'index.html' },
      isActive: true
    });

    expect(status).toEqual({ kind: 'reading', targetLabel: 'index.html' });
    expect(resolveThinkingStatusIcon(status!.kind)).toBe('fileText');
  });

  it('shows 写代码 when a card or file is being written', () => {
    const status = resolveThinkingStatus({
      runningTool: { kind: 'writeProjectFiles', targetLabel: 'style.css' },
      isActive: true
    });

    expect(status).toEqual({ kind: 'code', targetLabel: 'style.css' });
    expect(resolveThinkingStatusIcon(status!.kind)).toBe('code');
  });

  it('shows 沙箱 when code is running in the sandbox', () => {
    const status = resolveThinkingStatus({
      runningTool: { kind: 'runCode', targetLabel: undefined },
      isActive: true
    });

    expect(status).toEqual({ kind: 'sandbox', targetLabel: undefined });
    expect(resolveThinkingStatusIcon(status!.kind)).toBe('zap');
  });

  it('falls back to the plain tool form for anything else, with the 扳手 icon', () => {
    const status = resolveThinkingStatus({
      runningTool: { kind: 'sendVoiceMessage', targetLabel: '晚安' },
      isActive: true
    });

    expect(status).toEqual({ kind: 'tool', toolName: 'sendVoiceMessage', targetLabel: '晚安' });
    expect(resolveThinkingStatusIcon(status!.kind)).toBe('tool');
  });

  it('shows 思考 only while the turn is still alive', () => {
    expect(resolveThinkingStatus({ runningTool: null, isActive: true })).toEqual({ kind: 'thinking' });
    expect(resolveThinkingStatus({ runningTool: null, isActive: false })).toBeNull();
  });

  it('re-counts seconds when the activity changes', () => {
    const thinking = resolveThinkingStatus({ runningTool: null, isActive: true });
    const search = resolveThinkingStatus({
      runningTool: { kind: 'webSearch', targetLabel: 'news' },
      isActive: true
    });
    const read = resolveThinkingStatus({
      runningTool: { kind: 'readAttachmentText', targetLabel: 'a.txt' },
      isActive: true
    });

    expect(resolveThinkingStatusSegmentKey(thinking)).not.toBe(resolveThinkingStatusSegmentKey(search));
    expect(resolveThinkingStatusSegmentKey(search)).not.toBe(resolveThinkingStatusSegmentKey(read));
    expect(resolveThinkingStatusSegmentKey(thinking)).toBe(resolveThinkingStatusSegmentKey(thinking));
  });
});
