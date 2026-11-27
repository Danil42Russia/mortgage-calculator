export type PaymentType = 'annuity' | 'declining';
export type PrepaymentGoal = 'term' | 'payment';

export interface LumpPayment { month: number; amount: number; goal?: PrepaymentGoal }

export interface MortgageInput {
  principal: number;
  annualRate: number;
  months: number;
  paymentType: PaymentType;
  rateChange?: { month: number; annualRate: number };
  prepayment?: {
    goal: PrepaymentGoal;
    monthly?: { startMonth: number; amount: number };
    lump?: LumpPayment;
    lumps?: readonly LumpPayment[];
    payoffReserve?: number;
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
  fromLump?: number;
  /** Portion of prepayment funded by the existing mortgage reserve. */
  fromReserve?: number;
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

function lumpPayments(prepayment: MortgageInput['prepayment']) {
  const lumps = prepayment?.lumps ?? [];
  return prepayment?.lump ? [prepayment.lump, ...lumps] : lumps;
}

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
  const byMonth = new Map<number, LumpPayment[]>();
  for (const lump of lumpPayments(prepayment)) {
    requireNumber(lump.month, 'Lump prepayment month', 1, 1200, true);
    requireNumber(lump.amount, 'Lump prepayment', 0, MAX_MORTGAGE_PRINCIPAL);
    const entries = byMonth.get(lump.month);
    if (entries) entries.push(lump);
    else byMonth.set(lump.month, [lump]);
  }

  const originalBalance = toCents(principal);
  const payoffReserve = prepayment?.payoffReserve ?? 0;
  requireNumber(payoffReserve, 'Payoff reserve', 0, Number.MAX_SAFE_INTEGER / 100);
  const reserveCents = toCents(payoffReserve);
  const monthlyExtra = toCents(prepayment?.monthly?.amount ?? 0);
  let balance = originalBalance;
  let endMonth = months;
  let rate = monthlyRate(annualRate);
  let currentAnnualRate = annualRate;
  let amount = scheduledAmount(balance, months, rate, paymentType);
  let pendingTermReduction = false;
  let interestSum = 0;
  let extraSum = 0;
  let insuranceSum = 0;
  const rows: PaymentRow[] = [];

  for (let month = 1; month <= endMonth && balance > 0; month += 1) {
    if (rateChange?.month === month) {
      // Preserve the shorter term already earned under the preceding payment.
      if (pendingTermReduction) {
        endMonth = month - 1 + remainingTerm(balance, amount, rate, paymentType, endMonth - month + 1);
        pendingTermReduction = false;
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

    balance -= scheduledPrincipal;
    const recurring = prepayment?.monthly && month >= prepayment.monthly.startMonth ? Math.min(balance, monthlyExtra) : 0;
    balance -= recurring;
    let oneOff = 0;
    let forLowerPayment = prepayment?.goal === 'payment' ? recurring : 0;
    for (const lump of byMonth.get(month) ?? []) {
      const applied = Math.min(balance, toCents(lump.amount));
      balance -= applied;
      oneOff += applied;
      if ((lump.goal ?? prepayment?.goal) === 'payment') forLowerPayment += applied;
    }
    const fromReserve = balance <= reserveCents ? balance : 0;
    const extra = recurring + oneOff + fromReserve;
    balance -= fromReserve;
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
      ...(oneOff > 0 ? { fromLump: toRubles(oneOff) } : {}),
      ...(fromReserve > 0 ? { fromReserve: toRubles(fromReserve) } : {}),
      insurance: toRubles(insurance),
      balance: toRubles(balance),
    });

    pendingTermReduction ||= recurring + oneOff > forLowerPayment;
    if (forLowerPayment > 0 && balance > 0) {
      if (pendingTermReduction) {
        endMonth = month + remainingTerm(balance + forLowerPayment, amount, rate, paymentType, endMonth - month);
        pendingTermReduction = false;
      }
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

export function calculateReservePayoff(input: MortgageInput) {
  const schedule = calculateMortgage(input);
  let monthsSaved = 0;
  if (input.prepayment && schedule.rows.at(-1)?.fromReserve) {
    const withoutReserve = calculateMortgage({ ...input, prepayment: { ...input.prepayment, payoffReserve: 0 } });
    monthsSaved = withoutReserve.rows.length - schedule.rows.length;
  }
  const withoutMonthlyExtra = input.prepayment?.monthly?.amount
    ? calculateMortgage({ ...input, prepayment: { ...input.prepayment, monthly: undefined } })
    : null;
  const lumps = lumpPayments(input.prepayment);
  let lumpComparison = null;
  if (input.prepayment && lumps.length && schedule.rows.some(row => row.fromLump)) {
    const prepayment = { ...input.prepayment, lump: undefined, lumps: undefined };
    function allWithGoal(goal: PrepaymentGoal) {
      if (lumps.every(lump => (lump.goal ?? prepayment.goal) === goal)) return schedule;
      return calculateMortgage({ ...input, prepayment: { ...prepayment, lumps: lumps.map(lump => ({ ...lump, goal })) } });
    }
    lumpComparison = {
      withoutLump: calculateMortgage({ ...input, prepayment }),
      term: allWithGoal('term'),
      payment: allWithGoal('payment'),
    };
  }
  return { schedule, monthsSaved, withoutMonthlyExtra, lumpComparison };
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

export function halfRepaidMonth(result: MortgageResult): number | undefined {
  return result.rows.find(row => row.balance <= result.principal / 2)?.month;
}

function overpaymentZone(principal: number, totalInterest: number): 'green' | 'yellow' | 'red' {
  const loan = toCents(principal);
  const interest = toCents(totalInterest);
  if (interest <= 1.5 * loan) return 'green';
  if (interest <= 2 * loan) return 'yellow';
  return 'red';
}

export function bankPaymentRatios({
  principal, totalPaid, totalInterest,
}: Pick<MortgageResult, 'principal' | 'totalPaid' | 'totalInterest'>) {
  if (principal === 0) return null;
  return {
    total: totalPaid / principal,
    interest: totalInterest / principal,
    zone: overpaymentZone(principal, totalInterest),
  };
}

/** Index 0 is the date of issue in the cumulative interest series. */
export function firstMonthInterestReachesPrincipal(cumulativeInterest: readonly number[], principal: number): number | undefined {
  if (principal <= 0) return undefined;
  const month = cumulativeInterest.findIndex(interest => interest >= principal);
  return month < 0 ? undefined : month;
}

export function cumulativeBankPayments(rows: readonly PaymentRow[]) {
  const paid = [0];
  const interest = [0];
  let paidCents = 0;
  let interestCents = 0;
  for (const row of rows) {
    paidCents += toCents(row.scheduledPayment) + toCents(row.prepayment);
    interestCents += toCents(row.interest);
    paid.push(toRubles(paidCents));
    interest.push(toRubles(interestCents));
  }
  return { paid, interest };
}

export function summarizeSchedule(rows: readonly PaymentRow[], grouping: 'month' | 'year', firstMonth = 1): SchedulePeriod[] {
  if (!Number.isInteger(firstMonth) || firstMonth < 1 || firstMonth > 12) throw new RangeError('Invalid first payment month');
  const periods: SchedulePeriod[] = [];
  for (const row of rows) {
    const period = grouping === 'month' ? row.month : Math.ceil((row.month + firstMonth - 1) / 12);
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
