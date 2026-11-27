import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPaymentMonth, formatTerm, numberFromInput } from '../src/format.ts';
import { DEFAULT_SCENARIO, evaluateScenario, familyTerms } from '../src/scenario.ts';
import { scheduleCsv } from '../src/schedule-table.ts';

test('the initial example uses the dated market benchmark', () => {
  const result = evaluateScenario(DEFAULT_SCENARIO);
  assert.equal(result.kind, 'calculated');
  assert.equal(result.input.principal, 5_950_000);
  assert.equal(result.input.annualRate, 18);
  assert.equal(result.result.rows.length, 240);
});

test('family program uses the October 2026 rate and limit matrix', () => {
  const regions = [
    ['other', [10, 8, 6, 4, 2], [6, 8, 10, 10, 10]],
    ['capital', [12, 10, 8, 6, 4], [12, 15, 18, 18, 18]],
  ] as const;
  for (const [region, rates, limits] of regions) {
    for (let index = 0; index < 5; index += 1) {
      assert.deepEqual(familyTerms(region, index + 1), {
        rate: rates[index], limit: limits[index] * 1_000_000, maxSubsidizedMonths: 180,
      });
    }
    assert.deepEqual(familyTerms(region, 7), familyTerms(region, 5));
  }
});

test('family preset withholds a payment quote above the loan limit', () => {
  const result = evaluateScenario({ ...DEFAULT_SCENARIO, program: 'family', down: 2_000_000 });
  assert.deepEqual(result, { kind: 'over-limit', principal: 6_500_000, limit: 6_000_000, annualRate: 10 });
});

test('family rate changes from month 181 and the estimate respects the four-point cap', () => {
  const scenario = { ...DEFAULT_SCENARIO, program: 'family', children: 2, familyRate: 25 } as const;
  const fifteenYears = evaluateScenario({ ...scenario, years: 15 });
  assert.equal(fifteenYears.kind, 'calculated');
  assert.equal(fifteenYears.input.rateChange, undefined);
  const longer = evaluateScenario(scenario);
  assert.equal(longer.kind, 'calculated');
  assert.equal(longer.result.rows[179].annualRate, 8);
  assert.equal(longer.rateChangeRow?.month, 181);
  assert.equal(longer.rateChangeRow?.annualRate, 12);
  const estimate = evaluateScenario({ ...scenario, familyRate: 10 });
  assert.equal(estimate.kind, 'calculated');
  assert.equal(estimate.rateChangeRow?.annualRate, 10);
});

test('purchase costs and debt share are independent of the scheduled mortgage payment', () => {
  const scenario = { ...DEFAULT_SCENARIO, insurance: 1, fees: 25_000, income: 180_000, debts: 12_000, extra: 20_000 };
  const result = evaluateScenario(scenario);
  assert.equal(result.kind, 'calculated');
  assert.equal(result.purchaseCost, scenario.down + result.result.totalPaid + result.result.totalInsurance + scenario.fees);
  assert.equal(result.incomeShare, (result.result.firstPayment + 12_000) / 180_000);
  assert.ok(result.baseline);
  assert.ok(result.baseline.totalInterest > result.result.totalInterest);
});

test('out-of-term optional transactions do not introduce a false baseline or rate change', () => {
  const result = evaluateScenario({ ...DEFAULT_SCENARIO, years: 1, extra: 10_000, extraStart: 13, change: true, changeMonth: 13 });
  assert.equal(result.kind, 'calculated');
  assert.equal(result.baseline, null);
  assert.equal(result.input.rateChange, undefined);
});

test('Russian decimal and monetary inputs accept common separators', () => {
  assert.equal(numberFromInput('2\u00a0550\u202f000', false), 2_550_000);
  assert.equal(numberFromInput('17,35', true), 17.35);
  assert.equal(numberFromInput('17.35', true), 17.35);
  assert.ok(Number.isNaN(numberFromInput('17,35', false)));
  assert.ok(Number.isNaN(numberFromInput('', true)));
});

test('payoff dates count from January 2026 and durations spell out Russian years and months', () => {
  assert.match(formatPaymentMonth(1), /январь 2026/);
  assert.match(formatPaymentMonth(12), /декабрь 2026/);
  assert.match(formatPaymentMonth(13), /январь 2027/);
  assert.match(formatPaymentMonth(227), /ноябрь 2044/);
  assert.equal(formatTerm(227, 'long'), '18 лет 11 месяцев');
  assert.equal(formatTerm(13, 'long'), '1 год 1 месяц');
  assert.equal(formatTerm(26, 'long'), '2 года 2 месяца');
  assert.equal(formatTerm(12, 'long'), '1 год');
  assert.equal(formatTerm(0, 'long'), '0 месяцев');
});

test('CSV includes every period, a UTF-8 marker and decimal commas', () => {
  const result = evaluateScenario({ ...DEFAULT_SCENARIO, years: 2 });
  assert.equal(result.kind, 'calculated');
  const csv = scheduleCsv(result.result.rows, 'month');
  assert.equal(csv.charCodeAt(0), 0xfeff);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines.length, 25);
  assert.match(lines[1], /^1;\d+,\d{2};\d+,\d{2};/u);
  assert.match(lines.at(-1) ?? '', /^24;.*;0,00$/u);
  assert.equal(scheduleCsv(result.result.rows, 'year').trimEnd().split('\r\n').length, 3);
});

test('a December start dates each payment and splits the CSV at calendar year boundaries', () => {
  const result = evaluateScenario({ ...DEFAULT_SCENARIO, program: 'custom', rate: 0, years: 1 });
  assert.equal(result.kind, 'calculated');
  const start = { year: 2027, month: 12 };
  assert.match(formatPaymentMonth(3, start), /февраль 2028/);
  const months = scheduleCsv(result.result.rows, 'month', start).trimEnd().split('\r\n');
  assert.match(months[1], /^1;декабрь 2027/u);
  assert.match(months[2], /^2;январь 2028/u);
  assert.match(months[12], /^12;ноябрь 2028/u);
  const years = scheduleCsv(result.result.rows, 'year', start).trimEnd().split('\r\n');
  assert.equal(years.length, 3);
  assert.equal(years[1], ['2027', ...months[1].split(';').slice(2)].join(';'));
  assert.match(years[2], /^2028;.*;0,00$/u);
});
