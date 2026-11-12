import type { ChatMessage } from '../../types/domain';

/**
 * 聊天热力图数据层：把消息按本地日期归到「你 / 协作者」两栏。
 * 纯函数、不碰 store、不改消息，方便单测。
 */
export type ChatHeatmapWho = 'me' | 'ai';

export type ChatHeatmapDay = {
  me: number;
  ai: number;
};

export type ChatHeatmapDays = Record<string, ChatHeatmapDay>;

export type ChatHeatmapStats = {
  activeDays: number;
  currentStreak: number;
  longestStreak: number;
  total: number;
  totalMe: number;
  totalAi: number;
  busiestDate: string | null;
  busiestTotal: number;
};

const pad = (value: number) => String(value).padStart(2, '0');

export function chatHeatmapDayKey(value: number | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function chatHeatmapDayDate(key: string) {
  const [year, month, day] = key.split('-').map((part) => Number(part));
  return new Date(
    Number.isFinite(year) ? year : 1970,
    Number.isFinite(month) ? month - 1 : 0,
    Number.isFinite(day) ? day : 1
  );
}

export function chatHeatmapAddDays(date: Date, amount: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

export function chatHeatmapDayTotal(day: ChatHeatmapDay | undefined) {
  return (day?.me ?? 0) + (day?.ai ?? 0);
}

/** 工具运行时 / 系统提示不算「说话」，空正文也不算。 */
export function chatHeatmapClassifyMessage(message: ChatMessage): ChatHeatmapWho | null {
  if (!message.content?.trim()) return null;
  if (message.role === 'assistant') return 'ai';
  if (message.role !== 'user') return null;
  if (message.origin === 'tool-runtime' || message.origin === 'system-note') return null;
  return 'me';
}

export function accumulateChatHeatmapDays(days: ChatHeatmapDays, messages: ChatMessage[]) {
  for (const message of messages) {
    const who = chatHeatmapClassifyMessage(message);
    if (!who) continue;
    const key = chatHeatmapDayKey(message.timestamp);
    const day = days[key] ?? (days[key] = { me: 0, ai: 0 });
    day[who] += 1;
  }
  return days;
}

export function mergeChatHeatmapDays(target: ChatHeatmapDays, source: ChatHeatmapDays) {
  for (const key of Object.keys(source)) {
    const from = source[key];
    if (!from) continue;
    const into = target[key] ?? (target[key] = { me: 0, ai: 0 });
    into.me += from.me;
    into.ai += from.ai;
  }
  return target;
}

export function cloneChatHeatmapDays(days: ChatHeatmapDays): ChatHeatmapDays {
  const next: ChatHeatmapDays = {};
  for (const key of Object.keys(days)) {
    const day = days[key];
    if (!day) continue;
    next[key] = { me: day.me, ai: day.ai };
  }
  return next;
}

export function resolveChatHeatmapStats(days: ChatHeatmapDays, now: Date = new Date()): ChatHeatmapStats {
  const activeKeys = Object.keys(days)
    .filter((key) => chatHeatmapDayTotal(days[key]) > 0)
    .sort();

  let totalMe = 0;
  let totalAi = 0;
  let busiestDate: string | null = null;
  let busiestTotal = 0;
  for (const key of activeKeys) {
    const day = days[key]!;
    totalMe += day.me;
    totalAi += day.ai;
    const total = day.me + day.ai;
    if (total > busiestTotal) {
      busiestTotal = total;
      busiestDate = key;
    }
  }

  let longestStreak = 0;
  let run = 0;
  let previous: number | null = null;
  for (const key of activeKeys) {
    const stamp = chatHeatmapDayDate(key).getTime();
    run = previous !== null && Math.round((stamp - previous) / 86_400_000) === 1 ? run + 1 : 1;
    previous = stamp;
    if (run > longestStreak) longestStreak = run;
  }

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let cursor = chatHeatmapDayTotal(days[chatHeatmapDayKey(today)]) > 0
    ? today
    : chatHeatmapAddDays(today, -1);
  let currentStreak = 0;
  while (chatHeatmapDayTotal(days[chatHeatmapDayKey(cursor)]) > 0) {
    currentStreak += 1;
    cursor = chatHeatmapAddDays(cursor, -1);
  }

  return {
    activeDays: activeKeys.length,
    currentStreak,
    longestStreak,
    total: totalMe + totalAi,
    totalMe,
    totalAi,
    busiestDate,
    busiestTotal
  };
}
