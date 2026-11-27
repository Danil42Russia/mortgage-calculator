import { decimal, integer, numberFromInput, parseStartMonth } from './format.ts';
import type { PaymentStart } from './format.ts';
import { bindMoneyGrouping } from './money-input.ts';
import { MAX_MORTGAGE_PRINCIPAL } from './mortgage.ts';
import type { LumpPayment, MortgageResult, PrepaymentGoal } from './mortgage.ts';

interface PlannedPayment { date: string; amount: number; goal: PrepaymentGoal }

export function encodePlan(plan: readonly PlannedPayment[]) {
  return plan.map(({ date, amount, goal }) => [date, amount, goal].join(':')).join(',');
}

export function decodePlan(value: string): PlannedPayment[] {
  const plan: PlannedPayment[] = [];
  for (const item of value.split(',')) {
    const match = /^(\d{4}-\d{2})?:(\d+):(term|payment)$/u.exec(item);
    if (!match) continue;
    const [, date = '', rawAmount, goal] = match;
    const amount = Number(rawAmount);
    if ((date && !parseStartMonth(date)) || amount > MAX_MORTGAGE_PRINCIPAL) continue;
    plan.push({ date, amount, goal: goal === 'term' ? 'term' : 'payment' });
  }
  return plan;
}

function monthOf(date: string, start: PaymentStart) {
  const value = parseStartMonth(date);
  return value ? (value.year - start.year) * 12 + value.month - start.month + 1 : 0;
}

export function scheduledLumps(plan: readonly PlannedPayment[], start: PaymentStart, months: number): LumpPayment[] {
  return plan.flatMap(({ date, amount, goal }) => {
    const month = monthOf(date, start);
    return amount > 0 && month >= 1 && month <= months ? [{ month, amount, goal }] : [];
  });
}

export function setupPlannedPayments(onChange: () => void) {
  const list = document.querySelector<HTMLElement>('#budget-planned-payments')!;
  const add = document.querySelector<HTMLButtonElement>('#budget-add-payment')!;
  const template = document.querySelector<HTMLTemplateElement>('#planned-payment-template')!;
  const startInput = document.querySelector<HTMLInputElement>('#budget-start-month')!;
  const plan: PlannedPayment[] = [];

  function append(entry: PlannedPayment) {
    plan.push(entry);
    const row = template.content.firstElementChild!.cloneNode(true) as HTMLFieldSetElement;
    const amount = row.querySelector<HTMLInputElement>('[data-amount]')!;
    const date = row.querySelector<HTMLInputElement>('[data-date]')!;
    const goal = row.querySelector('select')!;
    amount.value = entry.amount ? integer(entry.amount) : '';
    date.value = entry.date;
    goal.value = entry.goal;
    bindMoneyGrouping(amount);
    amount.addEventListener('input', () => {
      const value = numberFromInput(amount.value, false);
      const valid = amount.value === '' || (value >= 0 && value <= MAX_MORTGAGE_PRINCIPAL);
      entry.amount = valid && amount.value ? value : 0;
      amount.setCustomValidity(valid ? '' : 'Введите допустимую сумму целыми рублями.');
      amount.setAttribute('aria-invalid', String(!valid));
      onChange();
    });
    date.addEventListener('input', () => { entry.date = date.value; onChange(); });
    goal.addEventListener('change', () => { entry.goal = goal.value === 'payment' ? 'payment' : 'term'; onChange(); });
    row.querySelector('button')!.addEventListener('click', () => {
      plan.splice(plan.indexOf(entry), 1);
      row.remove();
      add.focus();
      onChange();
    });
    list.append(row);
    return amount;
  }

  add.addEventListener('click', () => {
    const input = append({ date: startInput.value, amount: 0, goal: 'term' });
    onChange();
    input.focus();
  });

  return {
    plan,
    restore(value: string) {
      plan.length = 0;
      list.replaceChildren();
      decodePlan(value).forEach(append);
    },
    showApplied(start: PaymentStart, months: number, schedule: MortgageResult | null) {
      const available = schedule?.rows.map(row => Math.round((row.fromLump ?? 0) * 100)) ?? [];
      const endMonth = start.month + months - 2;
      const endYear = start.year + Math.floor(endMonth / 12);
      const endDate = endYear > 9999 ? '9999-12' : endYear + '-' + String(endMonth % 12 + 1).padStart(2, '0');
      plan.forEach((entry, index) => {
        const row = list.children[index];
        row.querySelector('legend')!.textContent = 'Досрочный платёж ' + (index + 1);
        const date = row.querySelector<HTMLInputElement>('[data-date]')!;
        const month = monthOf(entry.date, start);
        date.min = startInput.value;
        date.max = endDate;
        date.required = entry.amount > 0;
        const invalidDate = (date.required || entry.date !== '') && (month < 1 || month > months);
        date.setAttribute('aria-invalid', String(invalidDate));
        let hint = '';
        if (row.querySelector('[data-amount][aria-invalid="true"]')) hint = 'Введите сумму целыми рублями от 0 до ' + integer(MAX_MORTGAGE_PRINCIPAL) + ' ₽.';
        else if (invalidDate) hint = 'Выберите месяц в пределах срока ипотеки.';
        else if (entry.amount && schedule) {
          const applied = Math.min(available[month - 1] ?? 0, entry.amount * 100);
          available[month - 1] = (available[month - 1] ?? 0) - applied;
          hint = applied ? 'Из бюджета в этом месяце уйдёт ' + decimal(applied / 100) + ' ₽ на этот взнос.'
            : 'К этому взносу долг уже будет погашен.';
        }
        const feedback = row.querySelector<HTMLElement>('[data-feedback]')!;
        if (feedback.textContent !== hint) feedback.textContent = hint;
      });
    },
  };
}
