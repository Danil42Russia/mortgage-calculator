import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateSalary2026 } from '../src/salary.ts';

test('a salary at the first annual threshold is taxed at thirteen percent throughout the year', () => {
  const result = estimateSalary2026(200_000);
  assert.equal(result.months.length, 12);
  assert.ok(result.months.every(month => month.tax === 26_000 && month.net === 174_000));
  assert.equal(result.annualTax, 312_000);
  assert.equal(result.averageNet, 174_000);
});

test('withholding changes in the month when cumulative wages reach the next bracket', () => {
  const result = estimateSalary2026(300_000);
  assert.deepEqual(result.months.map(month => month.tax), [...Array(8).fill(39_000), ...Array(4).fill(45_000)]);
  assert.equal(result.annualGross, 3_600_000);
  assert.equal(result.annualTax, 492_000);
  assert.equal(result.annualNet, 3_108_000);
  assert.equal(result.averageNet, 259_000);
});

test('only the excess is subject to the higher rate in a mixed-rate month', () => {
  const result = estimateSalary2026(330_000);
  assert.equal(result.months[6].tax, 42_900);
  assert.equal(result.months[7].tax, 47_700);
  assert.equal(result.months[8].tax, 49_500);
  assert.equal(result.annualTax, 546_000);
});

test('reconciles withholding across all five brackets', () => {
  const result = estimateSalary2026(5_000_000);
  assert.equal(result.months[0].tax, 702_000);
  assert.equal(result.months[1].tax, 900_000);
  assert.equal(result.months[4].tax, 1_000_000);
  assert.equal(result.months[11].tax, 1_100_000);
  assert.equal(result.annualTax, 11_602_000);
  assert.equal(result.months.reduce((sum, month) => sum + month.tax, 0), result.annualTax);
  assert.equal(result.months.reduce((sum, month) => sum + month.net, 0), result.annualNet);
});

test('rounds cumulative tax before subtracting previous withholding', () => {
  const result = estimateSalary2026(50);
  assert.equal(result.months[0].tax, 7);
  assert.equal(result.months[1].tax, 6);
  assert.equal(result.annualTax, 78);
  assert.equal(result.averageNet, 43.5);
});

test('handles zero salary and rejects invalid monthly amounts', () => {
  assert.equal(estimateSalary2026(0).annualTax, 0);
  for (const amount of [-1, 100.5, NaN, Infinity]) {
    assert.throws(() => estimateSalary2026(amount), RangeError);
  }
});
