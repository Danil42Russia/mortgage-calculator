import assert from 'node:assert/strict';
import test from 'node:test';
import { budgetParamsFromHash, calculatorHash, parseCalculatorHash, readChoiceParam, readNumberParam, restoreStartMonth } from '../src/calculator-uri.ts';
import { DEFAULT_SCENARIO } from '../src/scenario.ts';

test('a forward calculation preserves its route and edited options', () => {
  const state = {
    ...DEFAULT_SCENARIO, program: 'custom', price: 6_900_000, rate: 12.75, change: true, changeRate: 0,
  };
  const fragment = calculatorHash('schedule', state, DEFAULT_SCENARIO);
  const parsed = parseCalculatorHash(fragment);
  assert.equal(parsed.route, 'schedule');
  assert.equal(parsed.params.get('program'), 'custom');
  assert.equal(parsed.params.get('price'), '6900000');
  assert.equal(parsed.params.get('rate'), '12.75');
  assert.equal(parsed.params.get('change'), 'true');
  assert.equal(parsed.params.get('changeRate'), '0');
  assert.equal(parsed.params.has('years'), false);
});

test('an unknown savings amount and zero savings produce different links', () => {
  const defaults: { salary: number | null; savings: number | null; salaryMode: string } = {
    salary: null, savings: null, salaryMode: 'gross',
  };
  const state: typeof defaults = { salary: 250_000, savings: 0, salaryMode: 'net' };
  const url = new URL('https://example.test/project/' + calculatorHash('affordability', state, defaults));
  const { route, params } = parseCalculatorHash(url.hash);
  assert.equal(url.search, '');
  assert.equal(route, 'affordability');
  assert.equal(params.get('salary'), '250000');
  assert.equal(params.get('savings'), '0');
  assert.equal(params.get('salaryMode'), 'net');
  const unknownSavings = parseCalculatorHash(calculatorHash<typeof defaults>('affordability', { ...state, savings: null }, defaults));
  assert.equal(unknownSavings.params.has('savings'), false);
});

test('bare links and defaults keep normal calculator routes', () => {
  assert.equal(calculatorHash('calculator', DEFAULT_SCENARIO, DEFAULT_SCENARIO), '#calculator');
  assert.equal(parseCalculatorHash('').route, 'calculator');
  assert.equal(parseCalculatorHash('#unknown').route, 'calculator');
  assert.equal(parseCalculatorHash('#affordability').route, 'affordability');
});

test('the budget screen restores shared budget links and opens defaults for legacy links', () => {
  const params = 'salary=350000&savings=0&years=15&useReserve=true';
  assert.equal(budgetParamsFromHash('#affordability?' + params).toString(), params);
  for (const hash of ['', '#affordability', '#calculator?price=8000000&years=30', '#schedule?years=30', '#unknown?years=30']) {
    assert.equal(budgetParamsFromHash(hash).size, 0);
  }
});

test('shared numbers follow the same bounds and precision as the form', () => {
  const params = new URLSearchParams('salary=-500&price=999999999&annualRate=18%2C235&years=4.2&bad=Infinity&blank=');
  assert.equal(readNumberParam(params, 'salary', 0, 1_000_000_000), 0);
  assert.equal(readNumberParam(params, 'price', 500_000, 40_000_000), 40_000_000);
  assert.equal(readNumberParam(params, 'annualRate', 0, 40, true), 18.24);
  for (const key of ['years', 'bad', 'blank', 'missing']) {
    assert.equal(readNumberParam(params, key, 1, 40), undefined);
  }
  assert.equal(readChoiceParam(new URLSearchParams('program=invalid'), 'program', ['market', 'custom']), undefined);
});

test('fresh budgets start this month while shared budgets retain their original calendar', () => {
  const today = new Date(2027, 1, 1);
  assert.equal(restoreStartMonth(new URLSearchParams(), today), '2027-02');
  assert.equal(restoreStartMonth(new URLSearchParams('salary=350000'), today), '2026-01');
  assert.equal(restoreStartMonth(new URLSearchParams('startMonth=2028-12'), today), '2028-12');
  for (const invalid of ['2028-13', '2028-00', '2026-6', '2026-12-01', '']) {
    assert.equal(restoreStartMonth(new URLSearchParams({ startMonth: invalid }), today), '2026-01');
  }
});
