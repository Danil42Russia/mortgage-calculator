import { durationAxis, SeriesChart } from './chart.ts';
import { decimal, formatTerm } from './format.ts';
import { halfRepaidMonth, summarizeSchedule } from './mortgage.ts';
import type { MortgageResult } from './mortgage.ts';

interface MortgageChartData {
  result: MortgageResult;
  baseline: MortgageResult | null;
}

const firstYear = 2026;
const calendar = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });

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
      caption.textContent = result.totalPrepayment
        ? 'Каждый столбец — год выплат. Досрочные взносы входят в основной долг.'
        : 'Каждый столбец показывает выплаты за один год.';
      canvas.setAttribute('aria-label', 'Основной долг и проценты за год. Используйте стрелки для выбора года.');
      const crossover = years.find(year => year.principal > year.interest);
      note.textContent = crossover
        ? 'В ' + (firstYear + crossover.period - 1) + ' году на погашение долга впервые уйдёт больше, чем на проценты.'
        : 'В каждом году выплаты процентов не меньше суммы погашения основного долга.';
      plot.setSeries({
        values: years.map(year => year.payment),
        stack: { lower: years.map(year => year.principal), lowerLabel: 'Основной долг', upperLabel: 'Проценты' },
        axisStep: 1,
        axisLabel: index => String(firstYear + index),
        pointLabel: index => firstYear + index + ' год',
        formatValue: value => decimal(value) + '\u00a0₽',
      });
    } else {
      caption.textContent = 'Первый платёж в расчёте — январь 2026 года.';
      canvas.setAttribute('aria-label', 'Остаток долга. Используйте стрелки для просмотра значений.');
      const half = halfRepaidMonth(result);
      let marker;
      if (half !== undefined) {
        const date = calendar.format(Date.UTC(firstYear, half - 1, 1));
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
