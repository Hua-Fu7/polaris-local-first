import type { ChatMessage } from '../../types/domain';

export type HomeTodayActivity = {
  me: number;
  ai: number;
};

function isSameLocalDay(timestamp: number, now: Date) {
  const date = new Date(timestamp);
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

/**
 * 今天这个对话里说了多少句。
 *
 * 只数真正的对话消息：工具回执（`toolInvocation`）不算一句。
 */
export function countTodayMessages(messages: ChatMessage[], now: Date = new Date()): HomeTodayActivity {
  let me = 0;
  let ai = 0;
  for (const message of messages) {
    if (message.toolInvocation) continue;
    if (!isSameLocalDay(message.timestamp, now)) continue;
    if (message.role === 'user' && message.origin !== 'trigger-runtime') me += 1;
    else if (message.role === 'assistant') ai += 1;
  }
  return { me, ai };
}

/** 首页「今日摘要」右上角：10 月 24 日 · 周六 */
export function formatTodayStamp(now: Date = new Date(), weekdayLabels?: string[]) {
  const weekdays = weekdayLabels ?? ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  return `${now.getMonth() + 1} 月 ${now.getDate()} 日 · ${weekdays[now.getDay()] ?? ''}`.trim();
}
