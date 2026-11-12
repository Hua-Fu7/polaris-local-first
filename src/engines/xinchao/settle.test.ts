import { describe, expect, it } from 'vitest';
import { DIMENSIONS, DRIVE_KEYS, resolveDriveCeil } from './dimensions';
import { newState, settleState } from './engine';

function settleHours(hours: number, mutate?: (state: ReturnType<typeof newState>) => void) {
  const start = new Date('2026-10-28T02:00:00.000Z'); // 上海 10:00，避开黎明冻结与夜间
  const state = newState(start) as Record<string, any>;
  if (mutate) mutate(state as ReturnType<typeof newState>);
  const later = new Date(start.getTime() + hours * 3_600_000);
  return settleState(state, later, 240).state as Record<string, any>;
}

describe('xinchao settle', () => {
  it('每维有自己的天花板，不会一起停在 0.80', () => {
    const ceilings = DRIVE_KEYS.map((key) => resolveDriveCeil(key));
    expect(new Set(ceilings).size).toBeGreaterThan(5);
    expect(ceilings).toContain(0.82);
    expect(ceilings).toContain(0.42);
    // 生长期的天花板都在 0.8 以下（0.82 是唯一例外，上游就是这样）
    expect(ceilings.filter((value) => value > 0.8)).toEqual([0.82]);
  });

  it('长期没人说话，各维停在自己的天花板而不是同一个值', () => {
    const state = settleHours(24 * 7);
    const values = DRIVE_KEYS.map((key) => Number(state.drives[key]));

    // 都涨到了各自的上限
    DRIVE_KEYS.forEach((key) => {
      const ceil = resolveDriveCeil(key);
      const dim = (DIMENSIONS as Record<string, { decayHalfLifeHours?: number }>)[key];
      if (dim.decayHalfLifeHours) return; // 情绪型是往下落的，单独测
      expect(Number(state.drives[key])).toBeCloseTo(ceil, 2);
    });

    // 至少有几档不同的高度，页面才看得出差别
    expect(new Set(values.map((value) => value.toFixed(2))).size).toBeGreaterThan(3);
  });

  it('被事件顶到天花板之上后会慢慢松回来', () => {
    const state = settleHours(3, (draft) => {
      draft.drives.duty = 0.75; // 远高于 duty 的 0.45
    });
    expect(Number(state.drives.duty)).toBeLessThan(0.75);
    expect(Number(state.drives.duty)).toBeGreaterThanOrEqual(0.45);
  });

  it('难过按半衰期往下落（10 小时减半）', () => {
    const state = settleHours(10, (draft) => {
      draft.drives.grieve = 0.6;
    });
    expect(Number(state.drives.grieve)).toBeCloseTo(0.3, 2);
  });

  it('生气比难过消得快（半衰期 6 小时）', () => {
    const state = settleHours(6, (draft) => {
      draft.drives.anger = 0.6;
    });
    expect(Number(state.drives.anger)).toBeCloseTo(0.3, 2);
  });

  it('刚建的存档不会一上来就贴着天花板', () => {
    const state = newState(new Date('2026-10-28T02:00:00.000Z')) as Record<string, any>;
    DRIVE_KEYS.forEach((key) => {
      expect(Number(state.drives[key])).toBeLessThan(0.2);
    });
  });
});
