import { describe, expect, it } from 'vitest';
import {
  advanceTriggerRuleAfterRun,
  buildTriggerNotificationBody,
  createScheduledTriggerRule,
  DEFAULT_IDLE_MINUTES,
  getDueTriggerRules,
  MIN_IDLE_MINUTES,
  normalizeTriggerRules,
  normalizeTriggerSchedule,
  resolveActivitySkipRunAt,
  resolveIdleRearmRunAt,
  resolveLastUserActivityAt,
  resolveNextTriggerRunAt,
  shouldSkipTriggerForActivity,
  TRIGGER_NOTIFICATION_FALLBACK_BODY
} from './triggers';
import type { Conversation, PolarisTriggerRule } from '../types/domain';

describe('resolveNextTriggerRunAt', () => {
  it('schedules daily triggers for today when the time has not passed', () => {
    const from = new Date('2026-04-28T08:00:00').getTime();
    const next = resolveNextTriggerRunAt({ kind: 'daily', time: '09:30' }, from);

    expect(new Date(next).toISOString()).toBe(new Date('2026-04-28T09:30:00').toISOString());
  });

  it('schedules daily triggers for tomorrow when the time has passed', () => {
    const from = new Date('2026-04-28T22:00:00').getTime();
    const next = resolveNextTriggerRunAt({ kind: 'daily', time: '09:30' }, from);

    expect(new Date(next).toISOString()).toBe(new Date('2026-04-29T09:30:00').toISOString());
  });

  it('skips nonexistent daily wall-clock times during spring DST jumps', () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      const from = new Date(2026, 2, 8, 1, 30, 0, 0).getTime();
      const next = new Date(resolveNextTriggerRunAt({ kind: 'daily', time: '02:30' }, from));

      expect([
        next.getFullYear(),
        next.getMonth(),
        next.getDate(),
        next.getHours(),
        next.getMinutes()
      ]).toEqual([2026, 2, 9, 2, 30]);
    } finally {
      if (previousTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimezone;
      }
    }
  });

  it('schedules interval triggers from the current run time', () => {
    expect(resolveNextTriggerRunAt({ kind: 'interval', everyMinutes: 15 }, 1000)).toBe(901000);
  });
});

describe('trigger rules', () => {
  it('creates and advances a scheduled trigger rule', () => {
    const rule = createScheduledTriggerRule({
      now: 1000,
      name: '晚安',
      schedule: { kind: 'interval', everyMinutes: 30 },
      target: { collaboratorId: 'nova', conversationMode: 'follow-latest', conversationId: null },
      action: { prompt: '主动问候我' }
    });

    expect(rule.nextRunAt).toBe(1801000);
    expect(rule.enabled).toBe(true);
    expect(rule.webhookSecret).toMatch(/^trigger-secret-/);
    expect(advanceTriggerRuleAfterRun(rule, 2000)).toEqual(expect.objectContaining({
      lastRunAt: 2000,
      nextRunAt: 1802000
    }));
  });

  it('normalizes persisted rules and filters incomplete entries', () => {
    expect(normalizeTriggerRules([
      {
        target: { collaboratorId: 'pharos', conversationId: '' },
        action: { prompt: '提醒我喝水' },
        schedule: { kind: 'daily', time: '7:05' }
      },
      {
        target: { collaboratorId: '', conversationId: null },
        action: { prompt: 'missing target' }
      }
    ])).toEqual([
      expect.objectContaining({
        target: { collaboratorId: 'pharos', conversationMode: 'follow-latest', conversationId: null },
        action: { prompt: '提醒我喝水' },
        webhookSecret: expect.stringMatching(/^trigger-secret-/),
        schedule: { kind: 'daily', time: '07:05' }
      })
    ]);
  });

  it('returns due enabled rules in run order', () => {
    const due = getDueTriggerRules([
      createScheduledTriggerRule({
        now: 0,
        name: 'later',
        schedule: { kind: 'interval', everyMinutes: 3 },
        target: { collaboratorId: 'p', conversationMode: 'follow-latest', conversationId: null },
        action: { prompt: 'later' }
      }),
      createScheduledTriggerRule({
        now: 0,
        name: 'now',
        schedule: { kind: 'interval', everyMinutes: 1 },
        target: { collaboratorId: 'p', conversationMode: 'follow-latest', conversationId: null },
        action: { prompt: 'now' }
      })
    ], 120000);

    expect(due.map((rule) => rule.name)).toEqual(['now']);
  });
});

function buildIdleRule(overrides: Partial<PolarisTriggerRule> & { idleMinutes?: number } = {}) {
  const { idleMinutes = 6 * 60, ...rest } = overrides;
  return {
    ...createScheduledTriggerRule({
      now: 0,
      schedule: { kind: 'idle', idleMinutes },
      target: { collaboratorId: 'nova', conversationMode: 'follow-latest', conversationId: null },
      action: { prompt: '主动问候我' }
    }),
    ...rest
  };
}

function conversationWith(
  messages: Array<{ role: 'user' | 'assistant' | 'system'; origin?: string; timestamp: number }>
): Conversation {
  return { id: 'conversation-1', messages } as unknown as Conversation;
}

describe('idle schedule', () => {
  it('falls back to the default threshold when the persisted value is unusable', () => {
    expect(normalizeTriggerSchedule({ kind: 'idle' })).toEqual({
      kind: 'idle',
      idleMinutes: DEFAULT_IDLE_MINUTES
    });
    expect(normalizeTriggerSchedule({ kind: 'idle', idleMinutes: 5 })).toEqual({
      kind: 'idle',
      idleMinutes: DEFAULT_IDLE_MINUTES
    });
  });

  it('keeps a valid sub-hour threshold instead of snapping it to the default', () => {
    expect(normalizeTriggerSchedule({ kind: 'idle', idleMinutes: MIN_IDLE_MINUTES })).toEqual({
      kind: 'idle',
      idleMinutes: MIN_IDLE_MINUTES
    });
  });

  it('anchors the due time on the last activity so talking keeps pushing it out', () => {
    const lastActivityAt = new Date('2026-09-18T10:00:00').getTime();

    expect(resolveNextTriggerRunAt({ kind: 'idle', idleMinutes: 360 }, lastActivityAt, lastActivityAt))
      .toBe(new Date('2026-09-18T16:00:00').getTime());
  });

  it('starts the idle clock now when there is no activity record yet', () => {
    expect(resolveNextTriggerRunAt({ kind: 'idle', idleMinutes: 360 }, 1_000)).toBe(1_000 + 360 * 60_000);
  });

  it('reports an already-elapsed idle window as due', () => {
    const now = new Date('2026-09-18T20:00:00').getTime();
    const lastActivityAt = new Date('2026-09-18T09:00:00').getTime();
    const rule = buildIdleRule({
      idleMinutes: 360,
      nextRunAt: resolveNextTriggerRunAt({ kind: 'idle', idleMinutes: 360 }, now, lastActivityAt)
    });

    expect(getDueTriggerRules([rule], now).map((entry) => entry.id)).toEqual([rule.id]);
  });
});

describe('idle rearm', () => {
  it('does not immediately re-fire right after a run even if the user has been quiet', () => {
    const rule = buildIdleRule();
    const runAt = new Date('2026-09-18T20:00:00').getTime();
    const lastActivityAt = new Date('2026-09-18T09:00:00').getTime();

    const advanced = advanceTriggerRuleAfterRun(rule, runAt, lastActivityAt);

    expect(advanced.lastRunAt).toBe(runAt);
    expect(advanced.nextRunAt).toBe(runAt + 360 * 60_000);
  });

  it('pushes the due time forward as the user keeps talking', () => {
    const runAt = new Date('2026-09-18T20:00:00').getTime();
    const rule = buildIdleRule({ lastRunAt: runAt });
    const laterActivity = new Date('2026-09-18T21:30:00').getTime();

    expect(resolveIdleRearmRunAt(rule, laterActivity)).toBe(laterActivity + 360 * 60_000);
  });

  it('uses the last run as a floor so a stale activity record cannot re-fire the rule', () => {
    const runAt = new Date('2026-09-18T20:00:00').getTime();
    const rule = buildIdleRule({ lastRunAt: runAt });
    const staleActivity = new Date('2026-09-18T09:00:00').getTime();

    expect(resolveIdleRearmRunAt(rule, staleActivity)).toBe(runAt + 360 * 60_000);
  });

  it('leaves non-idle schedules alone', () => {
    const rule = createScheduledTriggerRule({
      now: 0,
      schedule: { kind: 'daily', time: '09:00' },
      target: { collaboratorId: 'nova', conversationMode: 'follow-latest', conversationId: null },
      action: { prompt: '早安' }
    });

    expect(resolveIdleRearmRunAt(rule, 1_000)).toBeNull();
  });

  it('schedules the next natural slot for non-idle rules when a run is skipped', () => {
    const rule = createScheduledTriggerRule({
      now: 0,
      schedule: { kind: 'interval', everyMinutes: 30 },
      target: { collaboratorId: 'nova', conversationMode: 'follow-latest', conversationId: null },
      action: { prompt: '你好' }
    });

    expect(resolveActivitySkipRunAt(rule, null, 1_000)).toBe(1_000 + 30 * 60_000);
  });
});

describe('active guard', () => {
  const now = new Date('2026-09-18T20:00:00').getTime();

  it('skips the run when the user spoke recently', () => {
    expect(shouldSkipTriggerForActivity({
      lastActivityAt: now - 10 * 60_000,
      now
    })).toBe(true);
  });

  it('allows the run once the user has been quiet past the guard window', () => {
    expect(shouldSkipTriggerForActivity({
      lastActivityAt: now - 90 * 60_000,
      now
    })).toBe(false);
  });

  it('never blocks when there is no activity record at all', () => {
    expect(shouldSkipTriggerForActivity({ lastActivityAt: null, now })).toBe(false);
  });

  it('honours a custom guard window', () => {
    expect(shouldSkipTriggerForActivity({
      lastActivityAt: now - 10 * 60_000,
      now,
      guardMinutes: 5
    })).toBe(false);
  });
});

describe('resolveLastUserActivityAt', () => {
  it('takes the newest user message and ignores assistant and trigger traffic', () => {
    const latest = resolveLastUserActivityAt([
      conversationWith([
        { role: 'user', origin: 'user-input', timestamp: 1_000 },
        { role: 'assistant', origin: 'assistant-reply', timestamp: 9_000 },
        { role: 'system', origin: 'trigger-runtime', timestamp: 9_500 }
      ])
    ]);

    expect(latest).toBe(1_000);
  });

  it('falls back to the role when an older message has no origin', () => {
    expect(resolveLastUserActivityAt([
      conversationWith([{ role: 'user', timestamp: 4_200 }])
    ])).toBe(4_200);
  });

  it('returns null when the user has never spoken', () => {
    expect(resolveLastUserActivityAt([
      conversationWith([{ role: 'assistant', origin: 'assistant-reply', timestamp: 1 }])
    ])).toBeNull();
  });
});

describe('buildTriggerNotificationBody', () => {
  it('uses a readable hint when the rule still carries the default name', () => {
    expect(buildTriggerNotificationBody(buildIdleRule())).toBe(TRIGGER_NOTIFICATION_FALLBACK_BODY);
  });

  it('shows the user-facing rule name when there is one', () => {
    expect(buildTriggerNotificationBody(buildIdleRule({ name: '晚安' }))).toBe('晚安');
  });
});
