import { describe, expect, it, vi } from 'vitest';
import { createPersonaTemplate } from '../config/persona/personaBuilder';
import type { ChatMessage, PolarisTriggerRule, ProviderProfile } from '../types/domain';
import { runProactiveDecision } from '../app/chat/proactiveDecisionRunner';
import {
  buildProactiveDecisionPrompt,
  buildProactiveDecisionRequestContext,
  describeProactiveDecisionMessages,
  formatDecisionClock,
  formatDecisionElapsed,
  parseProactiveDecisionOutput,
  PROACTIVE_DECISION_MAX_CONTEXT_MESSAGES,
  PROACTIVE_DECISION_MAX_MESSAGE_CHARS,
  PROACTIVE_DECISION_SYSTEM_PROMPT
} from './proactiveDecision';

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

function buildRule(overrides: { name?: string; prompt?: string } = {}): PolarisTriggerRule {
  return {
    id: 'rule-1',
    name: overrides.name ?? '主动消息',
    source: 'schedule',
    webhookSecret: '',
    enabled: true,
    schedule: { kind: 'idle', idleMinutes: 360 },
    target: { collaboratorId: 'persona-1', conversationMode: 'follow-latest', conversationId: null },
    action: { prompt: overrides.prompt ?? '主动找用户聊两句' },
    nextRunAt: null,
    lastRunAt: null,
    lastError: null,
    createdAt: 0,
    updatedAt: 0
  };
}

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

// 用本地时间构造时间戳，避免断言依赖运行机器的时区。
const LOCAL_CLOCK_MS = new Date(2026, 8, 18, 10, 54).getTime();

describe('formatDecisionClock', () => {
  it('renders a readable local clock', () => {
    expect(formatDecisionClock(LOCAL_CLOCK_MS)).toBe('2026-09-18 10:54');
  });
});

describe('formatDecisionElapsed', () => {
  it('renders minutes below an hour', () => {
    expect(formatDecisionElapsed(45 * 60_000)).toBe('45 分钟');
  });

  it('renders whole hours without a minute part', () => {
    expect(formatDecisionElapsed(6 * 60 * 60_000)).toBe('6 小时');
  });

  it('renders hours and minutes together', () => {
    expect(formatDecisionElapsed((7 * 60 + 12) * 60_000)).toBe('7 小时 12 分钟');
  });

  it('never goes negative', () => {
    expect(formatDecisionElapsed(-5_000)).toBe('0 分钟');
  });
});

describe('describeProactiveDecisionMessages', () => {
  const messages: ChatMessage[] = [
    buildMessage({ id: 'm1', role: 'user', content: '帮我看下排版', timestamp: LOCAL_CLOCK_MS, origin: 'user-input' }),
    buildMessage({ id: 'm2', role: 'assistant', content: '好，我先改间距', timestamp: LOCAL_CLOCK_MS + 60_000 }),
    buildMessage({ id: 'm3', role: 'system', content: '（定时唤醒：主动消息）', timestamp: LOCAL_CLOCK_MS + 120_000, origin: 'trigger-runtime' })
  ];

  it('labels both speakers and skips internal system messages', () => {
    const lines = describeProactiveDecisionMessages({
      messages,
      collaboratorName: '薇加',
      userName: 'Y'
    });

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('Y：帮我看下排版');
    expect(lines[1]).toContain('薇加：好，我先改间距');
  });

  it('keeps only the most recent messages up to the limit', () => {
    const many = Array.from({ length: 20 }, (_, index) => buildMessage({
      id: `m${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `内容 ${index}`,
      timestamp: LOCAL_CLOCK_MS + index * 1_000
    }));

    const lines = describeProactiveDecisionMessages({ messages: many, collaboratorName: '薇加' });

    expect(lines).toHaveLength(PROACTIVE_DECISION_MAX_CONTEXT_MESSAGES);
    expect(lines[lines.length - 1]).toContain('内容 19');
    expect(lines[0]).toContain('内容 8');
  });

  it('drops messages without usable content', () => {
    const lines = describeProactiveDecisionMessages({
      messages: [
        buildMessage({ id: 'm1', role: 'user', content: '   ', timestamp: LOCAL_CLOCK_MS }),
        buildMessage({ id: 'm2', role: 'assistant', content: '在的', timestamp: LOCAL_CLOCK_MS })
      ],
      collaboratorName: '薇加'
    });

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('在的');
  });
});

describe('buildProactiveDecisionPrompt', () => {
  it('carries the clock, the silence gap, the rule intent and the history', () => {
    const prompt = buildProactiveDecisionPrompt({
      rule: buildRule({ name: '夜里想起你', prompt: '主动找用户聊两句' }),
      collaboratorName: '薇加',
      userName: 'Y',
      lastActivityAt: LOCAL_CLOCK_MS - 7 * 60 * 60_000,
      now: LOCAL_CLOCK_MS,
      messages: [
        buildMessage({ id: 'm1', role: 'user', content: '先这样吧', timestamp: LOCAL_CLOCK_MS, origin: 'user-input' })
      ]
    });

    expect(prompt).toContain('当前时间：2026-09-18 10:54');
    expect(prompt).toContain('距离用户最后一次发言已经过去 7 小时');
    expect(prompt).toContain('这次唤醒的设定名：夜里想起你');
    expect(prompt).toContain('唤醒时给定的意图：主动找用户聊两句');
    expect(prompt).toContain('Y：先这样吧');
    expect(prompt).toContain('"send"');
  });

  it('says so explicitly when there is no history at all', () => {
    const prompt = buildProactiveDecisionPrompt({
      rule: buildRule(),
      collaboratorName: '薇加',
      lastActivityAt: null,
      now: LOCAL_CLOCK_MS,
      messages: []
    });

    expect(prompt).toContain('没有记录到用户说过话');
    expect(prompt).toContain('这是第一次开口');
  });

  it('omits the intent line when the rule has no prompt', () => {
    const prompt = buildProactiveDecisionPrompt({
      rule: buildRule({ prompt: '   ' }),
      collaboratorName: '薇加',
      lastActivityAt: null,
      now: LOCAL_CLOCK_MS,
      messages: []
    });

    expect(prompt).not.toContain('唤醒时给定的意图');
  });
});

describe('buildProactiveDecisionRequestContext', () => {
  it('uses no tools and disables attachments', () => {
    const context = buildProactiveDecisionRequestContext({
      rule: buildRule(),
      collaboratorName: '薇加',
      lastActivityAt: null,
      now: LOCAL_CLOCK_MS,
      messages: []
    });

    expect(context.toolChoice).toBe('none');
    expect(context.tools).toBeUndefined();
    expect(context.attachmentSlots.enabled).toBe(false);
    expect(context.segments[0]?.messages[0]?.content).toBe(PROACTIVE_DECISION_SYSTEM_PROMPT);
    expect(context.segments.map((segment) => segment.kind)).toEqual(['system', 'conversation']);
  });
});

describe('parseProactiveDecisionOutput', () => {
  it('reads a plain send decision', () => {
    expect(parseProactiveDecisionOutput('{"send":true,"reason":"有未收尾的线索","message":"上次那个配色我还在想"}')).toEqual({
      send: true,
      reason: '有未收尾的线索',
      message: '上次那个配色我还在想'
    });
  });

  it('reads a skip decision and clears the message', () => {
    expect(parseProactiveDecisionOutput('{"send":false,"reason":"用户刚走开","message":"随便说点什么"}')).toEqual({
      send: false,
      reason: '用户刚走开',
      message: null
    });
  });

  it('unwraps fenced json', () => {
    expect(parseProactiveDecisionOutput('```json\n{"send":false,"reason":"话题已收尾"}\n```')).toMatchObject({
      send: false,
      reason: '话题已收尾'
    });
  });

  it('unwraps json buried in prose', () => {
    expect(parseProactiveDecisionOutput('我的判断是 {"send":true,"reason":"有新进展"} 就这样。')).toMatchObject({
      send: true,
      reason: '有新进展'
    });
  });

  it('accepts string and numeric boolean spellings', () => {
    expect(parseProactiveDecisionOutput('{"send":"false"}').send).toBe(false);
    expect(parseProactiveDecisionOutput('{"send":"YES"}').send).toBe(true);
    expect(parseProactiveDecisionOutput('{"send":0}').send).toBe(false);
    expect(parseProactiveDecisionOutput('{"send":1}').send).toBe(true);
  });

  it('treats an empty message as no direction rather than as a blank instruction', () => {
    expect(parseProactiveDecisionOutput('{"send":true,"message":"   "}')).toEqual({
      send: true,
      reason: '',
      message: null
    });
  });

  it('clips an overlong direction', () => {
    const long = 'x'.repeat(PROACTIVE_DECISION_MAX_MESSAGE_CHARS + 50);
    const decision = parseProactiveDecisionOutput(JSON.stringify({ send: true, message: long }));
    expect(decision.message).toHaveLength(PROACTIVE_DECISION_MAX_MESSAGE_CHARS);
  });

  it('falls back to sending when the output is not json at all', () => {
    expect(parseProactiveDecisionOutput('我觉得还是别打扰他了')).toEqual({
      send: true,
      reason: '',
      message: null
    });
  });

  it('falls back to sending when the send flag is unreadable', () => {
    expect(parseProactiveDecisionOutput('{"send":"maybe","reason":"拿不准"}')).toEqual({
      send: true,
      reason: '',
      message: null
    });
  });

  it('falls back to sending on an empty payload', () => {
    expect(parseProactiveDecisionOutput('')).toEqual({ send: true, reason: '', message: null });
  });

  it('falls back to sending when json parses to a non-object', () => {
    expect(parseProactiveDecisionOutput('[1,2,3]')).toEqual({ send: true, reason: '', message: null });
  });
});

describe('runProactiveDecision', () => {
  const collaborator = createPersonaTemplate({
    id: 'persona-1',
    name: '薇加',
    description: '测试用协作者',
    advanced: { providerId: 'persona-provider', modelOverride: '' }
  });

  it('runs on the collaborator own provider binding', async () => {
    const requestReply = vi.fn().mockResolvedValue({ content: '{"send":true,"reason":"ok"}' });

    await runProactiveDecision({
      persona: collaborator,
      globalApi: baseProvider,
      providers: [baseProvider, personaProvider],
      rule: buildRule(),
      messages: [],
      lastActivityAt: null,
      requestReply
    });

    expect(requestReply).toHaveBeenCalledTimes(1);
    expect(requestReply.mock.calls[0]?.[0]?.api.id).toBe('persona-provider');
    expect(requestReply.mock.calls[0]?.[0]?.api.model).toBe('persona-model');
  });

  it('falls back to the global provider when the collaborator has no binding', async () => {
    const requestReply = vi.fn().mockResolvedValue({ content: '{"send":true}' });

    await runProactiveDecision({
      persona: { ...collaborator, advanced: { ...collaborator.advanced, providerId: '' } },
      globalApi: baseProvider,
      providers: [baseProvider, personaProvider],
      rule: buildRule(),
      messages: [],
      lastActivityAt: null,
      requestReply
    });

    expect(requestReply.mock.calls[0]?.[0]?.api.id).toBe('main-provider');
  });

  it('never streams and keeps the decision deterministic', async () => {
    const requestReply = vi.fn().mockResolvedValue({ content: '{"send":true}' });

    await runProactiveDecision({
      persona: collaborator,
      globalApi: baseProvider,
      providers: [baseProvider],
      rule: buildRule(),
      messages: [],
      lastActivityAt: null,
      requestReply
    });

    expect(requestReply.mock.calls[0]?.[0]?.advanced?.streaming).toBe(false);
    expect(requestReply.mock.calls[0]?.[0]?.advanced?.temperature).toBe('0.2');
  });

  it('fails open so a broken decision call never swallows a normal trigger', async () => {
    const requestReply = vi.fn().mockRejectedValue(new Error('provider exploded'));

    await expect(runProactiveDecision({
      persona: collaborator,
      globalApi: baseProvider,
      providers: [baseProvider],
      rule: buildRule(),
      messages: [],
      lastActivityAt: null,
      requestReply
    })).resolves.toEqual({ send: true, reason: '', message: null });
  });

  it('honours an explicit skip', async () => {
    const requestReply = vi.fn().mockResolvedValue({ content: '{"send":false,"reason":"用户在忙"}' });

    await expect(runProactiveDecision({
      persona: collaborator,
      globalApi: baseProvider,
      providers: [baseProvider],
      rule: buildRule(),
      messages: [],
      lastActivityAt: null,
      requestReply
    })).resolves.toEqual({ send: false, reason: '用户在忙', message: null });
  });
});
