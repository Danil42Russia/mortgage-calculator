import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetParamsFromHash, calculatorHash } from '../src/calculator-uri.ts';
import { calculateMortgage, calculateReservePayoff } from '../src/mortgage.ts';
import type { MortgageInput } from '../src/mortgage.ts';
import { decodePlan, encodePlan, scheduledLumps } from '../src/planned-payments.ts';
import { projectSalary } from '../src/salary.ts';

const loan: MortgageInput = { principal: 120_000, annualRate: 12, months: 12, paymentType: 'annuity' };
const extra = { goal: 'term', monthly: { startMonth: 1, amount: 1000 }, payoffReserve: 3000 } as const;
const plan = [
  { date: '2027-03', amount: 20_000, goal: 'payment' },
  { date: '2027-01', amount: 18_000, goal: 'term' },
  { date: '2027-03', amount: 5000, goal: 'term' },
] as const;
const start = { year: 2026, month: 12 };

test('a shared budget restores every payment, its goal, input order and unfinished rows', () => {
  const draft = [...plan, { date: '', amount: 7500, goal: 'term' } as const];
  const hash = calculatorHash('affordability', { payments: encodePlan(draft) }, { payments: '' });
  assert.deepEqual(decodePlan(budgetParamsFromHash(hash).get('payments')!), draft);
  assert.deepEqual(decodePlan(''), []);
  const malformed = '2026-14:20:term,2027-01:-5:term,2027-01:10:other,2027-02:100000000001:term';
  assert.deepEqual(decodePlan(malformed + ',' + encodePlan(plan)), plan);
});

test('payments keep their calendar dates when the start or term changes', () => {
  const entries = [...plan, { date: '2026-12', amount: 800, goal: 'term' } as const];
  assert.deepEqual(scheduledLumps(entries, start, 4).map(x => x.month), [4, 2, 4, 1]);
  assert.deepEqual(scheduledLumps(entries, { year: 2027, month: 1 }, 1), [{ month: 1, amount: 18_000, goal: 'term' }]);
  assert.deepEqual(scheduledLumps(entries, start, 1), [{ month: 1, amount: 800, goal: 'term' }]);
});

test('multiple dated contributions preserve earlier term reductions when a later contribution lowers the payment', () => {
  const lumps = scheduledLumps(plan, start, 12);
  const { schedule, lumpComparison, withoutMonthlyExtra } = calculateReservePayoff({ ...loan, prepayment: { ...extra, lumps } });
  assert.ok(lumpComparison);
  assert.equal(schedule.rows[1].fromLump, 18_000);
  assert.equal(schedule.rows[3].fromLump, 25_000);
  assert.equal(schedule.rows[3].scheduledPayment, 10_661.85);
  assert.equal(schedule.rows[4].scheduledPayment, 5894.06);
  assert.equal(schedule.rows.length, 9);
  assert.equal(schedule.rows[8].fromReserve, 734.7);
  assert.deepEqual(lumpComparison.withoutLump, calculateMortgage({ ...loan, prepayment: extra }));
  assert.deepEqual(withoutMonthlyExtra, calculateMortgage({ ...loan, prepayment: { ...extra, monthly: undefined, lumps } }));
  assert.equal(lumpComparison.term.rows.length, 7);
  assert.equal(lumpComparison.payment.rows.length, 11);
  assert.ok(lumpComparison.term.totalInterest < schedule.totalInterest);
  assert.ok(schedule.totalInterest < lumpComparison.payment.totalInterest);
  assert.ok(lumpComparison.payment.totalInterest < lumpComparison.withoutLump.totalInterest);
  const salary = projectSalary(50_000, 12, schedule.rows);
  assert.equal(salary[3].payment, 36_661.85);
  assert.equal(salary[8].payment, 6894.06);
});

test('same-month payments are capped after the regular and monthly payments, and later dates cost nothing', () => {
  const { schedule } = calculateReservePayoff({ ...loan, annualRate: 0, prepayment: {
    ...extra, lumps: [{ month: 1, amount: 100_000 }, { month: 1, amount: 50_000 }, { month: 2, amount: 10_000 }],
  } });
  assert.equal(schedule.rows.length, 1);
  assert.equal(schedule.rows[0].fromLump, 109_000);
  assert.equal(schedule.totalPaid, 120_000);
  assert.equal(schedule.rows[0].fromReserve, undefined);
  assert.equal(projectSalary(150_000, 2, schedule.rows)[1].payment, 0);
  const afterPayoff = calculateReservePayoff({ ...loan, prepayment: { ...extra, payoffReserve: 200_000, lumps: [{ month: 2, amount: 500 }] } });
  assert.equal(afterPayoff.lumpComparison, null);
});
