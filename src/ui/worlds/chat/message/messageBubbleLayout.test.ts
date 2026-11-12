import { describe, expect, it } from 'vitest';
import { formatMessageClock, splitAssistantReplyIntoBubbles } from './messageBubbleLayout';

describe('splitAssistantReplyIntoBubbles', () => {
  it('splits a reply into one bubble per paragraph', () => {
    expect(splitAssistantReplyIntoBubbles('第一段。\n\n第二段。\n\n第三段。')).toEqual([
      '第一段。',
      '第二段。',
      '第三段。'
    ]);
  });

  it('trims whitespace and collapses runs of blank lines', () => {
    expect(splitAssistantReplyIntoBubbles('  甲。  \n\n\n\n  乙。  ')).toEqual(['甲。', '乙。']);
  });

  it('keeps single newlines inside the same bubble', () => {
    expect(splitAssistantReplyIntoBubbles('第一行\n第二行')).toBeNull();
  });

  it('returns null when the reply is a single paragraph', () => {
    expect(splitAssistantReplyIntoBubbles('就一句。')).toBeNull();
  });

  it('returns null for blank content', () => {
    expect(splitAssistantReplyIntoBubbles('  \n\n  ')).toBeNull();
  });

  // 标题、围栏代码、引用这类结构只要自身完整，拆开单独渲染不会变形——
  // 它们各自作为一个气泡，文字段落作为另一个气泡。
  it('keeps a heading together but splits it from the following paragraph', () => {
    expect(splitAssistantReplyIntoBubbles('# 标题\n\n正文')).toEqual(['# 标题', '正文']);
  });

  it('splits a fenced code block out of surrounding text', () => {
    expect(splitAssistantReplyIntoBubbles('看这段：\n\n```ts\nconst a = 1;\n```')).toEqual([
      '看这段：',
      '```ts\nconst a = 1;\n```'
    ]);
  });

  it('does not split inside a fenced code block even across blank lines', () => {
    expect(splitAssistantReplyIntoBubbles('前\n\n```ts\na\n\nb\n```\n\n后')).toEqual([
      '前',
      '```ts\na\n\nb\n```',
      '后'
    ]);
  });

  it('keeps a blockquote together but splits it from the following paragraph', () => {
    expect(splitAssistantReplyIntoBubbles('> 引用\n\n正文')).toEqual(['> 引用', '正文']);
  });

  it('keeps a list together but splits it from the following paragraph', () => {
    expect(splitAssistantReplyIntoBubbles('- 甲\n- 乙\n\n总结')).toEqual(['- 甲\n- 乙', '总结']);
  });

  it('keeps a details result list attached to the previous bubble', () => {
    const content = '正文总结。\n\n<details>\n<summary>想看原始结果清单</summary>\n\n1. 甲\n2. 乙\n</details>';

    expect(splitAssistantReplyIntoBubbles(content)).toBeNull();
  });

  it('does not split inside details even across blank lines', () => {
    const content = '正文总结。\n\n<details>\n<summary>来源</summary>\n\n1. 甲\n\n2. 乙\n</details>\n\n后面的话。';
    const segments = splitAssistantReplyIntoBubbles(content);

    expect(segments).toHaveLength(2);
    expect(segments?.[0]).toContain('<details>');
    expect(segments?.[0]).toContain('2. 乙');
    expect(segments?.[1]).toBe('后面的话。');
  });
  it('treats an indented line as a plain text segment', () => {
    expect(splitAssistantReplyIntoBubbles('说明\n\n    const a = 1;')).toEqual(['说明', 'const a = 1;']);
  });

  // 这些结构被空行硬生生切断时，拆开会让列表符号/编号重置、表格只剩表头、
  // 引用断开——所以并回同一块，整条保持单气泡。
  it.each([
    ['unordered list', '- 甲\n\n- 乙'],
    ['ordered list', '1. 甲\n\n2. 乙'],
    ['blockquote', '> 甲\n\n> 乙'],
    ['table', '| a | b |\n\n| --- | --- |']
  ])('keeps a structure split across blank lines in one bubble (%s)', (_label, content) => {
    expect(splitAssistantReplyIntoBubbles(content)).toBeNull();
  });
});

describe('formatMessageClock', () => {
  it('formats as zero padded HH:mm', () => {
    expect(formatMessageClock(new Date(2026, 8, 20, 9, 7, 0).getTime())).toBe('09:07');
  });

  it('keeps afternoon hours on a 24 hour clock', () => {
    expect(formatMessageClock(new Date(2026, 8, 20, 19, 37, 0).getTime())).toBe('19:37');
  });

  it('returns an empty string for a non-finite timestamp', () => {
    expect(formatMessageClock(Number.NaN)).toBe('');
  });
});

