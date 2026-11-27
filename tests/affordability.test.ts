import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAffordability } from '../src/affordability.ts';
import type { AffordabilityInput } from '../src/affordability.ts';
import { calculateMortgage } from '../src/mortgage.ts';

const base: AffordabilityInput = {
  monthlyIncome: 100_000,
  livingCosts: 10_000,
  monthlyDebts: 0,
  monthlyRemainder: 0,
  savings: null,
  annualRate: 0,
  months: 12,
  minimumDownPercent: 25,
  maxDebtSharePercent: 30,
  reserveMonths: 6,
};

test('without a savings figure, reports the loan by income and cash required upfront', () => {
  const result = calculateAffordability(base);
  assert.equal(result.paymentBudget, 30_000);
  assert.equal(result.limitingFactor, 'income');
  assert.equal(result.additionalSavingsForIncomeQuote, null);
  assert.deepEqual(result.quote, {
    principal: 360_000,
    payment: 30_000,
    downPayment: 120_000,
    price: 480_000,
    reserve: 180_000,
    requiredSavings: 300_000,
    remainingIncome: 60_000,
    debtSharePercent: 30,
  });
});

test('counts only the mortgage payment in the emergency reserve', () => {
  const result = calculateAffordability({
    ...base, livingCosts: 25_000, monthlyDebts: 5_000, reserveMonths: 3,
  });
  assert.ok(result.quote);
  assert.equal(result.quote.payment, 25_000);
  assert.equal(result.quote.reserve, 75_000);
  assert.equal(result.quote.debtSharePercent, 30);
  assert.equal(result.quote.remainingIncome, 45_000);
});

test('the down payment uses the entire remainder of current savings after the reserve', () => {
  const savings = 200_000;
  const result = calculateAffordability({ ...base, savings });
  assert.ok(result.quote);
  assert.equal(result.limitingFactor, 'savings');
  assert.equal(result.quote.principal, 240_000);
  assert.equal(result.quote.payment, 20_000);
  assert.equal(result.quote.reserve, 120_000);
  assert.equal(result.quote.downPayment, savings - result.quote.reserve);
  assert.equal(result.quote.price, 320_000);
  assert.equal(result.quote.requiredSavings, savings);
  assert.equal(result.additionalSavingsForIncomeQuote, 100_000);
});

test('extra savings are available for the down payment after setting aside the reserve', () => {
  const result = calculateAffordability({ ...base, savings: 400_000 });
  assert.ok(result.quote);
  assert.equal(result.limitingFactor, 'income');
  assert.equal(result.quote.principal, 360_000);
  assert.equal(result.quote.downPayment, 220_000);
  assert.equal(result.quote.price, 580_000);
  assert.equal(result.quote.reserve, 180_000);
  assert.equal(result.additionalSavingsForIncomeQuote, 0);
});

test('the monthly budget honors living expenses, existing loans and the requested remainder', () => {
  const result = calculateAffordability({
    ...base, livingCosts: 74_000, monthlyDebts: 5_000, monthlyRemainder: 10_000,
  });
  assert.ok(result.quote);
  assert.equal(result.paymentBudget, 11_000);
  assert.equal(result.quote.principal, 132_000);
  assert.equal(result.quote.remainingIncome, 10_000);
  assert.equal(result.quote.reserve, 66_000);
});

test('insufficient savings and insufficient monthly budget produce different results', () => {
  const cashLimited = calculateAffordability({ ...base, savings: 0 });
  assert.equal(cashLimited.limitingFactor, 'savings');
  assert.equal(cashLimited.quote, null);
  assert.equal(cashLimited.incomeQuote?.principal, 360_000);
  assert.equal(cashLimited.additionalSavingsForIncomeQuote, 300_000);
  const budgetLimited = calculateAffordability({ ...base, monthlyDebts: 30_000, savings: 500_000 });
  assert.equal(budgetLimited.limitingFactor, 'monthly-budget');
  assert.equal(budgetLimited.quote, null);
  assert.equal(budgetLimited.incomeQuote, null);
  assert.equal(budgetLimited.paymentBudget, 0);
});

test('reserve months are capped by the term and can be zero', () => {
  const fullTerm = calculateAffordability({ ...base, reserveMonths: 36 });
  assert.equal(fullTerm.reserveMonths, 12);
  assert.equal(fullTerm.quote?.reserve, 360_000);
  const noReserve = calculateAffordability({ ...base, reserveMonths: 0, savings: 200_000 });
  assert.equal(noReserve.quote?.reserve, 0);
  assert.equal(noReserve.quote?.principal, 360_000);
});

test('payments at a market rate match the forward calculation to the kopeck', () => {
  const input = { ...base, annualRate: 18, months: 240, savings: 1_000_000, reserveMonths: 7 };
  const result = calculateAffordability(input);
  assert.ok(result.quote);
  const { quote } = result;
  const forward = calculateMortgage({
    principal: quote.principal, months: input.months, annualRate: input.annualRate, paymentType: 'annuity',
  });
  assert.equal(quote.payment, forward.firstPayment);
  assert.equal(quote.reserve, Math.ceil((Math.round(forward.firstPayment * 100) * input.reserveMonths) / 100));
  assert.ok(quote.payment <= result.paymentBudget);
  assert.ok(quote.downPayment / quote.price >= 0.25);
  const nextPayment = calculateMortgage({
    principal: quote.principal + 1, months: input.months, annualRate: input.annualRate, paymentType: 'annuity',
  }).firstPayment;
  const additionalRubles = Math.ceil((quote.principal + 1) / 3)
    + Math.ceil(Math.round(nextPayment * 100) * input.reserveMonths / 100);
  assert.ok(nextPayment > result.paymentBudget || additionalRubles > input.savings);
});

test('a larger reserve lowers the affordable loan when current savings are the constraint', () => {
  const input = { ...base, savings: 200_000, annualRate: 18, months: 240, reserveMonths: 3 };
  const short = calculateAffordability(input);
  const long = calculateAffordability({ ...input, reserveMonths: 12 });
  assert.ok(short.quote && long.quote);
  assert.ok(long.quote.principal < short.quote.principal);
  assert.ok(long.quote.reserve > short.quote.reserve);
  assert.ok(long.quote.downPayment < short.quote.downPayment);
});

test('the search respects half-kopeck rounding even for a small zero-rate loan', () => {
  const result = calculateAffordability({
    ...base, monthlyIncome: 1, livingCosts: 0, maxDebtSharePercent: 12, months: 392,
  });
  assert.equal(result.quote?.payment, 0.12);
  assert.equal(result.quote?.principal, 48);
  const next = calculateMortgage({ principal: 49, annualRate: 0, months: 392, paymentType: 'annuity' });
  assert.equal(next.firstPayment, 0.13);
});

test('invalid inputs fail explicitly and zero income yields no loan', () => {
  assert.throws(() => calculateAffordability({ ...base, minimumDownPercent: 100 }), RangeError);
  assert.throws(() => calculateAffordability({ ...base, reserveMonths: -1 }), RangeError);
  assert.throws(() => calculateAffordability({ ...base, savings: -1 }), RangeError);
  assert.equal(calculateAffordability({ ...base, monthlyIncome: 0 }).quote, null);
});

test('a selected apartment recalculates its loan, payment and reserve without moving the budget limit', () => {
  const input = { ...base, savings: 200_000 };
  const { maximumPrice } = calculateAffordability(input);
  assert.equal(maximumPrice, 320_000);
  const result = calculateAffordability({ ...input, apartmentPrice: 260_000 });
  assert.equal(result.maximumPrice, maximumPrice);
  assert.deepEqual(result.quote, {
    principal: 120_000, price: 260_000, payment: 10_000, reserve: 60_000, downPayment: 140_000,
    requiredSavings: 200_000, remainingIncome: 80_000, debtSharePercent: 10,
  });
  assert.equal(calculateAffordability({ ...input, apartmentPrice: maximumPrice }).quote?.price, maximumPrice);
  assert.equal(calculateAffordability({ ...input, apartmentPrice: maximumPrice + 1 }).quote, null);
});

test('bank requirements constrain the price limit before validating a chosen apartment', () => {
  const input = { ...base, savings: 200_000, apartmentPrice: 310_000 };
  assert.ok(calculateAffordability(input).quote);
  const higherDown = calculateAffordability({ ...input, minimumDownPercent: 50 });
  assert.ok(higherDown.maximumPrice < input.apartmentPrice);
  assert.equal(higherDown.quote, null);
  const capped = calculateAffordability({ ...input, bankLoanLimit: 120_000 });
  assert.equal(capped.maximumPrice, 260_000);
  assert.equal(capped.quote, null);
  assert.equal(capped.limitingFactor, 'bank-limit');
});

test('an income-only budget uses the bank minimum and a cash purchase only uses its price', () => {
  const planned = calculateAffordability({ ...base, apartmentPrice: 200_000, bankLoanLimit: 180_000 });
  assert.equal(planned.maximumPrice, 240_000);
  assert.equal(planned.quote?.downPayment, 50_000);
  assert.equal(planned.quote?.reserve, 75_000);
  for (const monthlyIncome of [0, 100_000]) {
    const cash = calculateAffordability({ ...base, savings: 400_000, monthlyIncome, apartmentPrice: 350_000 });
    assert.equal(cash.quote?.principal, 0);
    assert.equal(cash.quote?.reserve, 0);
    assert.equal(cash.quote?.requiredSavings, 350_000);
    assert.equal(cash.quote?.debtSharePercent, 0);
  }
});

test('the price maximum considers ruble reserve rounding and validates against that reachable price', () => {
  const input = { ...base, months: 180, reserveMonths: 120, savings: 100, bankLoanLimit: 10 };
  const result = calculateAffordability(input);
  assert.equal(result.maximumPrice, 103);
  assert.equal(result.quote?.price, 103);
  assert.equal(calculateAffordability({ ...input, apartmentPrice: 103 }).quote?.requiredSavings, 100);
  assert.equal(calculateAffordability({ ...input, apartmentPrice: 104 }).quote, null);
});
