import { calculateAffordability } from './affordability.ts';
import type { AffordabilityInput } from './affordability.ts';
import { decimal, integer, money, monthWord, numberFromInput } from './format.ts';
import { bindMoneyGrouping } from './money-input.ts';
import { estimateSalary2026 } from './salary.ts';
import type { SalaryEstimate } from './salary.ts';
import { MARKET_RATE } from './scenario.ts';

type BudgetState = Omit<AffordabilityInput, 'months' | 'monthlyIncome'> & { salary: number; years: number; purchaseCosts: number };
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
  salary: 150_000,
  livingCosts: 55_000,
  monthlyDebts: 0,
  monthlyRemainder: 0,
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
  livingCosts: { id: 'living', min: 0, max: moneyLimit, money: true },
  monthlyDebts: { id: 'debts', min: 0, max: moneyLimit, money: true },
  reserveMonths: { id: 'reserve-months', min: 0, max: 120 },
  annualRate: { id: 'rate', min: 0, max: 40, decimal: true },
  years: { id: 'years', min: 1, max: 40 },
  minimumDownPercent: { id: 'down-percent', min: 0, max: 99.99, decimal: true },
  maxDebtSharePercent: { id: 'debt-share', min: 0, max: 100, decimal: true },
  purchaseCosts: { id: 'purchase-costs', min: 0, max: moneyLimit, money: true },
  monthlyRemainder: { id: 'remainder', min: 0, max: moneyLimit, money: true },
} satisfies Record<keyof BudgetState, { id: string; min: number; max: number; decimal?: boolean; money?: boolean }>;

type FieldKey = keyof BudgetState;
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

function showSalaryFlow(estimate: SalaryEstimate | null, monthlyIncome: number, expenses: number, debts: number, payment: number) {
  budgetElement('salary').hidden = !estimate;
  budgetElement('open-salary').hidden = !estimate;
  if (!estimate) return;

  const body = budgetElement<HTMLTableSectionElement>('salary-rows');
  const total = budgetElement<HTMLTableSectionElement>('salary-total');
  body.replaceChildren();
  total.replaceChildren();
  budgetText('salary-average', money(monthlyIncome));

  function appendRow(section: HTMLTableSectionElement, name: string, gross: number, tax: number, net: number, months: number) {
    const row = section.insertRow();
    const month = document.createElement('th');
    month.scope = 'row';
    month.textContent = name;
    row.append(month);
    const remaining = net - (expenses + debts + payment) * months;
    for (const value of [gross, tax, net, expenses * months, debts * months, payment * months, remaining]) {
      row.insertCell().textContent = decimal(value);
    }
    row.lastElementChild?.classList.toggle('salary-deficit', remaining < 0);
    return remaining;
  }

  let deficitMonths = 0;
  for (const { month, gross, tax, net } of estimate.months) {
    if (appendRow(body, monthNames[month - 1], gross, tax, net, 1) < 0) deficitMonths += 1;
  }
  appendRow(total, 'За год', estimate.annualGross, estimate.annualTax, estimate.annualNet, estimate.months.length);
  budgetText('salary-status', deficitMonths ? 'Месяцев, в которых расходы и кредиты превышают зарплату на руки, — ' + deficitMonths + '.' : '');
  budgetElement('salary-status').hidden = deficitMonths === 0;
}

export function setupAffordability(
  canShowSchedule: (scenario: BudgetScenario) => boolean,
  showSchedule: (scenario: BudgetScenario) => void,
) {
  let state: BudgetState = { ...defaults };
  let salaryMode: 'net' | 'gross' = 'net';
  let scenario: BudgetScenario | null = null;
  const reserveButtons = document.querySelectorAll<HTMLButtonElement>('[data-reserve-months]');
  const incomeModes = document.querySelectorAll<HTMLInputElement>('input[name="budget-income-mode"]');
  const cashBar = budgetElement('cash-bar');
  const status = budgetElement('status');

  function updateField(key: FieldKey) {
    const field = fields[key];
    const input = budgetElement<HTMLInputElement>(field.id);
    const value = state[key];
    input.value = value === null ? '' : 'decimal' in field ? decimal(value) : integer(value);
    input.removeAttribute('aria-invalid');
  }

  function render() {
    const { salary, years, purchaseCosts, ...budget } = state;
    const gross = salaryMode === 'gross';
    const estimate = gross && salary ? estimateSalary2026(salary) : null;
    const monthlyIncome = estimate ? Math.floor(estimate.averageNet) : salary;
    const result = calculateAffordability({ ...budget, monthlyIncome, months: years * 12 });
    const { quote, incomeQuote } = result;
    const cash = quote ?? incomeQuote;
    const hasSavings = state.savings !== null;

    budgetText('income-label', gross ? 'Зарплата до НДФЛ в месяц' : 'Средняя зарплата на руки');
    budgetText('income-hint', estimate ? 'Расчётная средняя на руки — ' + money(monthlyIncome) + ' в месяц.'
      : gross ? 'Укажите начисленную сумму за месяц.'
      : 'Если сумма меняется, сложите выплаты после НДФЛ за 12 месяцев и разделите на 12.');
    showSalaryFlow(estimate, monthlyIncome, state.livingCosts, state.monthlyDebts, quote?.payment ?? 0);

    for (const button of reserveButtons) {
      button.setAttribute('aria-pressed', String(Number(button.dataset.reserveMonths) === state.reserveMonths));
    }

    budgetText('loan', quote ? money(quote.principal) : '—');
    budgetText('price', quote ? money(quote.price) : '—');
    budgetText('payment', quote ? decimal(quote.payment) + '\u00a0₽' : '—');
    budgetText('reserve-summary', quote ? money(quote.reserve) : '—');
    budgetElement('monthly-left').hidden = !quote;
    budgetText('monthly-left', quote ? 'После обязательных расходов и кредитов остаётся ' + money(quote.remainingIncome) + ' в месяц.' : '');
    budgetText('result-note', quote
      ? (hasSavings ? 'С учётом накоплений' : 'По доходу') + ' · все кредиты ' + decimal(quote.debtSharePercent) + '% зарплаты'
      : 'Оценка для одного заёмщика');

    let notice = '';
    if (!incomeQuote) {
      notice = monthlyIncome
        ? 'При выбранных расходах и лимите платежей месячного бюджета на ипотеку не хватает.'
        : gross ? 'Укажите зарплату до НДФЛ для расчёта.' : 'Укажите среднюю зарплату на руки для расчёта.';
    } else if (result.limitingFactor === 'savings') {
      const gap = money(result.additionalSavingsForIncomeQuote ?? 0);
      notice = quote
        ? 'По доходу доступно до ' + money(incomeQuote.principal) + '. Для такого кредита нужно ещё ' + gap + ' накоплений.'
        : 'Сейчас накоплений не хватает на взнос и подушку. Для кредита по доходу нужно ещё ' + gap + '.';
    }
    budgetText('status', notice);
    status.hidden = !notice;

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
      debts: state.monthlyDebts,
      fees: purchaseCosts,
    } : null;
    budgetElement('detail-link').hidden = !scenario || !canShowSchedule(scenario);
    return quote;
  }

  function setValue(key: FieldKey, value: number | null) {
    if (key === 'savings') state.savings = value;
    else state[key] = value ?? 0;
  }

  for (const key of keys) {
    const field = fields[key];
    const input = budgetElement<HTMLInputElement>(field.id);
    if ('money' in field) bindMoneyGrouping(input);
    input.addEventListener('input', () => {
      const empty = !input.value.trim();
      if (empty && !field.min) {
        setValue(key, key === 'savings' ? null : 0);
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
    salaryMode = input.value === 'gross' ? 'gross' : 'net';
    render();
  }));

  budgetElement('open-salary').addEventListener('click', () => {
    budgetElement('salary-title').focus({ preventScroll: true });
    budgetElement('salary').scrollIntoView();
  });

  budgetElement('open-schedule').addEventListener('click', () => {
    if (scenario && canShowSchedule(scenario)) showSchedule(scenario);
  });

  function reset() {
    state = { ...defaults };
    salaryMode = 'net';
    incomeModes.forEach(input => { input.checked = input.value === salaryMode; });
    keys.forEach(updateField);
    render();
  }

  reset();
  return reset;
}
