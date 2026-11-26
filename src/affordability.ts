import { firstAnnuityPayment, MAX_MORTGAGE_PRINCIPAL } from './mortgage.ts';

export interface AffordabilityInput {
  monthlyIncome: number;
  livingCosts: number;
  monthlyDebts: number;
  monthlyRemainder: number;
  savings: number | null;
  annualRate: number;
  months: number;
  minimumDownPercent: number;
  maxDebtSharePercent: number;
  reserveMonths: number;
}

export interface AffordabilityQuote {
  principal: number;
  payment: number;
  downPayment: number;
  price: number;
  reserve: number;
  requiredSavings: number;
  remainingIncome: number;
  debtSharePercent: number;
}

export interface AffordabilityResult {
  paymentBudget: number;
  reserveMonths: number;
  incomeQuote: AffordabilityQuote | null;
  quote: AffordabilityQuote | null;
  limitingFactor: 'income' | 'savings' | 'monthly-budget';
  additionalSavingsForIncomeQuote: number | null;
}

function requireRange(value: number, label: string, minimum: number, maximum: number, whole = false) {
  if (!Number.isFinite(value) || value < minimum || value > maximum || (whole && !Number.isInteger(value))) {
    throw new RangeError(label + ' must be between ' + minimum + ' and ' + maximum);
  }
}

function highestPrincipal(upperBound: number, fits: (principal: number) => boolean) {
  let low = 0;
  let high = upperBound;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Estimate a fixed-rate annuity for one borrower. Money inputs use whole rubles. */
export function calculateAffordability(input: AffordabilityInput): AffordabilityResult {
  const {
    monthlyIncome, livingCosts, monthlyDebts, monthlyRemainder, savings,
    annualRate, months, minimumDownPercent, maxDebtSharePercent,
  } = input;
  requireRange(monthlyIncome, 'Monthly income', 0, 1e9, true);
  requireRange(livingCosts, 'Monthly living costs', 0, 1e9, true);
  requireRange(monthlyDebts, 'Monthly debts', 0, 1e9, true);
  requireRange(monthlyRemainder, 'Minimum monthly remainder', 0, 1e9, true);
  if (savings !== null) requireRange(savings, 'Savings', 0, 1e9, true);
  requireRange(annualRate, 'Annual rate', 0, 100);
  requireRange(months, 'Number of months', 1, 1200, true);
  requireRange(minimumDownPercent, 'Minimum down payment percent', 0, 99.99);
  requireRange(maxDebtSharePercent, 'Maximum debt share percent', 0, 100);
  requireRange(input.reserveMonths, 'Reserve months', 0, 1200, true);

  const reserveMonths = Math.min(input.reserveMonths, months);
  const freeIncome = monthlyIncome - livingCosts - monthlyDebts;
  const debtSharePoints = Math.round(maxDebtSharePercent * 100);
  const downPoints = Math.round(minimumDownPercent * 100);
  const byDebtShare = Math.floor(monthlyIncome * debtSharePoints / 100) - monthlyDebts * 100;
  const byExpenses = (freeIncome - monthlyRemainder) * 100;
  const budgetCents = Math.max(0, Math.min(byDebtShare, byExpenses));
  const paymentCents = (principal: number) => Math.round(firstAnnuityPayment(principal, annualRate, months) * 100);
  const minimumDown = (principal: number) => Math.ceil(principal * downPoints / (10_000 - downPoints));
  const reserveFor = (principal: number) => Math.ceil(paymentCents(principal) * reserveMonths / 100);
  const neededCash = (principal: number) => minimumDown(principal) + reserveFor(principal);

  function makeQuote(principal: number, downPayment: number): AffordabilityQuote {
    const payment = paymentCents(principal) / 100;
    const reserve = reserveFor(principal);
    return {
      principal,
      payment,
      downPayment,
      price: principal + downPayment,
      reserve,
      requiredSavings: downPayment + reserve,
      remainingIncome: freeIncome - payment,
      debtSharePercent: (monthlyDebts + payment) / monthlyIncome * 100,
    };
  }

  const paymentBudget = budgetCents / 100;
  const incomePrincipal = highestPrincipal(MAX_MORTGAGE_PRINCIPAL, principal => paymentCents(principal) <= budgetCents);
  if (!incomePrincipal) {
    return {
      paymentBudget, reserveMonths, incomeQuote: null, quote: null,
      limitingFactor: 'monthly-budget', additionalSavingsForIncomeQuote: null,
    };
  }

  const incomeQuote = makeQuote(incomePrincipal, minimumDown(incomePrincipal));
  if (savings === null) {
    return {
      paymentBudget, reserveMonths, incomeQuote, quote: incomeQuote,
      limitingFactor: 'income', additionalSavingsForIncomeQuote: null,
    };
  }

  const principal = highestPrincipal(incomePrincipal, amount => neededCash(amount) <= savings);
  const quote = principal ? makeQuote(principal, savings - reserveFor(principal)) : null;
  return {
    paymentBudget,
    reserveMonths,
    incomeQuote,
    quote,
    limitingFactor: principal < incomePrincipal ? 'savings' : 'income',
    additionalSavingsForIncomeQuote: Math.max(0, incomeQuote.requiredSavings - savings),
  };
}
