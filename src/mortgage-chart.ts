import { SeriesChart } from './chart.ts';
import { decimal, formatPaymentMonth, formatPaymentPerRuble, formatPaymentPeriod, formatPaymentYear, formatTerm, paymentAxisLabel } from './format.ts';
import type { PaymentStart } from './format.ts';
import { bankPaymentRatios, cumulativeBankPayments, firstMonthInterestReachesPrincipal, halfRepaidMonth, summarizeSchedule } from './mortgage.ts';
import type { MortgageResult } from './mortgage.ts';

interface MortgageChartData {
  result: MortgageResult;
  baseline: MortgageResult | null;
  start: PaymentStart;
}

const rubles = (value: number) => decimal(value) + '\u00a0₽';

const overpaymentZones = {
  green: 'Зелёная зона (до 1,5× включительно).',
  yellow: 'Жёлтая зона (свыше 1,5× до 2× включительно).',
  red: 'Красная зона (свыше 2×).',
};

export function setupBankPaymentsChart(card: HTMLElement) {
  const template = document.querySelector<HTMLTemplateElement>('#bank-payments-template')!;
  card.append(template.content.cloneNode(true));
  const plot = new SeriesChart(card.querySelector('canvas')!, card.querySelector<HTMLElement>('.chart-tooltip')!,
    card.querySelector<HTMLElement>('.chart-wrap [role=status]')!);
  const total = card.querySelector<HTMLElement>('[data-total]')!;
  const totalMultiple = card.querySelector<HTMLElement>('[data-total-multiple]')!;
  const principal = card.querySelector<HTMLElement>('[data-principal]')!;
  const overpayment = card.querySelector<HTMLElement>('[data-interest]')!;
  const interestShare = card.querySelector<HTMLElement>('[data-interest-share]')!;
  const zoneBanner = card.querySelector<HTMLElement>('.overpayment-zone')!;
  const thresholdNote = card.querySelector<HTMLElement>('[data-interest-threshold]')!;
  const comparison = card.querySelector<HTMLElement>('[data-prepayment-comparison]')!;
  const interestSaved = comparison.querySelector<HTMLElement>('[data-interest-saved]')!;
  const timeSaved = comparison.querySelector<HTMLElement>('[data-time-saved]')!;
  const multiples = comparison.querySelector<HTMLElement>('[data-interest-multiples]')!;

  return (result: MortgageResult | null, baseline: MortgageResult | null, start: PaymentStart) => {
    const ratios = result && bankPaymentRatios(result);
    card.hidden = !ratios;
    if (!result || !ratios) {
      plot.setSeries(null);
      return;
    }
    total.textContent = rubles(result.totalPaid);
    totalMultiple.textContent = decimal(ratios.total);
    principal.textContent = rubles(result.principal);
    overpayment.textContent = rubles(result.totalInterest);
    interestShare.textContent = decimal(100 * ratios.interest) + '\u00a0% от суммы кредита (' + decimal(ratios.interest) + '×)';
    zoneBanner.dataset.zone = ratios.zone;
    const notice = overpaymentZones[ratios.zone] + ' ' + formatPaymentPerRuble(ratios);
    if (zoneBanner.textContent !== notice) zoneBanner.textContent = notice;
    comparison.hidden = !baseline;
    if (baseline) {
      interestSaved.textContent = rubles(baseline.totalInterest - result.totalInterest);
      timeSaved.textContent = formatTerm(baseline.rows.length - result.rows.length, 'long');
      multiples.textContent = decimal(baseline.totalInterest / baseline.principal) + '× → ' + decimal(ratios.interest) + '×';
    }
    const { paid, interest } = cumulativeBankPayments(result.rows);
    const month = firstMonthInterestReachesPrincipal(interest, result.principal);
    let marker;
    if (month !== undefined) {
      const date = formatPaymentMonth(month, start);
      marker = { index: month, value: interest[month], label: '1× · ' + date };
      thresholdNote.textContent = 'Отметка 1× — ' + formatPaymentPeriod(month, start) + '.'
        + ' К этому моменту вы выплатите ' + rubles(interest[month]) + ' процентов по кредиту на ' + rubles(result.principal) + '.';
    } else {
      thresholdNote.textContent = 'Ипотека закроется до отметки 1×. Проценты за весь срок составят '
        + rubles(result.totalInterest) + ' — меньше суммы кредита.';
    }
    plot.setSeries({
      values: paid, label: 'Всего банку',
      comparison: { values: interest, label: 'Из них проценты' },
      marker,
      axisStep: 12,
      firstAxisIndex: 1,
      axisLabel: month => paymentAxisLabel(month, start),
      pointLabel: month => formatPaymentPeriod(month, start),
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
  const balanceLegend = card.querySelector<HTMLElement>('.balance-legend')!;
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
    balanceLegend.hidden = !data?.baseline || payments;
    note.hidden = !data;
    note.textContent = '';
    if (!data) {
      plot.setSeries(null);
      return;
    }

    const { result, baseline, start } = data;
    if (payments) {
      const years = summarizeSchedule(result.rows, 'year', start.month);
      const annualPayments = years.map(year => year.payment);
      caption.textContent = 'Максимум выплат за один год — ' + rubles(Math.max(...annualPayments))
        + '. Выплаты за весь срок — ' + rubles(result.totalPaid) + '.'
        + (result.totalPrepayment ? ' Досрочные взносы входят в основной долг.' : '');
      canvas.setAttribute('aria-label', 'Основной долг и проценты за год. Используйте стрелки для выбора года.');
      const crossover = years.find(year => year.principal > year.interest);
      note.textContent = crossover
        ? 'Первый период, когда на погашение долга уйдёт больше, чем на проценты, — '
          + formatPaymentYear(crossover.period - 1, start, result.rows.length) + '.'
        : 'В каждом году выплаты процентов не меньше суммы погашения основного долга.';
      plot.setSeries({
        values: annualPayments,
        valueAxisLabel: '₽ за год',
        stack: { lower: years.map(year => year.principal), lowerLabel: 'Основной долг', upperLabel: 'Проценты', totalLabel: 'Итого за год' },
        axisStep: 1,
        axisLabel: index => String(start.year + index),
        pointLabel: index => formatPaymentYear(index, start, result.rows.length),
        formatValue: rubles,
      });
    } else {
      caption.textContent = 'Период выплат — ' + formatPaymentPeriod(1, start, result.rows.length) + '.';
      canvas.setAttribute('aria-label', 'Остаток долга. Используйте стрелки для просмотра значений.');
      const half = halfRepaidMonth(result);
      let marker;
      if (half !== undefined) {
        const date = formatPaymentMonth(half, start);
        marker = { index: half, label: '50 % · ' + date };
        note.textContent = 'Погашена половина кредита — ' + formatPaymentPeriod(half, start) + '.';
      }
      plot.setSeries({
        values: [result.principal, ...result.rows.map(row => row.balance)],
        label: baseline ? 'С доплатой' : undefined,
        comparison: baseline ? { values: [baseline.principal, ...baseline.rows.map(row => row.balance)], label: 'Без ежемесячной доплаты' } : undefined,
        marker,
        axisStep: 12,
        firstAxisIndex: 1,
        axisLabel: month => paymentAxisLabel(month, start),
        pointLabel: month => formatPaymentPeriod(month, start),
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
