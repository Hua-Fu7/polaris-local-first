import { describe, expect, it } from 'vitest';
import {
  isQuietHour,
  moveOutOfQuietHours,
  parseProactivePlanOutput,
  resolveTodayProactiveSentCount
} from './proactiveContact';
import { normalizeTriggerRule } from './triggers';

describe('proactiveContact', () => {
  it('parses and clamps proactive plan output', () => {
    expect(parseProactivePlanOutput('{"delayMinutes":1,"hint":"还记得刚才那个吗"}')).toEqual({
      delayMinutes: 10,
      hint: '还记得刚才那个吗'
    });
    expect(parseProactivePlanOutput('```json\n{"delayMinutes":9999,"hint":"晚点继续"}\n```')).toEqual({
      delayMinutes: 720,
      hint: '晚点继续'
    });
    expect(parseProactivePlanOutput('null')).toBeNull();
    expect(parseProactivePlanOutput('不是 JSON')).toBeNull();
  });

  it('moves quiet-hour plans to the first quiet-hour boundary', () => {
    const twoAm = new Date(2026, 9, 8, 2, 0, 0, 0).getTime();
    const moved = moveOutOfQuietHours(twoAm, {
      enabled: true,
      maxPerDay: 6,
      quietHours: true,
      sentToday: 0,
      day: '2026-10-08'
    });
    expect(isQuietHour(twoAm, {
      enabled: true,
      maxPerDay: 6,
      quietHours: true,
      sentToday: 0,
      day: '2026-10-08'
    })).toBe(true);
    expect(new Date(moved).getHours()).toBe(8);
    expect(moved).toBeGreaterThan(twoAm);
  });

  it('resets the visible daily count when the stored day is old', () => {
    expect(resolveTodayProactiveSentCount({
      enabled: true,
      maxPerDay: 6,
      quietHours: true,
      sentToday: 4,
      day: '2026-10-07'
    }, new Date(2026, 9, 8, 12, 0, 0, 0).getTime())).toBe(0);
  });

  it('normalizes proactive settings rules without requiring a prompt', () => {
    const rule = normalizeTriggerRule({
      id: 'settings-1',
      mode: 'proactive-settings',
      name: '主动联系',
      schedule: { kind: 'interval', everyMinutes: 1440 },
      target: { collaboratorId: 'rune', conversationMode: 'follow-latest', conversationId: null },
      action: { prompt: '' },
      proactiveSettings: {
        enabled: true,
        maxPerDay: 3,
        quietHours: false,
        sentToday: 2,
        day: '2026-10-08'
      }
    });

    expect(rule).toMatchObject({
      mode: 'proactive-settings',
      nextRunAt: null,
      proactiveSettings: {
        enabled: true,
        maxPerDay: 3,
        quietHours: false,
        sentToday: 2,
        day: '2026-10-08'
      }
    });
  });
});