import { describe, expect, it, vi } from 'vitest';
import { createPersonaTemplate } from '../config/persona/personaBuilder';
import type { ChatMessage, ProviderProfile } from '../types/domain';
import { runIncomingCallDecision, readIncomingCallDecision } from '../app/chat/incomingCallDecisionRunner';
import {
  buildIncomingCallAnswerTool,
  buildIncomingCallDecisionPrompt,
  buildIncomingCallDecisionRequestContext,
  buildIncomingCallPersonaContent,
  INCOMING_CALL_ANSWER_TOOL_NAME,
  INCOMING_CALL_DECISION_SYSTEM_PROMPT,
  INCOMING_CALL_MAX_LINE_CHARS,
  INCOMING_CALL_MAX_PERSONA_PROMPT_CHARS,
  parseIncomingCallDecisionOutput
} from './incomingCallDecision';

const baseProvider: ProviderProfile = {
  id: 'main-provider',
  name: 'Main Provider',
  protocol: 'openai-completions',
  baseUrl: 'https://api.example.test',
  path: '/v1/chat/completions',
  apiKey: 'key',
  model: 'main-model',
  capabilities: {
    images: false,
    streaming: false,
    thinking: false
  }
};

const personaProvider: ProviderProfile = {
  ...baseProvider,
  id: 'persona-provider',
  name: 'Persona Provider',
  model: 'persona-model'
};

const persona = createPersonaTemplate({
  id: 'persona-1',
  name: '薇加',
  description: '嘴上不太客气，但会等你把话说完',
  userName: 'Y',
  compiledPrompt: '你说话很短，讨厌被反复追问。',
  advanced: { providerId: 'persona-provider', modelOverride: '' }
});

// 用本地时间构造时间戳，避免断言依赖运行机器的时区。
const LOCAL_CLOCK_MS = new Date(2026, 8, 19, 17, 20).getTime();

function buildMessage(seed: {
  id: string;
  role: ChatMessage['role'];
  content: string;
  timestamp: number;
  origin?: ChatMessage['origin'];
}): ChatMessage {
  return {
    id: seed.id,
    role: seed.role,
    content: seed.content,
    timestamp: seed.timestamp,
    ...(seed.origin ? { origin: seed.origin } : {})
  };
}

describe('buildIncomingCallPersonaContent', () => {
  it('states who the call is for and carries the persona prompt', () => {
    const content = buildIncomingCallPersonaContent(persona);

    expect(content).toContain('你是「薇加」');
    expect(content).toContain('「Y」');
    expect(content).toContain('你说话很短，讨厌被反复追问。');
  });

  it('truncates an oversized persona prompt instead of sending all of it', () => {
    const content = buildIncomingCallPersonaContent({
      ...persona,
      compiledPrompt: 'x'.repeat(INCOMING_CALL_MAX_PERSONA_PROMPT_CHARS + 500)
    });

    expect(content).toContain('以上已截断');
    expect(content.length).toBeLessThan(INCOMING_CALL_MAX_PERSONA_PROMPT_CHARS + 400);
  });
});

describe('buildIncomingCallDecisionPrompt', () => {
  const messages: ChatMessage[] = [
    buildMessage({ id: 'm1', role: 'user', content: '排版再松一点', timestamp: LOCAL_CLOCK_MS, origin: 'user-input' }),
    buildMessage({ id: 'm2', role: 'assistant', content: '知道了', timestamp: LOCAL_CLOCK_MS + 60_000 }),
    buildMessage({ id: 'm3', role: 'system', content: '（定时唤醒）', timestamp: LOCAL_CLOCK_MS + 90_000, origin: 'trigger-runtime' })
  ];

  it('hands over the clock, the caller and the recent conversation', () => {
    const prompt = buildIncomingCallDecisionPrompt({ persona, messages, now: LOCAL_CLOCK_MS });

    expect(prompt).toContain('当前时间：2026-09-19 17:20');
    expect(prompt).toContain('电话正在响');
    expect(prompt).toContain('Y：排版再松一点');
    expect(prompt).toContain('薇加：知道了');
    // 内部系统消息对判断没有帮助，也不该出现在 prompt 里。
    expect(prompt).not.toContain('定时唤醒');
  });

  it('asks for the exact JSON contract and says when to leave the line empty', () => {
    const prompt = buildIncomingCallDecisionPrompt({ persona, messages: [], now: LOCAL_CLOCK_MS });

    expect(prompt).toContain('"accept"');
    expect(prompt).toContain('"reason"');
    expect(prompt).toContain('"line"');
    expect(prompt).toContain('决定接听时用空字符串');
    expect(prompt).toContain(`不要超过 ${INCOMING_CALL_MAX_LINE_CHARS} 个字符`);
  });

  it('says so plainly when there is no history at all', () => {
    expect(buildIncomingCallDecisionPrompt({ persona, messages: [], now: LOCAL_CLOCK_MS }))
      .toContain('最近没有聊过什么');
  });
});

describe('buildIncomingCallDecisionRequestContext', () => {
  it('sends one system prompt, the persona and one user turn', () => {
    const context = buildIncomingCallDecisionRequestContext({
      persona,
      messages: [],
      now: LOCAL_CLOCK_MS
    });

    expect(context.segments).toHaveLength(3);
    expect(context.segments[0]?.messages[0]?.content).toBe(INCOMING_CALL_DECISION_SYSTEM_PROMPT);
    expect(context.segments[1]?.messages[0]?.content).toContain('薇加');
    expect(context.segments[2]?.messages[0]?.role).toBe('user');
    expect(context.memorySlots).toEqual({ session: [], profile: [], pin: [] });
  });

  /**
   * 这一层唯一的动作就是「接 / 不接」，所以它给的是一个必须调用的工具。
   * 模型没有"不回答"这个选项，含糊其辞也就无处可躲。
   */
  it('forces the single answer tool instead of asking for free text', () => {
    const context = buildIncomingCallDecisionRequestContext({
      persona,
      messages: [],
      now: LOCAL_CLOCK_MS
    });

    expect(context.tools).toHaveLength(1);
    expect(context.tools?.[0]?.type).toBe('function');
    expect(context.tools?.[0]?.function.name).toBe(INCOMING_CALL_ANSWER_TOOL_NAME);
    expect(context.toolChoice).toBe('required');
  });

  it('spells out both the tool and the plain-text fallback in the prompt', () => {
    const prompt = buildIncomingCallDecisionPrompt({ persona, messages: [], now: LOCAL_CLOCK_MS });

    expect(prompt).toContain(INCOMING_CALL_ANSWER_TOOL_NAME);
    expect(prompt).toContain('禁止调用');
  });
});

describe('buildIncomingCallAnswerTool', () => {
  it('makes accept a required field so "no answer" is not an option', () => {
    const tool = buildIncomingCallAnswerTool();

    expect(tool.function.parameters).toMatchObject({
      required: expect.arrayContaining(['accept', 'line'])
    });
    expect(tool.function.description).toContain('接听');
  });
});

describe('parseIncomingCallDecisionOutput', () => {
  it('reads an accepted call', () => {
    expect(parseIncomingCallDecisionOutput('{"accept":true,"reason":"正好想找他"}'))
      .toEqual({ accept: true, line: '', reason: '正好想找他' });
  });

  it('reads a refusal together with the line left for the caller', () => {
    expect(parseIncomingCallDecisionOutput('{"accept":false,"reason":"在开会","line":"在忙，晚点打给你"}'))
      .toEqual({ accept: false, line: '在忙，晚点打给你', reason: '在开会' });
  });

  it('accepts the alternate keys models reach for', () => {
    expect(parseIncomingCallDecisionOutput('{"answer":"接听"}')).toMatchObject({ accept: true });
    expect(parseIncomingCallDecisionOutput('{"pick":0}')).toMatchObject({ accept: false });
    expect(parseIncomingCallDecisionOutput('{"accept":"no","message":"睡了"}'))
      .toEqual({ accept: false, line: '睡了', reason: '' });
  });

  it('unwraps JSON that arrived inside a code fence', () => {
    expect(parseIncomingCallDecisionOutput('```json\n{"accept":false,"line":"在忙"}\n```'))
      .toEqual({ accept: false, line: '在忙', reason: '' });
  });

  it('trims and caps the line', () => {
    const parsed = parseIncomingCallDecisionOutput(
      JSON.stringify({ accept: false, line: `  ${'啊'.repeat(200)}  ` })
    );

    expect(parsed?.line).toHaveLength(INCOMING_CALL_MAX_LINE_CHARS);
  });

  it('ignores a line that arrives on an accepted call', () => {
    expect(parseIncomingCallDecisionOutput('{"accept":true,"line":"随便写点什么"}')?.line).toBe('');
  });

  it('still reads a bare accept flag out of prose', () => {
    expect(parseIncomingCallDecisionOutput('我想了想，accept: false，现在不行')?.accept).toBe(false);
    expect(parseIncomingCallDecisionOutput('好吧，{"accept": true}')?.accept).toBe(true);
  });

  /**
   * 第三方模型不支持 tool_choice: required，常常不调工具、直接一句自然语言表态。
   * 「不想接」必须能读成拒绝，否则一次明确的拒绝会被误判成「无法接通」。
   */
  it('reads a refusal out of plain natural language', () => {
    expect(parseIncomingCallDecisionOutput('在忙，不接了')?.accept).toBe(false);
    expect(parseIncomingCallDecisionOutput('现在不方便说话')?.accept).toBe(false);
    expect(parseIncomingCallDecisionOutput('没空，回头再说')?.accept).toBe(false);
    expect(parseIncomingCallDecisionOutput('不想接')?.accept).toBe(false);
  });

  /**
   * DeepSeek-V4（deepseek-flash 等）用 DSML 文本标记代替标准 tool_calls 字段。
   * 模型"以为"在调工具，但输出落到 content 里，上层 nativeToolCalls 为空。
   * 这里必须能从 DSML 里抠出 accept / reason / line。
   */
  it('reads a DSML tool call out of the text', () => {
    const dsml = [
      '<|DSML|calls>',
      '<|DSML|invoke name="answerVoiceCall">',
      '<|DSML|parameter name="accept" string="false">false</|DSML|parameter>',
      '<|DSML|parameter name="reason" string="true">在开会</|DSML|parameter>',
      '<|DSML|parameter name="line" string="true">在忙，晚点打给你</|DSML|parameter>',
      '</|DSML|invoke>',
      '</|DSML|calls>'
    ].join('\n');

    expect(parseIncomingCallDecisionOutput(dsml))
      .toEqual({ accept: false, line: '在忙，晚点打给你', reason: '在开会' });
  });

  it('reads an accepted DSML call and drops its line', () => {
    const dsml = '<|DSML|invoke name="answerVoiceCall"><|DSML|parameter name="accept" string="false">true</|DSML|parameter><|DSML|parameter name="line" string="true"></|DSML|parameter></|DSML|invoke>';
    expect(parseIncomingCallDecisionOutput(dsml)?.accept).toBe(true);
    expect(parseIncomingCallDecisionOutput(dsml)?.line).toBe('');
  });

  it('tolerates fullwidth pipes in DSML markup', () => {
    const dsml = '<｜DSML｜invoke name="answerVoiceCall"><｜DSML｜parameter name="accept" string="false">false</｜DSML｜parameter><｜DSML｜parameter name="line" string="true">睡了</｜DSML｜parameter></｜DSML｜invoke>';
    expect(parseIncomingCallDecisionOutput(dsml))
      .toEqual({ accept: false, line: '睡了', reason: '' });
  });

  it('reads a pseudo-function call like answerVoiceCall(accept=...)', () => {
    const pseudo = 'answerVoiceCall(accept=true, reason="正好想找他", line="")';
    expect(parseIncomingCallDecisionOutput(pseudo))
      .toEqual({ accept: true, line: '', reason: '正好想找他' });
  });

  it('reads a pseudo-function refusal with a reason containing a comma', () => {
    const pseudo = 'answerVoiceCall(accept=false, reason="在忙，一会再说", line="晚点打")';
    expect(parseIncomingCallDecisionOutput(pseudo))
      .toEqual({ accept: false, line: '晚点打', reason: '在忙，一会再说' });
  });

  /**
   * 读不出结论时必须返回 null：这里没有「默认接听」这种兜底，因为替角色按下接听
   * 就是替它说话。这个空值在上层会变成「无法接通」（按报错呈现）。
   */
  it('returns null when nothing readable came back', () => {
    expect(parseIncomingCallDecisionOutput('')).toBeNull();
    expect(parseIncomingCallDecisionOutput('[1,2,3]')).toBeNull();
    expect(parseIncomingCallDecisionOutput('{"accept":"maybe"}')).toBeNull();
  });
});

describe('runIncomingCallDecision', () => {
  it('asks on the collaborator own provider binding', async () => {
    const requestReply = vi.fn().mockResolvedValue({ content: '{"accept":true}' });

    await runIncomingCallDecision({
      persona,
      globalApi: baseProvider,
      providers: [baseProvider, personaProvider],
      messages: [],
      requestReply
    });

    expect(requestReply).toHaveBeenCalledTimes(1);
    expect(requestReply.mock.calls[0]?.[0]?.api.id).toBe('persona-provider');
    expect(requestReply.mock.calls[0]?.[0]?.api.model).toBe('persona-model');
    expect(requestReply.mock.calls[0]?.[0]?.advanced?.streaming).toBe(false);
  });

  it('falls back to the global provider when the collaborator has no binding', async () => {
    const requestReply = vi.fn().mockResolvedValue({ content: '{"accept":true}' });

    await runIncomingCallDecision({
      persona: { ...persona, advanced: { ...persona.advanced, providerId: '' } },
      globalApi: baseProvider,
      providers: [baseProvider, personaProvider],
      messages: [],
      requestReply
    });

    expect(requestReply.mock.calls[0]?.[0]?.api.id).toBe('main-provider');
  });

  /**
   * 和主动消息决策层相反：那边失败要照常发声，这边失败就是接不上。
   * 硬接一通电话等于替角色开门，比打不通糟糕得多。
   */
  it('resolves to null when the request fails', async () => {
    const requestReply = vi.fn().mockRejectedValue(new Error('provider exploded'));

    await expect(runIncomingCallDecision({
      persona,
      globalApi: baseProvider,
      providers: [baseProvider],
      messages: [],
      requestReply
    })).resolves.toBeNull();
  });

  it('reads a natural-language refusal even without a format', async () => {
    const requestReply = vi.fn().mockResolvedValue({ content: '我不想接，但没说格式' });

    await expect(runIncomingCallDecision({
      persona,
      globalApi: baseProvider,
      providers: [baseProvider],
      messages: [],
      requestReply
    })).resolves.toMatchObject({ accept: false });
  });

  it('never even asks when the provider has no endpoint or model', async () => {
    const requestReply = vi.fn();

    await expect(runIncomingCallDecision({
      persona,
      globalApi: { ...baseProvider, model: '' },
      providers: [{ ...baseProvider, model: '' }],
      messages: [],
      requestReply
    })).resolves.toBeNull();
    expect(requestReply).not.toHaveBeenCalled();
  });

  /**
   * 主路是工具调用：结论在参数里，不用去猜模型怎么措辞。
   */
  it('reads the decision out of the forced tool call', async () => {
    const requestReply = vi.fn().mockResolvedValue({
      content: '',
      nativeToolCalls: [{
        name: INCOMING_CALL_ANSWER_TOOL_NAME,
        argumentsText: '{"accept":false,"reason":"在开会","line":"在忙，晚点打给你"}'
      }]
    });

    await expect(runIncomingCallDecision({
      persona,
      globalApi: baseProvider,
      providers: [baseProvider],
      messages: [],
      requestReply
    })).resolves.toEqual({ accept: false, line: '在忙，晚点打给你', reason: '在开会' });
  });
});

describe('readIncomingCallDecision', () => {
  it('prefers the answer tool over another call in the same reply', () => {
    const decision = readIncomingCallDecision({
      content: '',
      nativeToolCalls: [
        { name: 'somethingElse', argumentsText: '{"accept":true}' },
        { name: INCOMING_CALL_ANSWER_TOOL_NAME, argumentsText: '{"accept":false,"line":"睡了"}' }
      ]
    });

    expect(decision).toEqual({ accept: false, line: '睡了', reason: '' });
  });

  it('falls back to the plain-text contract when no tool call came back', () => {
    // 兼容层会把原生工具整个清空（provider 不支持时），这时只剩文本那条路。
    expect(readIncomingCallDecision({ content: '{"accept":true,"reason":"正好想找他"}' }))
      .toEqual({ accept: true, line: '', reason: '正好想找他' });
  });

  it('retries the text when the tool arguments are unreadable', () => {
    expect(readIncomingCallDecision({
      content: '{"accept":false,"line":"在忙"}',
      nativeToolCalls: [{ name: INCOMING_CALL_ANSWER_TOOL_NAME, argumentsText: '{}' }]
    })).toEqual({ accept: false, line: '在忙', reason: '' });
  });

  it('returns null when neither the tool call nor the text decides anything', () => {
    expect(readIncomingCallDecision({
      content: '我想了想，还是算了',
      nativeToolCalls: [{ name: INCOMING_CALL_ANSWER_TOOL_NAME, argumentsText: '' }]
    })).toBeNull();
  });
});
