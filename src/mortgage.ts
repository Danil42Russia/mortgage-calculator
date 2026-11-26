export type PaymentType = 'annuity' | 'declining';
export type PrepaymentGoal = 'term' | 'payment';

export interface MortgageInput {
  principal: number;
  annualRate: number;
  months: number;
  paymentType: PaymentType;
  rateChange?: { month: number; annualRate: number };
  prepayment?: {
    goal: PrepaymentGoal;
    monthly?: { startMonth: number; amount: number };
    lump?: { month: number; amount: number };
  };
  annualInsuranceRate?: number;
}

export interface PaymentRow {
  month: number;
  annualRate: number;
  scheduledPayment: number;
  scheduledPrincipal: number;
  interest: number;
  prepayment: number;
  insurance: number;
  balance: number;
}

export interface MortgageResult {
  principal: number;
  rows: PaymentRow[];
  firstPayment: number;
  totalInterest: number;
  totalPrepayment: number;
  totalInsurance: number;
  totalPaid: number;
}

const toCents = (rubles: number) => Math.round(rubles * 100);
const toRubles = (cents: number) => cents / 100;
const monthlyRate = (annualRate: number) => annualRate / 1200;
export const MAX_MORTGAGE_PRINCIPAL = 1e11;

function scheduledAmount(balance: number, months: number, rate: number, type: PaymentType) {
  if (type === 'declining' || rate === 0) {
    return Math.max(1, Math.round(balance / months));
  }
  const factor = -Math.expm1(-months * Math.log1p(rate));
  return Math.max(1, Math.round(balance * (rate / factor)));
}

function principalForMonth(balance: number, amount: number, rate: number, type: PaymentType) {
  const interest = Math.round(balance * rate);
  return type === 'annuity' ? Math.max(0, amount - interest) : amount;
}

export function firstAnnuityPayment(principal: number, annualRate: number, months: number) {
  const balance = toCents(principal);
  if (balance <= 0) return 0;
  const rate = monthlyRate(annualRate);
  const amount = scheduledAmount(balance, months, rate, 'annuity');
  const principalDue = months === 1 ? balance : Math.min(balance, principalForMonth(balance, amount, rate, 'annuity'));
  return toRubles(principalDue + Math.round(balance * rate));
}

function remainingTerm(balance: number, amount: number, rate: number, type: PaymentType, cap: number) {
  for (let month = 1; month < cap; month += 1) {
    balance -= principalForMonth(balance, amount, rate, type);
    if (balance <= 0) {
      return month;
    }
  }
  return cap;
}

function requireNumber(value: number, label: string, minimum: number, maximum: number, whole = false) {
  if (!Number.isFinite(value) || value < minimum || value > maximum || (whole && !Number.isInteger(value))) {
    throw new RangeError(label + ' must be between ' + minimum + ' and ' + maximum);
  }
}

/** Model end-of-month payments. Amounts are input and returned in rubles, rates in percent. */
export function calculateMortgage(input: MortgageInput): MortgageResult {
  const { principal, annualRate, months, paymentType, rateChange, prepayment, annualInsuranceRate = 0 } = input;
  requireNumber(principal, 'Principal', 0, MAX_MORTGAGE_PRINCIPAL);
  requireNumber(annualRate, 'Annual rate', 0, 100);
  requireNumber(months, 'Number of months', 1, 1200, true);
  requireNumber(annualInsuranceRate, 'Insurance rate', 0, 100);

  if (rateChange) {
    requireNumber(rateChange.month, 'Rate change month', 2, 1200, true);
    requireNumber(rateChange.annualRate, 'New annual rate', 0, 100);
  }
  if (prepayment?.monthly) {
    requireNumber(prepayment.monthly.startMonth, 'First prepayment month', 1, 1200, true);
    requireNumber(prepayment.monthly.amount, 'Monthly prepayment', 0, 1e11);
  }
  if (prepayment?.lump) {
    requireNumber(prepayment.lump.month, 'Lump prepayment month', 1, 1200, true);
    requireNumber(prepayment.lump.amount, 'Lump prepayment', 0, 1e11);
  }

  const originalBalance = toCents(principal);
  const monthlyExtra = toCents(prepayment?.monthly?.amount ?? 0);
  const lumpExtra = toCents(prepayment?.lump?.amount ?? 0);
  let balance = originalBalance;
  let endMonth = months;
  let rate = monthlyRate(annualRate);
  let currentAnnualRate = annualRate;
  let amount = scheduledAmount(balance, months, rate, paymentType);
  let interestSum = 0;
  let extraSum = 0;
  let insuranceSum = 0;
  const rows: PaymentRow[] = [];

  for (let month = 1; month <= endMonth && balance > 0; month += 1) {
    if (rateChange?.month === month) {
      // Preserve the shorter term already earned under the preceding payment.
      if (prepayment?.goal === 'term' && extraSum > 0) {
        endMonth = month - 1 + remainingTerm(balance, amount, rate, paymentType, endMonth - month + 1);
      }
      currentAnnualRate = rateChange.annualRate;
      rate = monthlyRate(currentAnnualRate);
      amount = scheduledAmount(balance, endMonth - month + 1, rate, paymentType);
    }

    const interest = Math.round(balance * rate);
    const insurance = month % 12 === 1 ? Math.round(balance * annualInsuranceRate / 100) : 0;
    const scheduledPrincipal = month === endMonth
      ? balance
      : Math.min(balance, principalForMonth(balance, amount, rate, paymentType));

    const recurring = prepayment?.monthly && month >= prepayment.monthly.startMonth ? monthlyExtra : 0;
    const oneOff = prepayment?.lump?.month === month ? lumpExtra : 0;
    const extra = Math.min(balance - scheduledPrincipal, recurring + oneOff);
    balance -= scheduledPrincipal + extra;
    interestSum += interest;
    extraSum += extra;
    insuranceSum += insurance;

    rows.push({
      month,
      annualRate: currentAnnualRate,
      scheduledPayment: toRubles(scheduledPrincipal + interest),
      scheduledPrincipal: toRubles(scheduledPrincipal),
      interest: toRubles(interest),
      prepayment: toRubles(extra),
      insurance: toRubles(insurance),
      balance: toRubles(balance),
    });

    if (prepayment?.goal === 'payment' && extra > 0 && balance > 0) {
      amount = scheduledAmount(balance, endMonth - month, rate, paymentType);
    }
  }

  return {
    principal: toRubles(originalBalance),
    rows,
    firstPayment: rows[0]?.scheduledPayment ?? 0,
    totalInterest: toRubles(interestSum),
    totalPrepayment: toRubles(extraSum),
    totalInsurance: toRubles(insuranceSum),
    totalPaid: toRubles(originalBalance + interestSum),
  };
}

export interface SchedulePeriod {
  period: number;
  payment: number;
  principal: number;
  interest: number;
  prepayment: number;
  insurance: number;
  balance: number;
}

export function summarizeSchedule(rows: readonly PaymentRow[], grouping: 'month' | 'year'): SchedulePeriod[] {
  const periods: SchedulePeriod[] = [];
  for (const row of rows) {
    const period = grouping === 'month' ? row.month : Math.ceil(row.month / 12);
    const index = period - 1;
    const summary = periods[index] ?? {
      period, payment: 0, principal: 0, interest: 0, prepayment: 0, insurance: 0, balance: 0,
    };
    summary.payment += toCents(row.scheduledPayment) + toCents(row.prepayment);
    summary.principal += toCents(row.scheduledPrincipal) + toCents(row.prepayment);
    summary.interest += toCents(row.interest);
    summary.prepayment += toCents(row.prepayment);
    summary.insurance += toCents(row.insurance);
    summary.balance = row.balance;
    periods[index] = summary;
  }
  return periods.map(row => ({
    ...row,
    payment: toRubles(row.payment),
    principal: toRubles(row.principal),
    interest: toRubles(row.interest),
    prepayment: toRubles(row.prepayment),
    insurance: toRubles(row.insurance),
  }));
}
