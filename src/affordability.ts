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
  apartmentPrice?: number | null;
  bankLoanLimit?: number | null;
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
  maximumPrice: number;
  paymentBudget: number;
  reserveMonths: number;
  incomeQuote: AffordabilityQuote | null;
  quote: AffordabilityQuote | null;
  limitingFactor: 'income' | 'savings' | 'monthly-budget' | 'bank-limit';
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

function principalForMaximumPrice(limit: number, reserveMonths: number, reserveFor: (loan: number) => number) {
  let best = limit;
  let bestGain = best - reserveFor(best);
  // Compare net buying power (loan minus reserve). Over a step of reserveMonths rubles,
  // a linear annuity changes by either always <= 100 kopecks or always >= 100 kopecks.
  // Thus each residue class has its maximum at an end. Include the initial 1-kopeck payment floor.
  const window = Math.min(limit, 2 * reserveMonths);
  for (let offset = 0; offset < window; offset += 1) {
    for (const loan of [offset, limit - offset]) {
      const gain = loan - reserveFor(loan);
      if (gain > bestGain) {
        best = loan;
        bestGain = gain;
      }
    }
  }
  return best;
}

/** Estimate a fixed-rate annuity for one borrower. Money inputs use whole rubles. */
export function calculateAffordability(input: AffordabilityInput): AffordabilityResult {
  const {
    monthlyIncome, livingCosts, monthlyDebts, monthlyRemainder, savings,
    annualRate, months, minimumDownPercent, maxDebtSharePercent, apartmentPrice, bankLoanLimit,
  } = input;
  requireRange(monthlyIncome, 'Monthly income', 0, 1e9, true);
  requireRange(livingCosts, 'Monthly living costs', 0, 1e9, true);
  requireRange(monthlyDebts, 'Monthly debts', 0, 1e9, true);
  requireRange(monthlyRemainder, 'Minimum monthly remainder', 0, 1e9, true);
  if (savings !== null) requireRange(savings, 'Savings', 0, 1e9, true);
  if (apartmentPrice != null) requireRange(apartmentPrice, 'Apartment price', 0, Number.MAX_SAFE_INTEGER, true);
  if (bankLoanLimit != null) requireRange(bankLoanLimit, 'Bank loan limit', 0, MAX_MORTGAGE_PRINCIPAL, true);
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
      debtSharePercent: monthlyIncome ? (monthlyDebts + payment) / monthlyIncome * 100 : 0,
    };
  }

  const paymentBudget = budgetCents / 100;
  const incomePrincipal = highestPrincipal(MAX_MORTGAGE_PRINCIPAL, principal => paymentCents(principal) <= budgetCents);
  const loanCap = Math.min(incomePrincipal, bankLoanLimit ?? MAX_MORTGAGE_PRINCIPAL);
  const incomeQuote = loanCap ? makeQuote(loanCap, minimumDown(loanCap)) : null;
  const principal = savings === null ? loanCap : highestPrincipal(loanCap, amount => neededCash(amount) <= savings);
  const pricePrincipal = savings === null ? principal : principalForMaximumPrice(principal, reserveMonths, reserveFor);
  let quote = incomeQuote;
  if (savings !== null) quote = principal ? makeQuote(pricePrincipal, savings - reserveFor(pricePrincipal)) : null;
  const maximumPrice = Math.max(quote?.price ?? 0, savings ?? 0);

  if (apartmentPrice != null) {
    if (!apartmentPrice || apartmentPrice > maximumPrice) {
      quote = null;
    } else if (savings === null) {
      const loan = highestPrincipal(principal, amount => amount + minimumDown(amount) <= apartmentPrice);
      quote = makeQuote(loan, apartmentPrice - loan);
    } else if (savings >= apartmentPrice) {
      quote = makeQuote(0, apartmentPrice);
    } else {
      const uncovered = apartmentPrice - savings;
      let low = uncovered;
      let high = Math.min(pricePrincipal, apartmentPrice);
      // Find a whole-ruble loan covering both the unfunded price and its own payment reserve.
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        if (middle < uncovered + reserveFor(middle)) low = middle + 1;
        else high = middle;
      }
      quote = makeQuote(low, apartmentPrice - low);
    }
  }
  return {
    maximumPrice, paymentBudget,
    reserveMonths,
    incomeQuote,
    quote,
    limitingFactor: !incomePrincipal ? 'monthly-budget' : principal < loanCap ? 'savings' : loanCap < incomePrincipal ? 'bank-limit' : 'income',
    additionalSavingsForIncomeQuote: savings !== null && incomeQuote ? Math.max(0, incomeQuote.requiredSavings - savings) : null,
  };
}
