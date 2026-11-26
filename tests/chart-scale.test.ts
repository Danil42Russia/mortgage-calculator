import assert from 'node:assert/strict';
import test from 'node:test';
import { valueAxis } from '../src/chart-scale.ts';
import { calculateMortgage, summarizeSchedule } from '../src/mortgage.ts';

test('annual chart rounds its top tick above actual yearly payments and expands after a prepayment', () => {
  const loan = { principal: 4_800_000, annualRate: 0, months: 24, paymentType: 'annuity' } as const;
  for (const extra of [0, 1_200_000]) {
    const result = calculateMortgage({ ...loan, prepayment: { goal: 'term', lump: { month: 1, amount: extra } } });
    const annual = summarizeSchedule(result.rows, 'year').map(year => year.payment);
    const { step, lastTick } = valueAxis(annual);
    assert.equal(Math.max(...annual), 2_400_000 + extra);
    assert.equal(lastTick * step, extra ? 4_000_000 : 3_000_000);
    assert.equal(annual.reduce((sum, payment) => sum + payment, 0), result.totalPaid);
  }
});
