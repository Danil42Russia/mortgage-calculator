import { calculateAffordability } from './affordability.ts';
import type { AffordabilityInput } from './affordability.ts';
import { calculatorHash, readChoiceParam, readNumberParam, restoreStartMonth } from './calculator-uri.ts';
import { SeriesChart } from './chart.ts';
import { setupBankPaymentsChart, setupMortgageChart } from './mortgage-chart.ts';
import { decimal, formatPaymentPeriod, formatTerm, integer, legacyStartMonth, money, monthWord, numberFromInput, parseStartMonth, paymentAxisLabel, yearWord } from './format.ts';
import type { PaymentStart } from './format.ts';
import { bindMoneyGrouping, bindPercentFormatting } from './money-input.ts';
import { calculateReservePayoff, MAX_MORTGAGE_PRINCIPAL } from './mortgage.ts';
import { estimateSalary2026, projectSalary } from './salary.ts';
import type { SalaryBalance, SalaryEstimate, SalaryMonth } from './salary.ts';
import { MARKET_RATE } from './scenario.ts';
import { setupSchedule } from './schedule-table.ts';

type BudgetState = Omit<AffordabilityInput, 'months' | 'monthlyIncome' | 'livingCosts' | 'monthlyDebts' | 'monthlyRemainder'> & {
  salary: number | null;
  salaryMode: 'net' | 'gross';
  salaryPeriod: 'year' | 'term';
  useReserve: boolean;
  monthlyExtra: number;
  years: number;
  startMonth: string;
  purchaseCosts: number;
  apartmentPrice: number | null;
  bankLoanLimit: number | null;
};

const defaults: Readonly<BudgetState> = {
  salary: null,
  salaryMode: 'gross',
  salaryPeriod: 'year',
  useReserve: false,
  monthlyExtra: 0,
  savings: null,
  apartmentPrice: null,
  bankLoanLimit: null,
  purchaseCosts: 0,
  annualRate: MARKET_RATE,
  years: 20,
  startMonth: legacyStartMonth,
  minimumDownPercent: 20,
  maxDebtSharePercent: 35,
  reserveMonths: 6,
};

const moneyLimit = 1_000_000_000;
const fields = {
  salary: { id: 'income', min: 0, max: moneyLimit, money: true },
  monthlyExtra: { id: 'monthly-extra', min: 0, max: moneyLimit, money: true },
  savings: { id: 'savings', min: 0, max: moneyLimit, money: true },
  apartmentPrice: { id: 'apartment-price', min: 0, max: Number.MAX_SAFE_INTEGER, money: true },
  bankLoanLimit: { id: 'bank-loan-limit', min: 0, max: MAX_MORTGAGE_PRINCIPAL, money: true },
  reserveMonths: { id: 'reserve-months', min: 0, max: 120 },
  annualRate: { id: 'rate', min: 0, max: 40, decimal: true },
  years: { id: 'years', min: 1, max: 50 },
  minimumDownPercent: { id: 'down-percent', min: 0, max: 99.99, decimal: true },
  maxDebtSharePercent: { id: 'debt-share', min: 0, max: 100, decimal: true },
  purchaseCosts: { id: 'purchase-costs', min: 0, max: moneyLimit, money: true },
} satisfies Record<Exclude<keyof BudgetState, 'salaryMode' | 'salaryPeriod' | 'useReserve' | 'startMonth'>, { id: string; min: number; max: number; decimal?: boolean; money?: boolean }>;

type FieldKey = keyof typeof fields;
const keys = Object.keys(fields) as FieldKey[];

function budgetElement<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById('budget-' + id) as T;
}

function budgetText(id: string, text: string) {
  budgetElement(id).textContent = text;
}

const rateList = new Intl.ListFormat('ru-RU');
type SalaryRow = Pick<SalaryMonth, 'gross' | 'tax' | 'net'> & { rates?: readonly number[] };

function showSalaryFlow(estimate: SalaryEstimate | null, balances: SalaryBalance[], start: PaymentStart) {
  budgetElement('salary-breakdown').hidden = !estimate;
  if (!estimate) return;

  const body = budgetElement<HTMLTableSectionElement>('salary-rows');
  const total = budgetElement<HTMLTableSectionElement>('salary-total');
  body.replaceChildren();
  total.replaceChildren();

  function appendRow(section: HTMLTableSectionElement, name: string, { gross, tax, net, rates }: SalaryRow, payment: number) {
    const row = section.insertRow();
    const month = document.createElement('th');
    month.scope = 'row';
    month.textContent = name;
    row.append(month);
    row.insertCell().textContent = decimal(gross);
    row.insertCell().textContent = decimal(tax);
    const share = row.insertCell();
    share.textContent = decimal(100 * tax / gross) + '\u00a0%';
    if (rates && rates.length > 1) {
      const detail = document.createElement('small');
      detail.className = 'salary-tax-rates';
      detail.textContent = 'Ставки ' + rateList.format(rates.map(rate => rate + '\u00a0%'));
      share.append(detail);
    }
    const remaining = net - payment;
    for (const value of [net, payment, remaining]) {
      row.insertCell().textContent = decimal(value);
    }
    row.lastElementChild?.classList.toggle('salary-deficit', remaining < 0);
    return remaining;
  }

  let deficitMonths = 0;
  for (const [index, month] of estimate.months.entries()) {
    if (appendRow(body, formatPaymentPeriod(index + 1, start), month, balances[index].payment) < 0) deficitMonths += 1;
  }
  const annualPayment = estimate.annualNet - balances[11].accumulated;
  appendRow(total, 'За 12 месяцев', { gross: estimate.annualGross, tax: estimate.annualTax, net: estimate.annualNet }, annualPayment);
  budgetText('salary-status', deficitMonths ? 'Месяцев, в которых платёж по ипотеке превышает зарплату на руки, — ' + deficitMonths + '.' : '');
  budgetElement('salary-status').hidden = deficitMonths === 0;
}

function showSalaryChart(chart: SeriesChart, balances: SalaryBalance[], period: BudgetState['salaryPeriod'], termMonths: number, start: PaymentStart) {
  if (!balances.length) {
    chart.setSeries(null);
    return;
  }
  const byMonth = period === 'year';
  const amount = (value: number) => decimal(value) + '\u00a0₽';
  const lastMonth = byMonth ? 12 : termMonths;
  const total = balances[lastMonth - 1].accumulated;
  budgetText('salary-chart-title', byMonth ? 'Остаток после ипотеки по месяцам' : 'Сколько накопится, если откладывать весь остаток');
  budgetText('salary-sum', formatPaymentPeriod(1, start, lastMonth) + ' · всего ' + amount(total));
  chart.setSeries(byMonth ? {
    values: balances.slice(0, 12).map(month => month.remaining),
    axisStep: 1,
    fitValues: true,
    axisLabel: index => paymentAxisLabel(index + 1, start),
    pointLabel: index => formatPaymentPeriod(index + 1, start),
    formatValue: amount,
  } : {
    values: [0, ...balances.slice(0, termMonths).map(month => month.accumulated)],
    axisStep: 12,
    firstAxisIndex: 1,
    axisLabel: index => paymentAxisLabel(index, start),
    pointLabel: index => formatPaymentPeriod(index, start),
    formatValue: amount,
  });
}

export function setupAffordability(onChange: () => void) {
  let state: BudgetState = { ...defaults };
  const updateSchedule = setupSchedule();
  const scheduleSection = budgetElement('schedule');
  const reserveButtons = document.querySelectorAll<HTMLButtonElement>('[data-reserve-months]');
  const useReserveInput = budgetElement<HTMLInputElement>('use-reserve');
  const startInput = budgetElement<HTMLInputElement>('start-month');
  const priceInput = budgetElement<HTMLInputElement>('apartment-price');
  const incomeModes = document.querySelectorAll<HTMLInputElement>('input[name="budget-income-mode"]');
  const salaryPeriods = document.querySelectorAll<HTMLInputElement>('input[name="salary-period"]');
  const cashBar = budgetElement('cash-bar');
  const status = budgetElement('status');
  const chart = setupMortgageChart(budgetElement('debt-chart-card'), onChange);
  const updateBankPayments = setupBankPaymentsChart(budgetElement('bank-payments'));
  const salaryChart = new SeriesChart(
    budgetElement<HTMLCanvasElement>('salary-chart'), budgetElement('salary-tooltip'), budgetElement('salary-live'),
  );

  function updateField(key: FieldKey) {
    const field = fields[key];
    const input = budgetElement<HTMLInputElement>(field.id);
    const value = state[key];
    input.value = value === null ? '' : 'decimal' in field ? decimal(value) : integer(value);
    input.removeAttribute('aria-invalid');
  }

  function render() {
    const { salary, salaryMode, salaryPeriod, years, purchaseCosts, useReserve, monthlyExtra, startMonth, ...budget } = state;
    const start = parseStartMonth(startMonth)!;
    const months = years * 12;
    const gross = salaryMode === 'gross';
    const estimate = gross && salary ? estimateSalary2026(salary, start.month) : null;
    const monthlyIncome = estimate ? Math.floor(estimate.averageNet) : (salary ?? 0);
    const result = calculateAffordability({
      ...budget, monthlyIncome, months, livingCosts: 0, monthlyDebts: 0, monthlyRemainder: 0,
    });
    const { quote, incomeQuote } = result;
    const hasSavings = state.savings !== null;
    const target = state.apartmentPrice;
    const cash = target === null ? quote ?? incomeQuote : quote;
    const cashPurchase = quote?.principal === 0;
    const hasBudget = state.salary !== null;
    const maximumLabel = hasSavings ? 'Максимальная цена по бюджету' : 'Максимальная цена при взносе ' + decimal(state.minimumDownPercent) + ' %';
    budgetText('price-summary', target === null ? 'По желанию' : money(target));
    budgetText('price-limit', hasBudget ? maximumLabel + ' — ' + money(result.maximumPrice) + '.'
      + (hasSavings ? '' : ' Укажите накопления, чтобы проверить свой бюджет.') : 'Для расчёта максимума укажите зарплату.');
    let priceError = '';
    if (target === 0) priceError = 'Цена квартиры должна быть больше нуля.';
    else if (target !== null && hasBudget && target > result.maximumPrice) {
      priceError = 'Цена выше максимума на ' + money(target - result.maximumPrice) + '.';
    }
    budgetText('price-error', priceError);
    budgetElement('price-error').hidden = !priceError;
    priceInput.setCustomValidity(priceError);
    if (priceError) priceInput.setAttribute('aria-invalid', 'true');
    else if (priceInput.value === '' || numberFromInput(priceInput.value, false) === target) priceInput.removeAttribute('aria-invalid');

    budgetText('income-label', gross ? 'Зарплата до НДФЛ в месяц' : 'Средняя зарплата на руки');
    budgetText('income-hint', estimate ? 'Расчётная средняя на руки — ' + money(monthlyIncome) + ' в месяц.'
      : gross ? 'Возьмите начисленную сумму за месяц из расчётного листка.'
      : 'Если сумма меняется, сложите выплаты после НДФЛ за 12 месяцев и разделите на 12.');
    budgetText('share-hint', monthlyIncome ? 'До ' + decimal(result.paymentBudget) + '\u00a0₽ в месяц из зарплаты на руки.'
      : 'Какой процент зарплаты на руки вы готовы отдавать за ипотеку.');
    budgetText('terms-summary', decimal(state.annualRate) + '% · ' + years + ' ' + yearWord(years));
    budgetText('extra-summary', monthlyExtra ? money(monthlyExtra) + '/мес.' : 'По желанию');

    for (const button of reserveButtons) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.reserveMonths) === state.reserveMonths));
    }

    budgetText('loan', quote ? money(quote.principal) : '—');
    budgetElement('result-stats').hidden = monthlyIncome === 0 && !cashPurchase;
    budgetText('price', target !== null ? money(target) : quote ? money(quote.price) : '—');
    budgetText('down-summary', quote ? money(quote.downPayment) : '—');
    budgetText('payment', quote ? decimal(quote.payment) + '\u00a0₽' : '—');
    budgetText('reserve-summary', quote ? money(quote.reserve) : '—');
    budgetElement('monthly-left').hidden = !quote || !monthlyIncome;
    budgetText('result-note', cashPurchase ? 'Покупка за собственные средства.' : priceError ? priceError : quote
      ? (hasSavings ? 'С учётом накоплений' : 'По доходу') + ' · обязательный платёж ' + decimal(quote.debtSharePercent) + '% зарплаты на руки'
      : monthlyIncome ? 'Оценка для одного заёмщика' : 'Введите зарплату, чтобы начать расчёт.');

    let notice = '';
    if (result.limitingFactor === 'bank-limit' && target === null) {
      notice = 'Кредит ограничен указанным лимитом банка — ' + money(state.bankLoanLimit!) + '.';
    } else if (target !== null) {
      if (quote && !hasSavings) notice = 'Для этой цены на взнос и подушку потребуется ' + money(quote.requiredSavings) + '.';
    } else if (!incomeQuote) {
      if (monthlyIncome) notice = 'При выбранной доле зарплаты платёж слишком мал для расчёта ипотеки.';
    } else if (result.limitingFactor === 'savings') {
      const gap = money(result.additionalSavingsForIncomeQuote ?? 0);
      notice = quote
        ? 'По доходу доступно до ' + money(incomeQuote.principal) + '. Для такого кредита нужно ещё ' + gap + ' накоплений.'
        : 'Сейчас накоплений не хватает на взнос и подушку. Для кредита по доходу нужно ещё ' + gap + '.';
    }
    budgetText('status', notice);
    status.hidden = !notice;

    const payoffReserve = useReserve ? quote?.reserve ?? 0 : 0;
    const payoff = quote?.principal ? calculateReservePayoff({
      principal: quote.principal,
      annualRate: budget.annualRate,
      months,
      paymentType: 'annuity',
      prepayment: { goal: 'term', payoffReserve, monthly: { startMonth: 1, amount: monthlyExtra } },
    }) : null;
    const schedule = payoff?.schedule ?? null;
    const lastPayment = schedule?.rows.at(-1);
    budgetElement('payoff-result').hidden = !useReserve || !lastPayment;
    if (useReserve && payoff && lastPayment) {
      const fromReserve = lastPayment.fromReserve ?? 0;
      budgetText('payoff-time', 'Погашение из подушки экономит ' + formatTerm(payoff.monthsSaved, 'long') + '.');
      budgetText('payoff-details', 'Последний платёж — ' + formatPaymentPeriod(lastPayment.month, start)
        + '. Срок с учётом погашения — ' + formatTerm(lastPayment.month, 'long') + '.'
        + (fromReserve ? ' Из подушки уйдёт ' + decimal(fromReserve) + '\u00a0₽.' : '')
        + ' В подушке останется ' + decimal(payoffReserve - fromReserve) + '\u00a0₽.');
    }
    const balances = salary ? projectSalary(estimate ?? salary, months, schedule?.rows ?? []) : [];
    if (quote && balances.length) {
      const remaining = monthlyIncome - balances[0].payment;
      const paysExtra = monthlyExtra > 0 && !cashPurchase;
      const label = !paysExtra ? 'После ипотеки остаётся' : remaining < 0
        ? 'Из средней зарплаты на первый платёж с доплатой не хватит' : 'Из средней зарплаты после первого платежа с доплатой останется';
      budgetText('monthly-left-label', label);
      budgetText('monthly-left-amount', decimal(Math.abs(remaining)) + '\u00a0₽' + (paysExtra ? '' : ' в месяц'));
    }
    budgetElement('salary').hidden = !salary;
    budgetElement('open-salary').hidden = !salary;
    budgetElement('no-salary-payment').hidden = !!schedule || cashPurchase;
    budgetText('salary-average', money(monthlyIncome));
    showSalaryChart(salaryChart, balances, salaryPeriod, schedule?.rows.length ?? months, start);
    showSalaryFlow(estimate, balances, start);
    const baseline = payoff?.withoutMonthlyExtra ?? null;
    chart.set(schedule ? { result: schedule, baseline, start } : null);
    updateBankPayments(schedule, baseline, start);
    budgetElement('chart-empty').hidden = schedule !== null;
    budgetText('chart-empty', cashPurchase ? 'При покупке без ипотеки платежей по кредиту нет.' : monthlyIncome ? 'График появится, когда будет рассчитана сумма кредита.'
      : 'Укажите зарплату, чтобы построить график.');

    budgetElement('cash').hidden = !cash;
    if (cash) {
      const { requiredSavings, downPayment, reserve } = cash;
      budgetText('cash-note', hasSavings && quote ? 'Как распределятся ваши накопления' : 'Сколько нужно на взнос и подушку');
      budgetText('required', money(requiredSavings));
      budgetText('down', money(downPayment));
      budgetText('reserve', money(reserve));
      budgetText('reserve-label', 'Подушка на ' + result.reserveMonths + ' ' + monthWord(result.reserveMonths));
      budgetElement('costs-note').hidden = purchaseCosts === 0;
      budgetText('costs-note', 'Дополнительно на расходы по сделке нужно ' + money(purchaseCosts) + '.');
      cashBar.hidden = requiredSavings === 0;
      for (const [index, amount] of [downPayment, reserve].entries()) {
        const segment = cashBar.children[index] as HTMLElement;
        segment.style.flexGrow = String(amount);
        segment.hidden = !amount;
      }
    }

    scheduleSection.hidden = !schedule;
    budgetElement('detail-link').hidden = !schedule;
    updateSchedule(schedule?.rows ?? [], start);
    onChange();
    return quote;
  }

  function setValue(key: FieldKey, value: number | null) {
    if (key === 'savings' || key === 'salary' || key === 'apartmentPrice' || key === 'bankLoanLimit') state[key] = value;
    else state[key] = value ?? 0;
  }

  for (const key of keys) {
    const field = fields[key];
    const input = budgetElement<HTMLInputElement>(field.id);
    if ('money' in field) bindMoneyGrouping(input);
    if ('decimal' in field) bindPercentFormatting(input);
    input.addEventListener('input', () => {
      const empty = !input.value.trim();
      if (empty && !field.min) {
        setValue(key, null);
        input.removeAttribute('aria-invalid');
        render();
        return;
      }
      const fraction = 'decimal' in field;
      const value = numberFromInput(input.value, fraction);
      if (!Number.isFinite(value)) {
        input.setAttribute('aria-invalid', 'true');
        return;
      }
      const clamped = Math.max(field.min, Math.min(field.max, value));
      if (clamped === value) input.removeAttribute('aria-invalid');
      else input.setAttribute('aria-invalid', 'true');
      setValue(key, fraction ? Math.round(clamped * 100) / 100 : clamped);
      render();
    });
    input.addEventListener('blur', () => {
      updateField(key);
      const quote = render();
      budgetText('live', quote ? 'Расчётная сумма ипотеки ' + money(quote.principal) : '');
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'Enter') input.blur();
    });
  }

  reserveButtons.forEach(button => button.addEventListener('click', () => {
    state.reserveMonths = Number(button.dataset.reserveMonths);
    updateField('reserveMonths');
    const quote = render();
    if (quote) budgetText('live', 'Подушка на ипотеку ' + money(quote.reserve));
  }));

  useReserveInput.addEventListener('change', () => {
    state.useReserve = useReserveInput.checked;
    render();
  });

  startInput.addEventListener('input', () => {
    if (!parseStartMonth(startInput.value)) {
      startInput.setAttribute('aria-invalid', 'true');
      return;
    }
    startInput.removeAttribute('aria-invalid');
    state.startMonth = startInput.value;
    render();
  });
  startInput.addEventListener('blur', () => {
    startInput.value = state.startMonth;
    startInput.removeAttribute('aria-invalid');
  });

  incomeModes.forEach(input => input.addEventListener('change', () => {
    state.salaryMode = input.value === 'gross' ? 'gross' : 'net';
    render();
  }));

  salaryPeriods.forEach(input => input.addEventListener('change', () => {
    state.salaryPeriod = input.value === 'term' ? 'term' : 'year';
    render();
  }));

  budgetElement('open-salary').addEventListener('click', () => {
    budgetElement('salary-title').focus({ preventScroll: true });
    budgetElement('salary').scrollIntoView();
  });

  budgetElement('open-schedule').addEventListener('click', () => {
    scheduleSection.querySelector('h2')!.focus({ preventScroll: true });
    scheduleSection.scrollIntoView();
  });

  function restore(params: URLSearchParams = new URLSearchParams()) {
    chart.restore(params);
    const next = { ...defaults };
    for (const key of keys) {
      const field = fields[key];
      const value = readNumberParam(params, key, field.min, field.max, 'decimal' in field);
      if (value !== undefined) next[key] = value;
    }
    next.salaryMode = readChoiceParam(params, 'salaryMode', ['gross', 'net']) ?? defaults.salaryMode;
    next.salaryPeriod = readChoiceParam(params, 'salaryPeriod', ['year', 'term']) ?? defaults.salaryPeriod;
    next.useReserve = params.get('useReserve') === 'true';
    next.startMonth = restoreStartMonth(params);
    state = next;
    startInput.value = state.startMonth;
    startInput.removeAttribute('aria-invalid');
    useReserveInput.checked = state.useReserve;
    incomeModes.forEach(input => { input.checked = input.value === state.salaryMode; });
    salaryPeriods.forEach(input => { input.checked = input.value === state.salaryPeriod; });
    budgetElement<HTMLDetailsElement>('extra-options').open = state.monthlyExtra > 0;
    budgetElement<HTMLDetailsElement>('terms').open = state.annualRate !== defaults.annualRate
      || state.years !== defaults.years || state.minimumDownPercent !== defaults.minimumDownPercent || state.bankLoanLimit !== null || state.purchaseCosts > 0;
    budgetElement<HTMLDetailsElement>('price-options').open = state.apartmentPrice !== null;
    keys.forEach(updateField);
    render();
  }

  // Include even the current month so the shared timeline stays fixed when opened later.
  return { restore, hash: () => calculatorHash('affordability', { ...state, debtChart: chart.mode }, { ...defaults, startMonth: '', debtChart: 'balance' }) };
}
