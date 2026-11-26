import { calculateMortgage } from './mortgage.ts';
import type { MortgageInput, MortgageResult, PaymentType, PrepaymentGoal } from './mortgage.ts';

export type Program = 'market' | 'family' | 'custom';
export type Region = 'other' | 'capital';

export interface Scenario {
  program: Program;
  region: Region;
  children: number;
  price: number;
  down: number;
  downMode: 'currency' | 'percent';
  rate: number;
  years: number;
  type: PaymentType;
  goal: PrepaymentGoal;
  extra: number;
  extraStart: number;
  lump: number;
  lumpMonth: number;
  change: boolean;
  changeMonth: number;
  changeRate: number;
  familyRate: number | null;
  insurance: number;
  fees: number;
  income: number;
  debts: number;
}

export const MARKET_RATE = 18; // CBR, September 2026 market-rate originations.
export const FAMILY_MONTHS = 180;

export const DEFAULT_SCENARIO: Readonly<Scenario> = Object.freeze({
  program: 'market',
  region: 'other',
  children: 1,
  price: 8_500_000,
  down: 2_550_000,
  downMode: 'currency',
  rate: MARKET_RATE,
  years: 20,
  type: 'annuity',
  goal: 'term',
  extra: 0,
  extraStart: 1,
  lump: 0,
  lumpMonth: 12,
  change: false,
  changeMonth: 25,
  changeRate: 14,
  familyRate: null,
  insurance: 0,
  fees: 0,
  income: 0,
  debts: 0,
});

export function familyTerms(region: Region, children: number) {
  if (!Number.isInteger(children) || children < 1) {
    throw new RangeError('Number of children must be a positive integer');
  }
  const index = Math.min(children, 5) - 1;
  const capital = region === 'capital';
  return {
    rate: [10, 8, 6, 4, 2][index] + (capital ? 2 : 0),
    limit: (capital ? [12, 15, 18, 18, 18] : [6, 8, 10, 10, 10])[index] * 1_000_000,
    maxSubsidizedMonths: FAMILY_MONTHS,
  };
}

export type ScenarioResult =
  | { kind: 'over-limit'; principal: number; limit: number; annualRate: number }
  | {
    kind: 'calculated';
    input: MortgageInput;
    result: MortgageResult;
    baseline: MortgageResult | null;
    purchaseCost: number;
    incomeShare: number | null;
    rateChangeRow: MortgageResult['rows'][number] | undefined;
  };

export function evaluateScenario(scenario: Readonly<Scenario>): ScenarioResult {
  const {
    program, region, children, price, down, rate, years, type, goal, extra, extraStart, lump, lumpMonth,
    change, changeMonth, changeRate, familyRate, insurance, fees, income, debts,
  } = scenario;
  const family = program === 'family' ? familyTerms(region, children) : null;
  const annualRate = family?.rate ?? (program === 'market' ? MARKET_RATE : rate);
  const principal = Math.max(0, price - down);
  if (family && principal > family.limit) {
    return { kind: 'over-limit', principal, annualRate, limit: family.limit };
  }

  const months = years * 12;
  const input: MortgageInput = {
    principal,
    annualRate,
    months,
    paymentType: type,
    annualInsuranceRate: insurance,
  };

  if (family && months > family.maxSubsidizedMonths) {
    const cap = annualRate + 4;
    input.rateChange = {
      month: family.maxSubsidizedMonths + 1,
      annualRate: familyRate === null ? cap : Math.max(0, Math.min(familyRate, cap)),
    };
  } else if (!family && change && changeMonth <= months) {
    input.rateChange = { month: changeMonth, annualRate: changeRate };
  }

  const baseline = extra > 0 || lump > 0 ? calculateMortgage(input) : null;
  if (baseline) {
    input.prepayment = {
      goal,
      monthly: { startMonth: extraStart, amount: extra },
      lump: { month: lumpMonth, amount: lump },
    };
  }
  const result = calculateMortgage(input);
  return {
    kind: 'calculated',
    input,
    result,
    baseline: result.totalPrepayment > 0 ? baseline : null,
    purchaseCost: down + result.totalPaid + result.totalInsurance + fees,
    incomeShare: income > 0 ? (result.firstPayment + debts) / income : null,
    rateChangeRow: input.rateChange ? result.rows[input.rateChange.month - 1] : undefined,
  };
}
