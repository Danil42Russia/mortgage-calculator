import { compactNumber, formatTerm, money, yearWord } from './format.ts';
import type { MortgageResult } from './mortgage.ts';

interface ChartData {
  result: MortgageResult;
  baseline: MortgageResult | null;
}

interface Plot {
  left: number;
  top: number;
  right: number;
  bottom: number;
  x: (month: number) => number;
  y: (balance: number) => number;
}

function tickInterval(value: number) {
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 2.5, 5, 10].find(step => step * magnitude >= value) ?? 10) * magnitude;
}

function balanceAt(result: MortgageResult, month: number) {
  return month === 0 ? result.principal : (result.rows[month - 1]?.balance ?? 0);
}

export class BalanceChart {
  private data: ChartData | null = null;
  private activeMonth: number | null = null;
  private maxMonth = 0;
  private plot: Plot | null = null;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly tooltip: HTMLElement,
    private readonly live: HTMLElement,
  ) {
    new ResizeObserver(() => this.draw()).observe(canvas);

    const inspect = (event: PointerEvent) => {
      if (!this.plot) return;
      const { left, right } = this.plot;
      const offset = event.clientX - canvas.getBoundingClientRect().left;
      const ratio = Math.min(1, Math.max(0, (offset - left) / (right - left)));
      this.activeMonth = Math.round(ratio * this.maxMonth);
      this.draw();
    };
    canvas.addEventListener('pointermove', inspect);
    canvas.addEventListener('pointerdown', inspect);
    canvas.addEventListener('pointerleave', () => this.clearSelection());
    canvas.addEventListener('blur', () => this.clearSelection());
    canvas.addEventListener('keydown', event => {
      if (!this.data) return;
      const current = this.activeMonth ?? 0;
      const intervals: Record<string, number> = { ArrowLeft: -12, ArrowRight: 12, ArrowDown: -1, ArrowUp: 1 };
      if (event.key === 'Escape') {
        this.clearSelection();
        return;
      }
      let next = current + (intervals[event.key] ?? 0);
      if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = this.maxMonth;
      else if (!(event.key in intervals)) return;
      event.preventDefault();
      this.activeMonth = Math.max(0, Math.min(next, this.maxMonth));
      this.draw();
      this.live.textContent = this.tooltip.innerText;
    });
  }

  set(data: ChartData | null) {
    this.data = data;
    this.maxMonth = Math.max(data?.result.rows.length ?? 0, data?.baseline?.rows.length ?? 0);
    this.canvas.tabIndex = this.maxMonth ? 0 : -1;
    if (this.activeMonth !== null) this.activeMonth = Math.min(this.activeMonth, this.maxMonth);
    this.draw();
  }

  private clearSelection() {
    this.activeMonth = null;
    this.live.textContent = '';
    this.draw();
  }

  private draw() {
    const { canvas, data, maxMonth } = this;
    const context = canvas.getContext('2d');
    if (!context) return;
    const { width, height } = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.round(width * ratio);
    const pixelHeight = Math.round(height * ratio);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    this.tooltip.hidden = true;
    this.plot = null;
    if (!data || !maxMonth || width < 110) return;

    const { result, baseline } = data;
    const step = tickInterval(result.principal / 4);
    const ticks = Math.ceil(result.principal / step);
    const maximum = ticks * step;
    const left = width < 410 ? 60 : 70;
    const right = width - 17;
    const top = 15;
    const bottom = height - 27;
    const x = (month: number) => left + month * (right - left) / maxMonth;
    const y = (balance: number) => bottom - balance * (bottom - top) / maximum;
    this.plot = { left, right, top, bottom, x, y };

    context.font = '11px system-ui, sans-serif';
    context.textBaseline = 'middle';
    context.fillStyle = '#726d85';
    context.strokeStyle = '#ebe6f3';
    context.lineWidth = 1;
    for (let index = 0; index <= ticks; index += 1) {
      const value = index * step;
      const level = y(value);
      context.beginPath();
      context.moveTo(left, level);
      context.lineTo(right, level);
      context.stroke();
      context.textAlign = 'right';
      context.fillText(compactNumber(value) + ' ₽', left - 9, level);
    }

    const wholeYears = Math.floor(maxMonth / 12);
    const yearStep = Math.max(1, Math.ceil(wholeYears / (width < 410 ? 3 : 4)));
    for (let year = 0; year * 12 <= maxMonth; year += yearStep) {
      const position = x(year * 12);
      if (year !== 0 && position > right - 46) break;
      context.textAlign = 'center';
      context.fillText(String(year), position, height - 11);
    }
    context.textAlign = 'right';
    const endLabel = maxMonth % 12 === 0 ? wholeYears + ' ' + yearWord(wholeYears) : formatTerm(maxMonth);
    context.fillText(endLabel, right, height - 11);

    const trace = (series: MortgageResult) => {
      context.beginPath();
      context.moveTo(left, y(series.principal));
      for (let month = 1; month <= maxMonth; month += 1) {
        context.lineTo(x(month), y(balanceAt(series, month)));
      }
    };
    trace(result);
    context.lineTo(right, bottom);
    context.lineTo(left, bottom);
    context.closePath();
    const fill = context.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, '#8759df35');
    fill.addColorStop(1, '#8759df08');
    context.fillStyle = fill;
    context.fill();

    if (baseline) {
      trace(baseline);
      context.strokeStyle = '#907bb8';
      context.setLineDash([4, 4]);
      context.lineWidth = 1.5;
      context.stroke();
      context.setLineDash([]);
    }
    trace(result);
    context.strokeStyle = '#7447d4';
    context.lineWidth = 2.6;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.stroke();

    if (this.activeMonth !== null) this.drawSelection(context, width, this.activeMonth, this.plot, data);
  }

  private drawSelection(
    context: CanvasRenderingContext2D, width: number, month: number, plot: Plot, data: ChartData,
  ) {
    const { result, baseline } = data;
    const value = balanceAt(result, month);
    const position = plot.x(month);

    context.beginPath();
    context.strokeStyle = '#9278c8';
    context.lineWidth = 1;
    context.moveTo(position, plot.top);
    context.lineTo(position, plot.bottom);
    context.stroke();
    context.beginPath();
    context.fillStyle = '#7447d4';
    context.arc(position, plot.y(value), 4.5, 0, 2 * Math.PI);
    context.fill();

    const heading = document.createElement('strong');
    heading.textContent = month ? 'Через ' + formatTerm(month) : 'При выдаче';
    const values = baseline
      ? [money(value), document.createElement('br'), 'Без досрочных ' + money(balanceAt(baseline, month))]
      : [money(value)];
    this.tooltip.replaceChildren(heading, ...values);
    this.tooltip.hidden = false;
    const preferred = position + 9 + this.tooltip.offsetWidth > width
      ? position - this.tooltip.offsetWidth - 9
      : position + 9;
    this.tooltip.style.left = Math.max(0, preferred) + 'px';
    this.tooltip.style.top = '4px';
  }
}
