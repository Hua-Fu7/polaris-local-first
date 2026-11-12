import { describe, expect, it } from 'vitest';
import { extractDsmlToolCallsFromContent } from './providerRuntimeDsmlToolCalls';
import { toAssistantReply } from './providerRuntimeReplyAccumulator';

describe('extractDsmlToolCallsFromContent', () => {
  it('extracts a single DSML invoke and strips it from the content', () => {
    const content = [
      '我先挂电话。',
      '<|DSML|calls>',
      '<|DSML|invoke name="hangUp">',
      '<|DSML|parameter name="reason" string="true">说完了</|DSML|parameter>',
      '</|DSML|invoke>',
      '</|DSML|calls>'
    ].join('\n');

    const result = extractDsmlToolCallsFromContent(content);
    expect(result.extracted).toBe(true);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('hangUp');
    expect(JSON.parse(result.toolCalls[0].argumentsText)).toEqual({ reason: '说完了' });
    expect(result.cleanContent).toBe('我先挂电话。');
  });

  it('extracts multiple invokes in one content', () => {
    const content = [
      '<|DSML|invoke name="startVoiceCall"><|DSML|parameter name="reason" string="true">想他了</|DSML|parameter></|DSML|invoke>',
      '<|DSML|invoke name="hangUp"><|DSML|parameter name="reason" string="true">挂了</|DSML|parameter></|DSML|invoke>'
    ].join('\n');

    const result = extractDsmlToolCallsFromContent(content);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.map((call) => call.name)).toEqual(['startVoiceCall', 'hangUp']);
  });

  it('handles boolean and number parameters without string quoting', () => {
    const content = '<|DSML|invoke name="answerVoiceCall"><|DSML|parameter name="accept" string="false">false</|DSML|parameter><|DSML|parameter name="count" string="false">3</|DSML|parameter></|DSML|invoke>';

    const result = extractDsmlToolCallsFromContent(content);
    const args = JSON.parse(result.toolCalls[0].argumentsText);
    // string="false" 的值按 JSON 解析：false 是布尔，3 是数字。
    expect(args).toEqual({ accept: false, count: 3 });
  });

  it('tolerates fullwidth pipes in DSML markup', () => {
    const content = '<｜DSML｜invoke name="hangUp"><｜DSML｜parameter name="reason" string="true">睡了</｜DSML｜parameter></｜DSML｜invoke>';

    const result = extractDsmlToolCallsFromContent(content);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].name).toBe('hangUp');
    expect(JSON.parse(result.toolCalls[0].argumentsText)).toEqual({ reason: '睡了' });
  });

  it('returns extracted=false when there is no DSML', () => {
    const content = 'just a normal reply, nothing tool-ish here';
    const result = extractDsmlToolCallsFromContent(content);
    expect(result.extracted).toBe(false);
    expect(result.toolCalls).toHaveLength(0);
    expect(result.cleanContent).toBe(content);
  });

  it('returns extracted=false for an incomplete (unclosed) DSML block', () => {
    const content = '<|DSML|invoke name="hangUp"><|DSML|parameter name="reason" string="true">还没说完';
    const result = extractDsmlToolCallsFromContent(content);
    expect(result.extracted).toBe(false);
    expect(result.toolCalls).toHaveLength(0);
  });

  it('preserves text around and between DSML blocks', () => {
    const content = [
      '开头',
      '<|DSML|invoke name="hangUp"></|DSML|invoke>',
      '中间',
      '<|DSML|invoke name="startVoiceCall"></|DSML|invoke>',
      '结尾'
    ].join('\n');

    const result = extractDsmlToolCallsFromContent(content);
    expect(result.toolCalls).toHaveLength(2);
    expect(result.cleanContent).toContain('开头');
    expect(result.cleanContent).toContain('中间');
    expect(result.cleanContent).toContain('结尾');
    expect(result.cleanContent).not.toContain('DSML');
  });
});

describe('toAssistantReply DSML integration', () => {
  it('turns DSML text into nativeToolCalls and cleans the content', () => {
    const reply = toAssistantReply({
      content: [
        '我先挂电话。',
        '<|DSML|invoke name="hangUp"><|DSML|parameter name="reason" string="true">说完了</|DSML|parameter></|DSML|invoke>'
      ].join('\n'),
      thinkingText: '',
      toolCalls: []
    }, 'deepseek-flash');

    expect(reply.usedNativeToolCalls).toBe(true);
    expect(reply.nativeToolCallCount).toBe(1);
    expect(reply.nativeToolCalls?.[0].name).toBe('hangUp');
    expect(reply.content).toBe('我先挂电话。');
    expect(reply.content).not.toContain('DSML');
  });

  it('keeps standard tool_calls untouched when already present', () => {
    const reply = toAssistantReply({
      content: '正常正文',
      thinkingText: '',
      toolCalls: [{ name: 'hangUp', argumentsText: '{"reason":"正常"}' }]
    }, 'deepseek-flash');

    expect(reply.usedNativeToolCalls).toBe(true);
    expect(reply.nativeToolCallCount).toBe(1);
    expect(reply.nativeToolCalls?.[0].name).toBe('hangUp');
    expect(reply.content).toBe('正常正文');
  });

  it('does not touch content without DSML and without tool calls', () => {
    const reply = toAssistantReply({
      content: '纯文本回答',
      thinkingText: '',
      toolCalls: []
    }, 'deepseek-flash');

    expect(reply.usedNativeToolCalls).toBe(false);
    expect(reply.content).toBe('纯文本回答');
  });
});
