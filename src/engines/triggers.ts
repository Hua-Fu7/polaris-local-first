import { createUid } from './id';
import type {
  Conversation,
  PolarisTriggerAction,
  PolarisTriggerRule,
  PolarisTriggerSchedule,
  PolarisTriggerSource,
  PolarisTriggerTarget
} from '../types/domain';
import type {
  PolarisProactiveContactSettings,
  PolarisTriggerRuleMode
} from '../types/domain';

export type CreateScheduledTriggerRuleInput = {
  name?: string;
  mode?: PolarisTriggerRuleMode;
  schedule: PolarisTriggerSchedule;
  target: PolarisTriggerTarget;
  action: PolarisTriggerAction;
  proactiveSettings?: PolarisProactiveContactSettings;
  sourceMessageId?: string;
  source?: PolarisTriggerSource;
  nextRunAt?: number | null;
  now?: number;
};

type PersistedTriggerRuleInput = Omit<Partial<PolarisTriggerRule>, 'action' | 'schedule' | 'target'> & {
  action?: Partial<PolarisTriggerAction> | null;
  schedule?: Partial<PolarisTriggerSchedule> | null;
  target?: Partial<PolarisTriggerTarget> | null;
};

const DEFAULT_TRIGGER_NAME = '主动消息';
const DEFAULT_DAILY_TIME = '09:00';
const DEFAULT_INTERVAL_MINUTES = 60;

/** 预排期通知没有真实内容可用时的兜底正文。 */
export const TRIGGER_NOTIFICATION_FALLBACK_BODY = '点开看看 TA 想说什么';

const TRIGGER_NOTIFICATION_BODY_MAX_LENGTH = 60;

/**
 * 空闲触发的默认阈值：6 小时。
 * 时间尺度刻意取小时级——几分钟级别的主动消息重复打扰感很强。
 */
export const DEFAULT_IDLE_MINUTES = 6 * 60;

/** 空闲触发允许的最小阈值，避免用户填出分钟级的轰炸配置。 */
export const MIN_IDLE_MINUTES = 15;

const MAX_IDLE_MINUTES = 30 * 24 * 60;

/**
 * 活跃保护：任何规则到期时，只要用户在这段时间内有过发言，就跳过本次投递。
 * 这一条对所有 schedule 类型生效，因为"正在聊天时被主动消息打断"和排期方式无关。
 * 主要兜住的是 App 被系统停掉数小时后重新打开、过期规则在唤醒瞬间补发的场景。
 */
export const DEFAULT_ACTIVE_GUARD_MINUTES = 60;

const MAX_ACTIVE_GUARD_MINUTES = 24 * 60;

function parseDailyTime(value: string) {
  const match = value.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2])
  };
}

function normalizeDailyTime(value: string | undefined) {
  const parsed = value ? parseDailyTime(value) : null;
  if (!parsed) return DEFAULT_DAILY_TIME;
  return `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')}`;
}

function normalizeIntervalMinutes(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1) {
    return DEFAULT_INTERVAL_MINUTES;
  }
  return Math.floor(value);
}

export function normalizeIdleMinutes(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < MIN_IDLE_MINUTES) {
    return DEFAULT_IDLE_MINUTES;
  }
  return Math.min(Math.floor(value), MAX_IDLE_MINUTES);
}

export function normalizeTriggerSchedule(schedule?: Partial<PolarisTriggerSchedule> | null): PolarisTriggerSchedule {
  if (schedule?.kind === 'interval') {
    return {
      kind: 'interval',
      everyMinutes: normalizeIntervalMinutes(schedule.everyMinutes)
    };
  }

  if (schedule?.kind === 'idle') {
    return {
      kind: 'idle',
      idleMinutes: normalizeIdleMinutes(schedule.idleMinutes)
    };
  }

  return {
    kind: 'daily',
    time: normalizeDailyTime(schedule?.kind === 'daily' ? schedule.time : undefined)
  };
}

export function resolveNextTriggerRunAt(
  schedule: PolarisTriggerSchedule,
  fromMs = Date.now(),
  lastActivityAt?: number | null
) {
  if (schedule.kind === 'interval') {
    return fromMs + normalizeIntervalMinutes(schedule.everyMinutes) * 60_000;
  }

  if (schedule.kind === 'idle') {
    return resolveIdleTriggerRunAt(schedule.idleMinutes, lastActivityAt ?? fromMs);
  }

  const { hour, minute } = parseDailyTime(schedule.time) ?? parseDailyTime(DEFAULT_DAILY_TIME)!;
  for (let dayOffset = 0; ; dayOffset += 1) {
    const next = resolveLocalDailyRunDate(fromMs, dayOffset, hour, minute);
    if (next !== null && next > fromMs) {
      return next;
    }
  }
}

/**
 * 空闲触发的到期时刻 = 锚点 + 阈值。锚点缺省时用当前时间，也就是"从现在开始计时"。
 * 返回值可能早于当前时间——那表示用户已经空闲够久，规则应立即视为到期。
 */
export function resolveIdleTriggerRunAt(idleMinutes: number, anchorMs: number) {
  return Math.floor(anchorMs) + normalizeIdleMinutes(idleMinutes) * 60_000;
}

/**
 * 推导"用户最后活跃时间"：取所有对话里最新一条用户自己发出的消息的时间戳。
 * 刻意不新增持久化字段，直接复用 ChatMessage 已有的 timestamp / origin，
 * 这样不会碰 LocalData 的 schema 与迁移边界。
 */
export function resolveLastUserActivityAt(conversations: Conversation[]): number | null {
  let latest: number | null = null;
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      const fromUser = message.origin === 'user-input' || message.role === 'user';
      if (!fromUser) continue;
      if (typeof message.timestamp !== 'number' || !Number.isFinite(message.timestamp)) continue;
      if (latest === null || message.timestamp > latest) {
        latest = message.timestamp;
      }
    }
  }
  return latest;
}

export function normalizeActiveGuardMinutes(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return DEFAULT_ACTIVE_GUARD_MINUTES;
  }
  return Math.min(Math.floor(value), MAX_ACTIVE_GUARD_MINUTES);
}

/** 把空闲阈值渲染成人话，例如 360 → "6 小时"、90 → "1 小时 30 分钟"。 */
export function formatIdleThreshold(idleMinutes: number) {
  const normalized = normalizeIdleMinutes(idleMinutes);
  if (normalized < 60) return `${normalized} 分钟`;
  if (normalized % 60 === 0) return `${normalized / 60} 小时`;
  return `${Math.floor(normalized / 60)} 小时 ${normalized % 60} 分钟`;
}

/** 排期的人话描述。工具描述、规则列表等共用一套说法，避免各处各写一份。 */
export function describeTriggerSchedule(schedule: PolarisTriggerSchedule) {
  switch (schedule.kind) {
    case 'daily':
      return `每天 ${schedule.time}`;
    case 'interval':
      return `每隔 ${schedule.everyMinutes} 分钟`;
    case 'idle':
      return `空闲 ${formatIdleThreshold(schedule.idleMinutes)} 后`;
  }
}

/**
 * 活跃保护判定：到期时如果用户刚刚说过话，说明这次主动消息的前提（"你不在"）已经不成立，
 * 应该跳过而不是硬发。没有任何活跃记录时不做拦截，避免把规则永久堵死。
 */
export function shouldSkipTriggerForActivity(args: {
  lastActivityAt: number | null;
  now?: number;
  guardMinutes?: number;
}) {
  if (args.lastActivityAt === null) return false;
  const now = args.now ?? Date.now();
  const guardMs = normalizeActiveGuardMinutes(args.guardMinutes) * 60_000;
  return now - args.lastActivityAt < guardMs;
}

function resolveLocalDailyRunDate(fromMs: number, dayOffset: number, hour: number, minute: number) {
  const from = new Date(fromMs);
  const next = new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate() + dayOffset,
    hour,
    minute,
    0,
    0
  );
  if (next.getHours() !== hour || next.getMinutes() !== minute) {
    return null;
  }
  return next.getTime();
}

function normalizeTriggerSource(source: unknown): PolarisTriggerSource {
  return source === 'webhook' || source === 'shortcut' || source === 'mcp' || source === 'manual'
    ? source
    : 'schedule';
}

function normalizeWebhookSecret(secret: unknown) {
  return typeof secret === 'string' && secret.trim()
    ? secret.trim()
    : createUid('trigger-secret');
}

function normalizeTriggerTarget(target?: Partial<PolarisTriggerTarget> | null): PolarisTriggerTarget {
  const conversationMode = target?.conversationMode === 'fixed' ? 'fixed' : 'follow-latest';
  const conversationId = target?.conversationId?.trim() || null;
  return {
    collaboratorId: target?.collaboratorId?.trim() || '',
    conversationMode,
    conversationId: conversationMode === 'fixed' ? conversationId : null
  };
}

function normalizeTriggerAction(action?: Partial<PolarisTriggerAction> | null): PolarisTriggerAction {
  return {
    prompt: action?.prompt?.trim() || ''
  };
}

export function normalizeProactiveContactSettings(
  settings?: Partial<PolarisProactiveContactSettings> | null
): PolarisProactiveContactSettings {
  const maxPerDay = settings?.maxPerDay === 3 || settings?.maxPerDay === 6 || settings?.maxPerDay === 10
    ? settings.maxPerDay
    : 6;
  const sentToday = typeof settings?.sentToday === 'number' && Number.isFinite(settings.sentToday) && settings.sentToday >= 0
    ? Math.floor(settings.sentToday)
    : 0;
  return {
    enabled: settings?.enabled === true,
    maxPerDay,
    quietHours: settings?.quietHours !== false,
    sentToday,
    day: settings?.day?.trim() || ''
  };
}

function normalizeTriggerRuleMode(mode: unknown): PolarisTriggerRuleMode {
  return mode === 'proactive-settings' || mode === 'proactive-plan' ? mode : 'manual';
}

export function createScheduledTriggerRule(input: CreateScheduledTriggerRuleInput): PolarisTriggerRule {
  const now = input.now ?? Date.now();
  const mode = input.mode ?? 'manual';
  const schedule = normalizeTriggerSchedule(input.schedule);
  return {
    id: createUid('trigger'),
    mode,
    ...(mode === 'proactive-settings'
      ? { proactiveSettings: normalizeProactiveContactSettings(input.proactiveSettings) }
      : {}),
    sourceMessageId: input.sourceMessageId?.trim() || undefined,
    name: input.name?.trim() || DEFAULT_TRIGGER_NAME,
    enabled: true,
    source: input.source ?? 'schedule',
    webhookSecret: createUid('trigger-secret'),
    schedule,
    target: normalizeTriggerTarget(input.target),
    action: normalizeTriggerAction(input.action),
    createdAt: now,
    updatedAt: now,
    lastRunAt: null,
    nextRunAt: mode === 'proactive-settings'
      ? null
      : input.nextRunAt === null
        ? null
        : typeof input.nextRunAt === 'number'
          ? input.nextRunAt
          : resolveNextTriggerRunAt(schedule, now),
    lastError: null
  };
}

export function normalizeTriggerRule(rule: PersistedTriggerRuleInput | null | undefined): PolarisTriggerRule | null {
  const mode = normalizeTriggerRuleMode(rule?.mode);
  const target = normalizeTriggerTarget(rule?.target);
  const action = normalizeTriggerAction(rule?.action);
  if (mode !== 'proactive-settings' && (!target.collaboratorId || !action.prompt)) return null;
  if (mode === 'proactive-settings' && !target.collaboratorId) return null;

  const now = Date.now();
  const schedule = normalizeTriggerSchedule(rule?.schedule);
  const createdAt = typeof rule?.createdAt === 'number' ? rule.createdAt : now;
  const nextRunAt = mode === 'proactive-settings'
    ? null
    : typeof rule?.nextRunAt === 'number'
      ? rule.nextRunAt
      : resolveNextTriggerRunAt(schedule, now);

  return {
    id: rule?.id?.trim() || createUid('trigger'),
    mode,
    ...(mode === 'proactive-settings'
      ? { proactiveSettings: normalizeProactiveContactSettings(rule?.proactiveSettings) }
      : {}),
    sourceMessageId: rule?.sourceMessageId?.trim() || undefined,
    name: rule?.name?.trim() || DEFAULT_TRIGGER_NAME,
    enabled: rule?.enabled !== false,
    source: normalizeTriggerSource(rule?.source),
    webhookSecret: normalizeWebhookSecret(rule?.webhookSecret),
    schedule,
    target,
    action,
    createdAt,
    updatedAt: typeof rule?.updatedAt === 'number' ? rule.updatedAt : createdAt,
    lastRunAt: typeof rule?.lastRunAt === 'number' ? rule.lastRunAt : null,
    nextRunAt,
    lastError: rule?.lastError?.trim() || null
  };
}

export function normalizeTriggerRules(rules?: PersistedTriggerRuleInput[] | null): PolarisTriggerRule[] {
  return (rules ?? [])
    .map((rule) => normalizeTriggerRule(rule))
    .filter((rule): rule is PolarisTriggerRule => Boolean(rule));
}

/**
 * 预排期通知的正文。
 *
 * 这类通知是在 AI 开口之前就交给系统的，拿不到真实回复，只能尽量把"这次是想干什么"讲清楚：
 * 优先用规则名（用户自己起的，如"晚安"），规则名还是默认值时退到提示语。
 * 真正带 AI 原话的是实时通知，见 native/localTriggerNotifications.ts。
 */
export function buildTriggerNotificationBody(rule: PolarisTriggerRule) {
  const name = rule.name.replace(/\s+/g, ' ').trim();
  if (!name || name === DEFAULT_TRIGGER_NAME) return TRIGGER_NOTIFICATION_FALLBACK_BODY;
  if (name.length <= TRIGGER_NOTIFICATION_BODY_MAX_LENGTH) return name;
  return `${name.slice(0, TRIGGER_NOTIFICATION_BODY_MAX_LENGTH - 1).trimEnd()}…`;
}

export function getDueTriggerRules(rules: PolarisTriggerRule[], now = Date.now()) {
  return rules
    .filter((rule) => rule.mode !== 'proactive-settings' && rule.enabled && rule.nextRunAt !== null && rule.nextRunAt <= now)
    .sort((left, right) => (left.nextRunAt ?? 0) - (right.nextRunAt ?? 0));
}

export function advanceTriggerRuleAfterRun(
  rule: PolarisTriggerRule,
  runAt = Date.now(),
  lastActivityAt?: number | null
): PolarisTriggerRule {
  // 空闲规则跑完一轮后，锚点至少要落在这次运行时间上；否则"用户最后一次发言比这次运行更早"
  // 会让 nextRunAt 直接落回过去，规则立刻再次到期，形成连环投递。
  const nextRunAt = rule.schedule.kind === 'idle'
    ? resolveIdleTriggerRunAt(rule.schedule.idleMinutes, Math.max(lastActivityAt ?? 0, runAt))
    : resolveNextTriggerRunAt(rule.schedule, runAt, lastActivityAt);
  return {
    ...rule,
    lastRunAt: runAt,
    nextRunAt,
    updatedAt: runAt,
    lastError: null
  };
}

/**
 * 空闲规则的"重新计时"：把 nextRunAt 拉回到 最后活跃时间 + 阈值。
 *
 * 这一步是空闲触发的核心——用户每说一句话，计时就整体后推，所以只要人还在，
 * 规则永远不会到期；只有真的安静够久，nextRunAt 才会落到现在之前。
 *
 * 锚点取 max(最后活跃, 上次运行)：进能跟住用户发言，退能避免刚发完就二次触发。
 */
export function resolveIdleRearmRunAt(
  rule: PolarisTriggerRule,
  lastActivityAt: number | null
): number | null {
  if (rule.schedule.kind !== 'idle') return null;
  const anchor = Math.max(lastActivityAt ?? 0, rule.lastRunAt ?? 0);
  return resolveIdleTriggerRunAt(rule.schedule.idleMinutes, anchor);
}

/**
 * 命中活跃保护、决定跳过本次投递时，规则该被排到什么时候。
 * 空闲规则跟着"最后活跃 + 阈值"走；其余规则按自身节奏排下一个自然周期。
 */
export function resolveActivitySkipRunAt(
  rule: PolarisTriggerRule,
  lastActivityAt: number | null,
  now = Date.now()
) {
  if (rule.schedule.kind === 'idle') {
    return resolveIdleRearmRunAt(rule, lastActivityAt) ?? now + DEFAULT_ACTIVE_GUARD_MINUTES * 60_000;
  }
  return resolveNextTriggerRunAt(rule.schedule, now, lastActivityAt);
}

export function markTriggerRuleError(rule: PolarisTriggerRule, error: string, now = Date.now()): PolarisTriggerRule {
  return {
    ...advanceTriggerRuleAfterRun(rule, now),
    lastError: error.trim() || '触发失败'
  };
}
