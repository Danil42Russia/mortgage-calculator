import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateMortgage, halfRepaidMonth, summarizeSchedule } from '../src/mortgage.ts';
import type { MortgageInput } from '../src/mortgage.ts';

const loan: MortgageInput = { principal: 1_200_000, annualRate: 12, months: 12, paymentType: 'annuity' };
const kopecks = (value: number) => Math.round(value * 100);

test('annuity uses the monthly rate and closes the balance in cents', () => {
  const result = calculateMortgage(loan);
  assert.equal(result.firstPayment, 106_618.55);
  assert.equal(result.rows[0].interest, 12_000);
  assert.equal(result.rows[0].scheduledPrincipal, 94_618.55);
  assert.equal(result.rows[0].balance, 1_105_381.45);
  assert.equal(result.rows.length, 12);
  assert.equal(result.rows[11].balance, 0);
  assert.equal(kopecks(result.totalPaid), kopecks(result.principal) + kopecks(result.totalInterest));
});

test('zero rate divides an annuity into equal payments', () => {
  const result = calculateMortgage({ ...loan, annualRate: 0 });
  assert.deepEqual(result.rows.map(row => row.scheduledPayment), Array(12).fill(100_000));
  assert.equal(result.totalInterest, 0);
});

test('declining payments reduce interest while scheduled principal stays constant', () => {
  const result = calculateMortgage({ ...loan, paymentType: 'declining' });
  assert.equal(result.firstPayment, 112_000);
  assert.equal(result.rows[11].scheduledPayment, 101_000);
  assert.equal(result.totalInterest, 78_000);
  assert.ok(result.rows.every(row => row.scheduledPrincipal === 100_000));
});

test('recurring prepayments start in the chosen month and shorten the term', () => {
  const result = calculateMortgage({
    ...loan, annualRate: 0,
    prepayment: { goal: 'term', monthly: { amount: 50_000, startMonth: 2 } },
  });
  assert.equal(result.rows[0].prepayment, 0);
  assert.equal(result.rows[1].prepayment, 50_000);
  assert.equal(result.rows[1].scheduledPayment, 100_000);
  assert.equal(result.rows.length, 9);
  assert.equal(result.totalPrepayment, 350_000);
  assert.equal(result.rows[8].balance, 0);
});

test('payment reduction applies from the month after the extra contribution', () => {
  for (const paymentType of ['annuity', 'declining'] as const) {
    const result = calculateMortgage({
      ...loan, paymentType, annualRate: 0,
      prepayment: { goal: 'payment', lump: { amount: 550_000, month: 1 } },
    });
    assert.equal(result.firstPayment, 100_000);
    assert.equal(result.rows[1].scheduledPayment, 50_000);
    assert.equal(result.rows.length, 12);
    assert.equal(result.rows[11].balance, 0);
  }
});

test('prepayments are capped to the outstanding principal even when combined', () => {
  const result = calculateMortgage({
    ...loan,
    prepayment: { goal: 'term', monthly: { amount: 1_000_000, startMonth: 1 }, lump: { amount: 1_000_000, month: 1 } },
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.totalPrepayment, 1_105_381.45);
  assert.equal(result.totalPaid, 1_212_000);
});

test('rate changes take effect in the specified month on the remaining balance', () => {
  const result = calculateMortgage({ ...loan, rateChange: { month: 5, annualRate: 6 } });
  assert.equal(result.rows[3].annualRate, 12);
  assert.equal(result.rows[4].annualRate, 6);
  assert.equal(result.rows[4].interest, Math.round(result.rows[3].balance * 0.005 * 100) / 100);
  assert.ok(result.rows[4].scheduledPayment < result.rows[3].scheduledPayment);
  assert.equal(result.rows.length, 12);
});

test('a rate change preserves the term saved by an earlier extra payment', () => {
  const input: MortgageInput = {
    ...loan, principal: 120_000, annualRate: 0,
    prepayment: { goal: 'term', lump: { amount: 40_000, month: 2 } },
  };
  const result = calculateMortgage({ ...input, rateChange: { month: 4, annualRate: 12 } });
  assert.equal(result.rows[2].balance, 50_000);
  assert.equal(result.rows[3].interest, 500);
  assert.equal(result.rows[3].scheduledPayment, 10_301.99);
  assert.equal(result.rows.length, 8);
});

test('insurance uses the opening balance in months 1, 13 and 25', () => {
  const result = calculateMortgage({ ...loan, months: 36, annualRate: 0, annualInsuranceRate: 1 });
  assert.deepEqual(result.rows.filter(row => row.insurance).map(row => row.month), [1, 13, 25]);
  assert.equal(result.rows[0].insurance, 12_000);
  assert.equal(result.rows[12].insurance, kopecks(result.rows[11].balance * 0.01) / 100);
  assert.equal(result.totalInsurance, 24_000);
  assert.equal(result.totalPaid, loan.principal);
});

test('cash purchase has no mortgage schedule or fees on the loan', () => {
  assert.deepEqual(calculateMortgage({ ...loan, principal: 0 }), {
    principal: 0, rows: [], firstPayment: 0, totalInterest: 0, totalPrepayment: 0, totalInsurance: 0, totalPaid: 0,
  });
});

test('the half-repayment marker follows the first payment that clears half of the original principal', () => {
  assert.equal(halfRepaidMonth(calculateMortgage({ ...loan, annualRate: 0 })), 6);
  assert.equal(halfRepaidMonth(calculateMortgage(loan)), 7);
  assert.equal(halfRepaidMonth(calculateMortgage({ ...loan, principal: 0 })), undefined);
  const prepaid = calculateMortgage({ ...loan, prepayment: { goal: 'term', lump: { month: 2, amount: 700_000 } } });
  assert.equal(halfRepaidMonth(prepaid), 2);
});

test('annual payment bars include early principal repayments and show only paid months of the last year', () => {
  const result = calculateMortgage({
    principal: 240_000, annualRate: 0, months: 24, paymentType: 'annuity', annualInsuranceRate: 1,
    prepayment: { goal: 'term', lump: { month: 12, amount: 100_000 } },
  });
  const years = summarizeSchedule(result.rows, 'year');
  assert.equal(result.rows.length, 14);
  assert.deepEqual(years.map(({ principal, interest, payment }) => [principal, interest, payment]),
    [[220_000, 0, 220_000], [20_000, 0, 20_000]]);
});

test('invalid inputs fail explicitly', () => {
  for (const problem of [{ annualRate: -1 }, { principal: NaN }, { months: 12.5 }, { months: 0 }]) {
    assert.throws(() => calculateMortgage({ ...loan, ...problem }), RangeError);
  }
  assert.throws(() => calculateMortgage({ ...loan, rateChange: { month: 1, annualRate: 2 } }), RangeError);
});

test('monthly and yearly schedules reconcile with cent-level totals', () => {
  for (const paymentType of ['annuity', 'declining'] as const) {
    for (const goal of ['term', 'payment'] as const) {
      for (const annualRate of [0, 0.05, 6.5, 18, 40]) {
        const result = calculateMortgage({
          principal: 5_321_987.65, annualRate, months: 300, paymentType,
          annualInsuranceRate: 0.9, rateChange: { month: 123, annualRate: 11 },
          prepayment: { goal, monthly: { startMonth: 20, amount: 8111.05 }, lump: { month: 80, amount: 260_000 } },
        });
        let balance = kopecks(result.principal);
        result.rows.forEach(row => {
          assert.equal(kopecks(row.scheduledPayment), kopecks(row.interest) + kopecks(row.scheduledPrincipal));
          balance -= kopecks(row.scheduledPrincipal) + kopecks(row.prepayment);
          assert.equal(kopecks(row.balance), balance);
          assert.ok(balance >= 0);
        });
        assert.equal(balance, 0);
        assert.ok(result.rows.length <= 300);
        for (const grouping of ['month', 'year'] as const) {
          const schedule = summarizeSchedule(result.rows, grouping);
          assert.equal(schedule.reduce((sum, row) => sum + kopecks(row.payment), 0), kopecks(result.totalPaid));
          assert.equal(schedule.reduce((sum, row) => sum + kopecks(row.principal), 0), kopecks(result.principal));
          assert.equal(schedule.reduce((sum, row) => sum + kopecks(row.interest), 0), kopecks(result.totalInterest));
          assert.equal(schedule.reduce((sum, row) => sum + kopecks(row.prepayment), 0), kopecks(result.totalPrepayment));
          assert.equal(schedule.reduce((sum, row) => sum + kopecks(row.insurance), 0), kopecks(result.totalInsurance));
        }
      }
    }
  }
});
