import { describe, expect, it } from 'vitest';
import { parseInlineThinkingTags, promoteInlineThinkingTags } from './inlineThinkingTags';

describe('parseInlineThinkingTags', () => {
  it('extracts complete think blocks and keeps visible content alive', () => {
    expect(parseInlineThinkingTags('<think>先看约束。</think>\n\n答案。')).toEqual({
      visibleContent: '答案。',
      thinkingTexts: ['先看约束。']
    });
  });

  it('supports thinking and thought aliases case-insensitively', () => {
    expect(parseInlineThinkingTags([
      '开头',
      '<THINKING>先分层。</THINKING>',
      '中段',
      '<thought>再收束。</thought>',
      '结尾'
    ].join('\n'))).toEqual({
      visibleContent: '开头\n\n中段\n\n结尾',
      thinkingTexts: ['先分层。', '再收束。']
    });
  });

  it('leaves unclosed thinking tags in visible content instead of swallowing the reply', () => {
    const content = '<think>这段没有闭合，所以后面的回答必须还活着。';

    expect(parseInlineThinkingTags(content)).toEqual({
      visibleContent: content,
      thinkingTexts: []
    });
  });

  it('leaves mismatched close tags in visible content', () => {
    const content = '<think>不完整</thinking>\n正文';

    expect(parseInlineThinkingTags(content)).toEqual({
      visibleContent: content,
      thinkingTexts: []
    });
  });

  it('keeps an unfinished thinking block out of the visible body while streaming', () => {
    expect(parseInlineThinkingTags('<think>先看约束，再决定。', { streaming: true })).toEqual({
      visibleContent: '',
      thinkingTexts: ['先看约束，再决定。']
    });

    expect(parseInlineThinkingTags('正文先说了\n<think>接着想', { streaming: true })).toEqual({
      visibleContent: '正文先说了',
      thinkingTexts: ['接着想']
    });
  });

  it('keeps the visible body while a half-typed thinking tag is still arriving', () => {
    expect(parseInlineThinkingTags('正文<thin', { streaming: true })).toEqual({
      visibleContent: '正文',
      thinkingTexts: []
    });

    expect(parseInlineThinkingTags('正文</think', { streaming: true })).toEqual({
      visibleContent: '正文',
      thinkingTexts: []
    });
  });

  it('hands the body back to the visible side once the streaming block closes', () => {
    expect(parseInlineThinkingTags('<think>想完了。</think>\n\n正式回答。', { streaming: true })).toEqual({
      visibleContent: '正式回答。',
      thinkingTexts: ['想完了。']
    });
  });
});

describe('promoteInlineThinkingTags', () => {
  it('appends inline thinking after provider thinking text', () => {
    expect(promoteInlineThinkingTags({
      content: '正文前\n<thinking>补充判断。</thinking>\n正文后',
      thinkingText: '原生思考。'
    })).toEqual({
      content: '正文前\n\n正文后',
      thinkingText: '原生思考。\n\n补充判断。'
    });
  });

  it('returns the original reply when no complete inline thinking block exists', () => {
    const reply = {
      content: '<think>还没闭合，先别动。',
      thinkingText: undefined
    };

    expect(promoteInlineThinkingTags(reply)).toBe(reply);
  });
});
