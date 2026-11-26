import { calculateAffordability } from './affordability.ts';
import type { AffordabilityInput } from './affordability.ts';
import { calculatorHash, readChoiceParam, readNumberParam } from './calculator-uri.ts';
import { BalanceChart, durationAxis, SeriesChart } from './chart.ts';
import { decimal, integer, money, monthWord, numberFromInput, yearWord } from './format.ts';
import { bindMoneyGrouping, bindPercentFormatting } from './money-input.ts';
import { calculateMortgage } from './mortgage.ts';
import { estimateSalary2026, projectSalary } from './salary.ts';
import type { SalaryBalance, SalaryEstimate, SalaryMonth } from './salary.ts';
import { MARKET_RATE } from './scenario.ts';

type BudgetState = Omit<AffordabilityInput, 'months' | 'monthlyIncome' | 'livingCosts' | 'monthlyDebts' | 'monthlyRemainder'> & {
  salary: number | null;
  salaryMode: 'net' | 'gross';
  salaryPeriod: 'year' | 'term';
  years: number;
  purchaseCosts: number;
};
export type BudgetScenario = {
  price: number;
  down: number;
  rate: number;
  years: number;
  income: number;
  debts: number;
  fees: number;
};

const defaults: Readonly<BudgetState> = {
  salary: null,
  salaryMode: 'gross',
  salaryPeriod: 'year',
  savings: null,
  purchaseCosts: 0,
  annualRate: MARKET_RATE,
  years: 20,
  minimumDownPercent: 20,
  maxDebtSharePercent: 35,
  reserveMonths: 6,
};

const moneyLimit = 1_000_000_000;
const fields = {
  salary: { id: 'income', min: 0, max: moneyLimit, money: true },
  savings: { id: 'savings', min: 0, max: moneyLimit, money: true },
  reserveMonths: { id: 'reserve-months', min: 0, max: 120 },
  annualRate: { id: 'rate', min: 0, max: 40, decimal: true },
  years: { id: 'years', min: 1, max: 40 },
  minimumDownPercent: { id: 'down-percent', min: 0, max: 99.99, decimal: true },
  maxDebtSharePercent: { id: 'debt-share', min: 0, max: 100, decimal: true },
  purchaseCosts: { id: 'purchase-costs', min: 0, max: moneyLimit, money: true },
} satisfies Record<Exclude<keyof BudgetState, 'salaryMode' | 'salaryPeriod'>, { id: string; min: number; max: number; decimal?: boolean; money?: boolean }>;

type FieldKey = keyof typeof fields;
const keys = Object.keys(fields) as FieldKey[];

function budgetElement<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById('budget-' + id) as T;
}

function budgetText(id: string, text: string) {
  budgetElement(id).textContent = text;
}

const monthNames = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];
const rateList = new Intl.ListFormat('ru-RU');
type SalaryRow = Pick<SalaryMonth, 'gross' | 'tax' | 'net'> & { rates?: readonly number[] };

function showSalaryFlow(estimate: SalaryEstimate | null, balances: SalaryBalance[]) {
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
  for (const month of estimate.months) {
    if (appendRow(body, monthNames[month.month - 1], month, balances[month.month - 1].payment) < 0) deficitMonths += 1;
  }
  const annualPayment = estimate.annualNet - balances[11].accumulated;
  appendRow(total, 'За год', { gross: estimate.annualGross, tax: estimate.annualTax, net: estimate.annualNet }, annualPayment);
  budgetText('salary-status', deficitMonths ? 'Месяцев, в которых платёж по ипотеке превышает зарплату на руки, — ' + deficitMonths + '.' : '');
  budgetElement('salary-status').hidden = deficitMonths === 0;
}

function showSalaryChart(chart: SeriesChart, balances: SalaryBalance[], period: BudgetState['salaryPeriod']) {
  if (!balances.length) {
    chart.setSeries(null);
    return;
  }
  const byMonth = period === 'year';
  const years = balances.length / 12;
  const amount = (value: number) => decimal(value) + '\u00a0₽';
  const total = byMonth ? balances[11].accumulated : balances[balances.length - 1].accumulated;
  const horizon = byMonth ? '2026 год' : years + ' ' + yearWord(years);
  budgetText('salary-chart-title', byMonth ? 'Остаток после ипотеки по месяцам' : 'Сколько накопится, если откладывать весь остаток');
  budgetText('salary-sum', 'Всего за ' + horizon + ' — ' + amount(total));
  chart.setSeries(byMonth ? {
    values: balances.slice(0, 12).map(month => month.remaining),
    axisStep: 1,
    fitValues: true,
    axisLabel: index => monthNames[index].slice(0, 3),
    pointLabel: index => monthNames[index] + ' 2026',
    formatValue: amount,
  } : {
    values: [0, ...balances.map(month => month.accumulated)],
    axisStep: 12,
    axisLabel: durationAxis,
    pointLabel: index => index ? monthNames[(index - 1) % 12] + ' ' + (2026 + Math.floor((index - 1) / 12)) : 'Начало 2026 года',
    formatValue: amount,
  });
}

export function setupAffordability(
  canShowSchedule: (scenario: BudgetScenario) => boolean,
  showSchedule: (scenario: BudgetScenario) => void,
  onChange: () => void,
) {
  let state: BudgetState = { ...defaults };
  let scenario: BudgetScenario | null = null;
  const reserveButtons = document.querySelectorAll<HTMLButtonElement>('[data-reserve-months]');
  const incomeModes = document.querySelectorAll<HTMLInputElement>('input[name="budget-income-mode"]');
  const salaryPeriods = document.querySelectorAll<HTMLInputElement>('input[name="salary-period"]');
  const cashBar = budgetElement('cash-bar');
  const status = budgetElement('status');
  const chart = new BalanceChart(
    budgetElement<HTMLCanvasElement>('chart'), budgetElement('chart-tooltip'), budgetElement('chart-live'),
  );
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
    const { salary, salaryMode, salaryPeriod, years, purchaseCosts, ...budget } = state;
    const months = years * 12;
    const gross = salaryMode === 'gross';
    const estimate = gross && salary ? estimateSalary2026(salary) : null;
    const monthlyIncome = estimate ? Math.floor(estimate.averageNet) : (salary ?? 0);
    const result = calculateAffordability({
      ...budget, monthlyIncome, months, livingCosts: 0, monthlyDebts: 0, monthlyRemainder: 0,
    });
    const { quote, incomeQuote } = result;
    const cash = quote ?? incomeQuote;
    const hasSavings = state.savings !== null;

    budgetText('income-label', gross ? 'Зарплата до НДФЛ в месяц' : 'Средняя зарплата на руки');
    budgetText('income-hint', estimate ? 'Расчётная средняя на руки — ' + money(monthlyIncome) + ' в месяц.'
      : gross ? 'Возьмите начисленную сумму за месяц из расчётного листка.'
      : 'Если сумма меняется, сложите выплаты после НДФЛ за 12 месяцев и разделите на 12.');
    budgetText('share-hint', monthlyIncome ? 'До ' + decimal(result.paymentBudget) + '\u00a0₽ в месяц из зарплаты на руки.'
      : 'Какой процент зарплаты на руки вы готовы отдавать за ипотеку.');
    budgetText('terms-summary', decimal(state.annualRate) + '% · ' + years + ' ' + yearWord(years));

    for (const button of reserveButtons) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.reserveMonths) === state.reserveMonths));
    }

    budgetText('loan', quote ? money(quote.principal) : '—');
    budgetElement('result-stats').hidden = monthlyIncome === 0;
    budgetText('price', quote ? money(quote.price) : '—');
    budgetText('payment', quote ? decimal(quote.payment) + '\u00a0₽' : '—');
    budgetText('reserve-summary', quote ? money(quote.reserve) : '—');
    budgetElement('monthly-left').hidden = !quote;
    if (quote) budgetText('monthly-left-amount', decimal(quote.remainingIncome) + '\u00a0₽');
    budgetText('result-note', quote
      ? (hasSavings ? 'С учётом накоплений' : 'По доходу') + ' · платёж ' + decimal(quote.debtSharePercent) + '% зарплаты на руки'
      : monthlyIncome ? 'Оценка для одного заёмщика' : 'Введите зарплату, чтобы начать расчёт.');

    let notice = '';
    if (!incomeQuote) {
      if (monthlyIncome) notice = 'При выбранной доле зарплаты платёж слишком мал для расчёта ипотеки.';
    } else if (result.limitingFactor === 'savings') {
      const gap = money(result.additionalSavingsForIncomeQuote ?? 0);
      notice = quote
        ? 'По доходу доступно до ' + money(incomeQuote.principal) + '. Для такого кредита нужно ещё ' + gap + ' накоплений.'
        : 'Сейчас накоплений не хватает на взнос и подушку. Для кредита по доходу нужно ещё ' + gap + '.';
    }
    budgetText('status', notice);
    status.hidden = !notice;

    const schedule = quote ? calculateMortgage({
      principal: quote.principal,
      annualRate: budget.annualRate,
      months,
      paymentType: 'annuity',
    }) : null;
    const balances = salary ? projectSalary(estimate ?? salary, months, schedule?.rows ?? []) : [];
    budgetElement('salary').hidden = !salary;
    budgetElement('open-salary').hidden = !salary;
    budgetElement('no-salary-payment').hidden = !!schedule;
    budgetText('salary-average', money(monthlyIncome));
    showSalaryChart(salaryChart, balances, salaryPeriod);
    showSalaryFlow(estimate, balances);
    chart.set(schedule ? { result: schedule, baseline: null } : null);
    budgetElement('chart-empty').hidden = schedule !== null;
    budgetText('chart-empty', monthlyIncome ? 'График появится, когда будет рассчитана сумма кредита.'
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

    scenario = quote ? {
      price: quote.price,
      down: quote.downPayment,
      rate: state.annualRate,
      years,
      income: monthlyIncome,
      debts: 0,
      fees: purchaseCosts,
    } : null;
    budgetElement('detail-link').hidden = !scenario || !canShowSchedule(scenario);
    onChange();
    return quote;
  }

  function setValue(key: FieldKey, value: number | null) {
    if (key === 'savings' || key === 'salary') state[key] = value;
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
        setValue(key, key === 'savings' || key === 'salary' ? null : 0);
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
    if (scenario && canShowSchedule(scenario)) showSchedule(scenario);
  });

  function restore(params: URLSearchParams = new URLSearchParams()) {
    const next = { ...defaults };
    for (const key of keys) {
      const field = fields[key];
      const value = readNumberParam(params, key, field.min, field.max, 'decimal' in field);
      if (value !== undefined) next[key] = value;
    }
    next.salaryMode = readChoiceParam(params, 'salaryMode', ['gross', 'net']) ?? defaults.salaryMode;
    next.salaryPeriod = readChoiceParam(params, 'salaryPeriod', ['year', 'term']) ?? defaults.salaryPeriod;
    state = next;
    incomeModes.forEach(input => { input.checked = input.value === state.salaryMode; });
    salaryPeriods.forEach(input => { input.checked = input.value === state.salaryPeriod; });
    budgetElement<HTMLDetailsElement>('terms').open = state.annualRate !== defaults.annualRate
      || state.years !== defaults.years || state.minimumDownPercent !== defaults.minimumDownPercent || state.purchaseCosts > 0;
    keys.forEach(updateField);
    render();
  }

  restore();
  return { restore, hash: () => calculatorHash('affordability', state, defaults) };
}
