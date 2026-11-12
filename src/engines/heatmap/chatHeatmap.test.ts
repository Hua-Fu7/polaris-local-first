import { describe, expect, it } from 'vitest';
import type { ChatMessage } from '../../types/domain';
import {
  accumulateChatHeatmapDays,
  chatHeatmapClassifyMessage,
  chatHeatmapDayKey,
  resolveChatHeatmapStats
} from './chatHeatmap';

function at(year: number, monthIndex: number, day: number, hour = 12) {
  return new Date(year, monthIndex, day, hour, 0, 0, 0).getTime();
}

function message(patch: Partial<ChatMessage> & { timestamp: number }): ChatMessage {
  return {
    id: `m-${patch.timestamp}-${patch.role ?? 'user'}-${patch.content ?? ''}`,
    role: 'user',
    content: '在吗',
    ...patch
  } as ChatMessage;
}

describe('chatHeatmapClassifyMessage', () => {
  it('把用户消息算成你、协作者消息算成 TA', () => {
    expect(chatHeatmapClassifyMessage(message({ timestamp: 1, role: 'user' }))).toBe('me');
    expect(chatHeatmapClassifyMessage(message({ timestamp: 2, role: 'assistant', content: '在' }))).toBe('ai');
  });

  it('跳过空正文、系统消息和工具运行时', () => {
    expect(chatHeatmapClassifyMessage(message({ timestamp: 3, content: '   ' }))).toBeNull();
    expect(chatHeatmapClassifyMessage(message({ timestamp: 4, role: 'system' }))).toBeNull();
    expect(chatHeatmapClassifyMessage(message({ timestamp: 5, origin: 'tool-runtime' }))).toBeNull();
    expect(chatHeatmapClassifyMessage(message({ timestamp: 6, origin: 'system-note' }))).toBeNull();
  });
});

describe('accumulateChatHeatmapDays', () => {
  it('按本地日期分桶，并分开数你和 TA', () => {
    const days = accumulateChatHeatmapDays({}, [
      message({ timestamp: at(2026, 9, 12, 9), role: 'user' }),
      message({ timestamp: at(2026, 9, 12, 10), role: 'user' }),
      message({ timestamp: at(2026, 9, 12, 11), role: 'assistant', content: '嗯' }),
      message({ timestamp: at(2026, 9, 13, 1), role: 'assistant', content: '早' })
    ]);

    expect(chatHeatmapDayKey(at(2026, 9, 12))).toBe('2026-10-12');
    expect(days['2026-10-12']).toEqual({ me: 2, ai: 1 });
    expect(days['2026-10-13']).toEqual({ me: 0, ai: 1 });
  });
});

describe('resolveChatHeatmapStats', () => {
  it('统计活跃天数、当前连续、最长连续和总数', () => {
    const days = accumulateChatHeatmapDays({}, [
      message({ timestamp: at(2026, 9, 1) }),
      message({ timestamp: at(2026, 9, 2) }),
      message({ timestamp: at(2026, 9, 3) }),
      message({ timestamp: at(2026, 9, 10) }),
      message({ timestamp: at(2026, 9, 12), role: 'assistant', content: '在' }),
      message({ timestamp: at(2026, 9, 13), role: 'assistant', content: '在' })
    ]);

    const stats = resolveChatHeatmapStats(days, new Date(2026, 9, 13, 20));

    expect(stats.activeDays).toBe(6);
    expect(stats.currentStreak).toBe(2);
    expect(stats.longestStreak).toBe(3);
    expect(stats.totalMe).toBe(4);
    expect(stats.totalAi).toBe(2);
    expect(stats.total).toBe(6);
    expect(stats.busiestDate).toBe('2026-10-01');
    expect(stats.busiestTotal).toBe(1);
  });
});