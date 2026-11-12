import { describe, expect, it } from 'vitest';
import { resolvePredictedPeriods } from './calendarPeriods';

describe('resolvePredictedPeriods', () => {
  it('predicts six days after the last period start', () => {
    const predicted = resolvePredictedPeriods([
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04'
    ]);
    expect([...predicted.entries()]).toEqual([
      ['2026-08-27', false],
      ['2026-08-28', false],
      ['2026-08-29', false],
      ['2026-08-30', false],
      ['2026-08-31', false],
      ['2026-09-01', true]
    ]);
  });

  it('does not predict on recorded period days', () => {
    const predicted = resolvePredictedPeriods([
      '2026-08-01',
      '2026-08-27'
    ]);
    expect(predicted.has('2026-08-27')).toBe(false);
  });
});