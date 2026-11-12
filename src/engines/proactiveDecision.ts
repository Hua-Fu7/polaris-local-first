import type { ChatMessage, PolarisTriggerRule } from '../types/domain';
import type { AssistantRequestContext } from './request/requestContext';

/**
 * 主动消息的决策层：在触发器真正投递之前，先让模型判断「现在该不该开口」。
 *
 * 这一层是纯粹的判断，不负责生成最终回复。判断通过后，仍然走原来的
 * 回复链路（人格、记忆、工具、落盘、通知），保证主动消息和平时说话没有区别。
 */

/** 决策层最多回看的近期消息条数。 */
export const PROACTIVE_DECISION_MAX_CONTEXT_MESSAGES = 12;

/** 决策层给出的「开口方向」长度上限。 */
export const PROACTIVE_DECISION_MAX_MESSAGE_CHARS = 200;

/** 判断依据的长度上限。 */
export const PROACTIVE_DECISION_MAX_REASON_CHARS = 200;

/**
 * 决策请求失败时的兜底：照常触发。
 *
 * 决策层是「少打扰」的附加保险，它自己出错时不应该顺手把正常触发也吞掉——
 * 真的发不出去，后面的回复链路会照常报错并记录。
 */
export const PROACTIVE_DECISION_FALLBACK: ProactiveDecision = {
  send: true,
  message: null,
  reason: ''
};

export type ProactiveDecision = {
  /** 是否真的要主动开口。 */
  send: boolean;
  /** 决定开口时，给回复链路的「这次想聊什么」；没有方向时为 null。 */
  message: string | null;
  /** 一句话判断依据，用于状态栏和排查。 */
  reason: string;
};

export const PROACTIVE_DECISION_SYSTEM_PROMPT = [
  '你是 Polaris 主动消息的决策层。你唯一的职责是：在系统自动唤醒一个协作者、准备主动找用户说话之前，判断这次开口到底值不值得。',
  '你会收到当前时间、用户最后一次发言过去了多久、这次唤醒的设定，以及最近的对话记录。',
  '',
  '只有这条主动消息对用户有真实价值时，才值得打扰他。出现下面任何一条，就应该放弃本次发送：',
  '- 用户刚刚还在对话里，话题正热，此时插话只会打断他。',
  '- 上一轮已经自然收尾，没有留下任何未完成的线索。',
  '- 系统正在等用户回答一个还需要他思考的问题。',
  '- 你没有任何新信息、新进展或新观察可给，只能说一句没有内容的寒暄。',
  '- 同一个话题在最近几轮里已经追问过，重复开口是骚扰。',
  '',
  '如果决定开口，可以顺带给出一句具体的开口方向，说明这次想聊什么。没有明确方向时留空——由回复链路自己决定怎么说。',
  '开口方向是给回复链路的意图提示，不是你要对用户说的话，不要写成正式的任务说明。',
  '',
  '只输出一个 JSON 对象，不要输出 JSON 以外的任何内容，不要用 Markdown 代码块包裹。'
].join('\n');

/** 把时间戳格式化成给人看（也给模型看）的时钟文案。 */
export function formatDecisionClock(ms: number) {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 把一段毫秒差写成「7 小时 12 分钟」这种口语时长。 */
export function formatDecisionElapsed(ms: number) {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} 小时` : `${hours} 小时 ${minutes} 分钟`;
}

function resolveDecisionMessageSpeaker(args: {
  message: ChatMessage;
  collaboratorName: string;
  userName: string;
}) {
  const { message } = args;
  if (message.origin === 'user-input' || message.role === 'user') return args.userName;
  if (message.role === 'assistant') return args.collaboratorName;
  // system / trigger-runtime 这类内部消息对判断没有帮助，直接略过。
  return null;
}

/**
 * 把近期消息压成「[时间] 说话人：内容」的行列表，只保留最后 limit 条。
 * 这是决策层唯一的历史来源。
 */
export function describeProactiveDecisionMessages(args: {
  messages: ChatMessage[];
  collaboratorName: string;
  userName?: string;
  limit?: number;
}) {
  const limit = args.limit ?? PROACTIVE_DECISION_MAX_CONTEXT_MESSAGES;
  const collaboratorName = args.collaboratorName.trim() || '协作者';
  const userName = args.userName?.trim() || '用户';

  const lines: string[] = [];
  for (const message of args.messages) {
    const speaker = resolveDecisionMessageSpeaker({ message, collaboratorName, userName });
    if (!speaker) continue;
    const content = message.content.replace(/\s+/g, ' ').trim();
    if (!content) continue;
    lines.push(`[${formatDecisionClock(message.timestamp)}] ${speaker}：${content}`);
  }

  return lines.slice(-limit);
}

export type ProactiveDecisionPromptArgs = {
  rule: PolarisTriggerRule;
  collaboratorName: string;
  messages: ChatMessage[];
  /** 用户最后一次发言时间；没有记录时传 null。 */
  lastActivityAt: number | null;
  now: number;
  userName?: string;
};

export function buildProactiveDecisionPrompt(args: ProactiveDecisionPromptArgs) {
  const userName = args.userName?.trim() || '用户';
  const collaboratorName = args.collaboratorName.trim() || '协作者';
  const ruleIntent = args.rule.action.prompt?.trim() ?? '';
  const inactivity = args.lastActivityAt === null
    ? '没有记录到用户说过话'
    : `距离用户最后一次发言已经过去 ${formatDecisionElapsed(args.now - args.lastActivityAt)}`;
  const recent = describeProactiveDecisionMessages({
    messages: args.messages,
    collaboratorName,
    userName
  });

  return [
    `当前时间：${formatDecisionClock(args.now)}`,
    `说话双方：${userName} 是用户；${collaboratorName} 是你（协作者）。`,
    `这次唤醒的设定名：${args.rule.name}`,
    ruleIntent ? `唤醒时给定的意图：${ruleIntent}` : null,
    `用户状态：${inactivity}。`,
    '',
    '最近的对话记录（从旧到新，可能被截断）：',
    recent.length > 0 ? recent.join('\n') : '（没有可用的历史消息，这是第一次开口。）',
    '',
    '请判断这次该不该主动开口。',
    '严格输出下面这个 JSON 结构：',
    '{"send": true 或 false, "reason": "一句话判断依据", "message": "决定开口时给出一句具体的开口方向，不开口或没有方向时用空字符串"}',
    `message 不要超过 ${PROACTIVE_DECISION_MAX_MESSAGE_CHARS} 个字符。`
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

export function buildProactiveDecisionRequestContext(
  args: ProactiveDecisionPromptArgs
): AssistantRequestContext {
  return {
    memorySlots: {
      session: [],
      profile: [],
      pin: []
    },
    attachmentSlots: {
      enabled: false,
      pending: []
    },
    segments: [
      {
        kind: 'system',
        messages: [{
          role: 'system',
          content: PROACTIVE_DECISION_SYSTEM_PROMPT
        }]
      },
      {
        kind: 'conversation',
        messages: [{
          role: 'user',
          content: buildProactiveDecisionPrompt(args)
        }]
      }
    ],
    toolChoice: 'none'
  };
}

/** 模型偶尔会把 JSON 包在代码块或解释文字里，这里把对象抠出来。 */
export function extractJsonObjectText(text: string) {
  const trimmed = text.trim();

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const candidate = fenced[1].trim();
    if (candidate.startsWith('{')) return candidate;
  }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1);
  }
  return trimmed;
}

const DECISION_TRUE_TOKENS = new Set(['true', 'yes', 'send', '1']);
const DECISION_FALSE_TOKENS = new Set(['false', 'no', 'skip', 'hold', '0']);

/** 容错地读 send 字段：接受布尔、0/1、以及常见的字符串写法。 */
function normalizeDecisionFlag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (DECISION_TRUE_TOKENS.has(normalized)) return true;
    if (DECISION_FALSE_TOKENS.has(normalized)) return false;
  }
  return null;
}

function normalizeDecisionText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

/**
 * 解析决策层输出。
 *
 * 只有两种情况会退回兜底（照常触发）：输出根本不是 JSON，或者 send 字段读不出布尔语义。
 * 读得出 send === false 就一定会跳过——这是这一层存在的意义。
 */
export function parseProactiveDecisionOutput(text: string): ProactiveDecision {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(extractJsonObjectText(text));
  } catch {
    parsed = null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...PROACTIVE_DECISION_FALLBACK };
  }

  const record = parsed as Record<string, unknown>;
  const send = normalizeDecisionFlag(record.send);
  if (send === null) return { ...PROACTIVE_DECISION_FALLBACK };

  const reason = normalizeDecisionText(record.reason, PROACTIVE_DECISION_MAX_REASON_CHARS);
  if (!send) return { send: false, message: null, reason };

  const message = normalizeDecisionText(record.message, PROACTIVE_DECISION_MAX_MESSAGE_CHARS);
  return { send: true, message: message || null, reason };
}
