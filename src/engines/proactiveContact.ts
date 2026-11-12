import type {
  ChatMessage,
  PolarisProactiveContactSettings,
  PolarisTriggerRule
} from '../types/domain';
import type { AssistantRequestContext } from './request/requestContext';
import {
  describeProactiveDecisionMessages,
  extractJsonObjectText,
  formatDecisionClock
} from './proactiveDecision';
import { normalizeProactiveContactSettings } from './triggers';

export const PROACTIVE_SETTINGS_RULE_NAME = '主动联系';
export const PROACTIVE_PLAN_RULE_NAME = '主动预约';
export const PROACTIVE_PLAN_MIN_DELAY_MINUTES = 10;
export const PROACTIVE_PLAN_MAX_DELAY_MINUTES = 12 * 60;
export const PROACTIVE_PLAN_MAX_HINT_CHARS = 200;

export const DEFAULT_PROACTIVE_CONTACT_SETTINGS: PolarisProactiveContactSettings = {
  enabled: false,
  maxPerDay: 6,
  quietHours: true,
  sentToday: 0,
  day: ''
};

export function localDayKey(value: number | Date = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function findProactiveSettingsRule(
  rules: PolarisTriggerRule[],
  collaboratorId: string | null | undefined
) {
  const normalizedCollaboratorId = collaboratorId?.trim();
  if (!normalizedCollaboratorId) return null;
  return rules.find((rule) =>
    rule.mode === 'proactive-settings'
    && rule.target.collaboratorId === normalizedCollaboratorId
  ) ?? null;
}

export function findProactivePlanRule(
  rules: PolarisTriggerRule[],
  conversationId: string | null | undefined
) {
  const normalizedConversationId = conversationId?.trim();
  if (!normalizedConversationId) return null;
  return rules.find((rule) =>
    rule.mode === 'proactive-plan'
    && rule.target.conversationId === normalizedConversationId
  ) ?? null;
}

export function resolveProactiveSettings(rule: PolarisTriggerRule | null | undefined) {
  return normalizeProactiveContactSettings(rule?.proactiveSettings ?? DEFAULT_PROACTIVE_CONTACT_SETTINGS);
}

export function resolveTodayProactiveSentCount(
  settings: PolarisProactiveContactSettings,
  now = Date.now()
) {
  return settings.day === localDayKey(now) ? settings.sentToday : 0;
}

export function isQuietHour(nowMs: number, settings: PolarisProactiveContactSettings) {
  if (!settings.quietHours) return false;
  const hour = new Date(nowMs).getHours();
  return hour >= 1 && hour < 8;
}

export function moveOutOfQuietHours(nowMs: number, settings: PolarisProactiveContactSettings) {
  if (!isQuietHour(nowMs, settings)) return nowMs;
  const date = new Date(nowMs);
  date.setHours(8, Math.floor(Math.random() * 30), 0, 0);
  return date.getTime();
}

export function normalizeProactivePlanDelayMinutes(value: unknown) {
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : NaN;
  if (!Number.isFinite(numeric)) return null;
  return Math.min(
    PROACTIVE_PLAN_MAX_DELAY_MINUTES,
    Math.max(PROACTIVE_PLAN_MIN_DELAY_MINUTES, Math.round(numeric))
  );
}

export type ProactivePlan = {
  delayMinutes: number;
  hint: string;
};

export function parseProactivePlanOutput(text: string): ProactivePlan | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^null$/i.test(trimmed)) return null;

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(extractJsonObjectText(trimmed));
  } catch {
    parsed = null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  const delayMinutes = normalizeProactivePlanDelayMinutes(record.delayMinutes);
  if (delayMinutes === null) return null;

  const hint = typeof record.hint === 'string'
    ? record.hint.replace(/\s+/g, ' ').trim().slice(0, PROACTIVE_PLAN_MAX_HINT_CHARS)
    : '';
  if (!hint) return null;

  return { delayMinutes, hint };
}

export const PROACTIVE_PLAN_SYSTEM_PROMPT = [
  '你是 Polaris 主动联系的预约层。每次当前这轮聊完后，你只需要判断：如果对方一直没回，什么时候、问什么比较自然。',
  '不要每次都找；如果这轮已经把话说完、没有值得回访的线索，就返回 null。',
  '如果值得回访，返回一个 JSON 对象，不要输出 JSON 以外的任何内容。',
  'delayMinutes 只能是 10 到 720 之间的数字。hint 是一句简短的开口方向，不是成稿话术。',
  '严格格式：{"delayMinutes": 数字, "hint": "想问的内容"} 或 null。'
].join('\n');

export type ProactivePlanPromptArgs = {
  messages: ChatMessage[];
  collaboratorName: string;
  userName?: string;
  now: number;
};

export function buildProactivePlanPrompt(args: ProactivePlanPromptArgs) {
  const recent = describeProactiveDecisionMessages({
    messages: args.messages,
    collaboratorName: args.collaboratorName,
    userName: args.userName
  });
  return [
    `当前时间：${formatDecisionClock(args.now)}`,
    `说话双方：${args.userName?.trim() || '用户'} 是用户；${args.collaboratorName.trim() || '协作者'} 是你（协作者）。`,
    '',
    '最近的对话记录（从旧到新，可能被截断）：',
    recent.length > 0 ? recent.join('\n') : '（没有可用历史。）',
    '',
    '请判断要不要预约一次主动回访。',
    '严格输出：{"delayMinutes": 数字, "hint": "想问的内容"} 或 null。',
    '如果现在这轮已经自然收尾、没有值得回访的线索，返回 null。'
  ].join('\n');
}

export function buildProactivePlanRequestContext(
  args: ProactivePlanPromptArgs
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
          content: PROACTIVE_PLAN_SYSTEM_PROMPT
        }]
      },
      {
        kind: 'conversation',
        messages: [{
          role: 'user',
          content: buildProactivePlanPrompt(args)
        }]
      }
    ],
    toolChoice: 'none'
  };
}