import { durationAxis, SeriesChart } from './chart.ts';
import { decimal, firstPaymentYear, formatPaymentMonth, formatTerm } from './format.ts';
import { cumulativeBankPayments, halfRepaidMonth, summarizeSchedule } from './mortgage.ts';
import type { MortgageResult } from './mortgage.ts';

interface MortgageChartData {
  result: MortgageResult;
  baseline: MortgageResult | null;
}

const rubles = (value: number) => decimal(value) + '\u00a0₽';

export function setupBankPaymentsChart(card: HTMLElement) {
  const template = document.querySelector<HTMLTemplateElement>('#bank-payments-template')!;
  card.append(template.content.cloneNode(true));
  const plot = new SeriesChart(card.querySelector('canvas')!, card.querySelector<HTMLElement>('.chart-tooltip')!,
    card.querySelector<HTMLElement>('[role=status]')!);
  const total = card.querySelector<HTMLElement>('[data-total]')!;
  const principal = card.querySelector<HTMLElement>('[data-principal]')!;
  const overpayment = card.querySelector<HTMLElement>('[data-interest]')!;
  const ratio = card.querySelector<HTMLElement>('[data-interest-share]')!;

  return (result: MortgageResult | null) => {
    card.hidden = !result?.rows.length;
    if (!result?.rows.length) {
      plot.setSeries(null);
      return;
    }
    total.textContent = rubles(result.totalPaid);
    principal.textContent = rubles(result.principal);
    overpayment.textContent = rubles(result.totalInterest);
    ratio.textContent = decimal(100 * result.totalInterest / result.principal) + '\u00a0% от суммы кредита';
    const { paid, interest } = cumulativeBankPayments(result.rows);
    plot.setSeries({
      values: paid, label: 'Всего банку',
      comparison: { values: interest, label: 'Из них проценты' },
      axisStep: 12,
      axisLabel: durationAxis,
      pointLabel: month => month ? formatPaymentMonth(month) : 'При выдаче',
      formatValue: rubles,
    });
  };
}

export function setupMortgageChart(card: HTMLElement, onModeChange: () => void) {
  const canvas = card.querySelector('canvas')!;
  const plot = new SeriesChart(canvas, card.querySelector<HTMLElement>('.chart-tooltip')!, card.querySelector<HTMLElement>('[role=status]')!);
  const controls = card.querySelector('fieldset')!;
  const radios = controls.querySelectorAll('input');
  const caption = card.querySelector<HTMLElement>('.debt-chart-caption')!;
  const balanceLegend = card.querySelector<HTMLElement>('#chart-legend');
  const baselineLegend = card.querySelector<HTMLElement>('#base-legend');
  const paymentLegend = card.querySelector<HTMLElement>('.payment-legend')!;
  const note = card.querySelector<HTMLElement>('.debt-chart-note')!;
  canvas.setAttribute('aria-describedby', note.id);
  let mode: 'balance' | 'payments' = 'balance';
  let data: MortgageChartData | null = null;

  function render() {
    const payments = mode === 'payments';
    controls.hidden = !data;
    caption.hidden = !data;
    paymentLegend.hidden = !data || !payments;
    if (balanceLegend) balanceLegend.hidden = !data || payments;
    if (baselineLegend) baselineLegend.hidden = !data?.baseline || payments;
    note.hidden = !data;
    note.textContent = '';
    if (!data) {
      plot.setSeries(null);
      return;
    }

    const { result, baseline } = data;
    if (payments) {
      const years = summarizeSchedule(result.rows, 'year');
      const annualPayments = years.map(year => year.payment);
      caption.textContent = 'Максимум выплат за один год — ' + rubles(Math.max(...annualPayments))
        + '. Выплаты за весь срок — ' + rubles(result.totalPaid) + '.'
        + (result.totalPrepayment ? ' Досрочные взносы входят в основной долг.' : '');
      canvas.setAttribute('aria-label', 'Основной долг и проценты за год. Используйте стрелки для выбора года.');
      const crossover = years.find(year => year.principal > year.interest);
      note.textContent = crossover
        ? 'В ' + (firstPaymentYear + crossover.period - 1) + ' году на погашение долга впервые уйдёт больше, чем на проценты.'
        : 'В каждом году выплаты процентов не меньше суммы погашения основного долга.';
      plot.setSeries({
        values: annualPayments,
        valueAxisLabel: '₽ за год',
        stack: { lower: years.map(year => year.principal), lowerLabel: 'Основной долг', upperLabel: 'Проценты', totalLabel: 'Итого за год' },
        axisStep: 1,
        axisLabel: index => String(firstPaymentYear + index),
        pointLabel: index => firstPaymentYear + index + ' год',
        formatValue: rubles,
      });
    } else {
      caption.textContent = 'Первый платёж в расчёте — январь 2026 года.';
      canvas.setAttribute('aria-label', 'Остаток долга. Используйте стрелки для просмотра значений.');
      const half = halfRepaidMonth(result);
      let marker;
      if (half !== undefined) {
        const date = formatPaymentMonth(half);
        marker = { index: half, label: '50 % · ' + date };
        note.textContent = 'Погашена половина кредита — ' + date + ' (через ' + formatTerm(half) + ').';
      }
      plot.setSeries({
        values: [result.principal, ...result.rows.map(row => row.balance)],
        comparison: baseline ? { values: [baseline.principal, ...baseline.rows.map(row => row.balance)], label: 'Без досрочных' } : undefined,
        marker,
        axisStep: 12,
        axisLabel: durationAxis,
        pointLabel: month => month ? 'Через ' + formatTerm(month) : 'При выдаче',
      });
    }
  }

  for (const radio of radios) radio.addEventListener('change', () => {
    mode = radio.value === 'payments' ? 'payments' : 'balance';
    render();
    onModeChange();
  });
  return {
    get mode() { return mode; },
    restore(params: URLSearchParams) {
      mode = params.get('debtChart') === 'payments' ? 'payments' : 'balance';
      for (const radio of radios) radio.checked = radio.value === mode;
    },
    set(next: MortgageChartData | null) {
      data = next;
      render();
    },
  };
}
