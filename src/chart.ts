import { compactNumber, formatTerm, money, yearWord } from './format.ts';

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

export function durationAxis(month: number, last: boolean) {
  if (!last) return String(month / 12);
  return month % 12 ? formatTerm(month) : month / 12 + ' ' + yearWord(month / 12);
}

interface ChartSeries {
  values: number[];
  comparison?: { values: number[]; label: string };
  axisLabel: (index: number, last: boolean) => string;
  pointLabel: (index: number) => string;
  axisStep: number;
  formatValue?: (value: number) => string;
  fitValues?: boolean;
  marker?: { index: number; label: string };
  stack?: { lower: number[]; lowerLabel: string; upperLabel: string };
}

export class SeriesChart {
  private data: ChartSeries | null = null;
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
      this.activeMonth = this.data?.stack
        ? Math.min(this.maxMonth, Math.floor(ratio * (this.maxMonth + 1)))
        : Math.round(ratio * this.maxMonth);
      this.draw();
    };
    canvas.addEventListener('pointermove', inspect);
    canvas.addEventListener('pointerdown', inspect);
    canvas.addEventListener('pointerleave', () => this.clearSelection());
    canvas.addEventListener('blur', () => this.clearSelection());
    canvas.addEventListener('keydown', event => {
      if (!this.data) return;
      const current = this.activeMonth ?? 0;
      const intervals: Record<string, number> = { ArrowLeft: -this.data.axisStep, ArrowRight: this.data.axisStep, ArrowDown: -1, ArrowUp: 1 };
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

  setSeries(data: ChartSeries | null) {
    this.data = data;
    this.maxMonth = Math.max(0, (data?.values.length ?? 0) - 1, (data?.comparison?.values.length ?? 0) - 1);
    this.canvas.tabIndex = data?.values.length ? 0 : -1;
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
    if (!data?.values.length || width < 110) return;

    const allValues = data.values.concat(data.comparison?.values ?? []);
    const high = Math.max(0, ...allValues);
    const lowestValue = Math.min(...allValues);
    const low = data.fitValues && lowestValue > 0 && lowestValue < high
      ? Math.min(lowestValue, high * 0.95) : Math.min(0, lowestValue);
    const step = tickInterval((high - low || 1) / 4);
    const firstTick = Math.floor(low / step);
    const lastTick = Math.max(firstTick + 1, Math.ceil(high / step));
    const minimum = firstTick * step;
    const maximum = lastTick * step;
    const left = width < 410 ? 60 : 70;
    const right = width - 17;
    const top = 15;
    const bottom = height - 27;
    const slot = (right - left) / (maxMonth + 1);
    const x = data.stack ? (index: number) => left + (index + 0.5) * slot
      : (index: number) => left + index * (right - left) / Math.max(1, maxMonth);
    const y = (value: number) => bottom - (value - minimum) * (bottom - top) / (maximum - minimum);
    this.plot = { left, right, top, bottom, x, y };

    context.font = '11px system-ui, sans-serif';
    context.textBaseline = 'middle';
    context.fillStyle = '#726d85';
    context.strokeStyle = '#ebe6f3';
    context.lineWidth = 1;
    for (let index = firstTick; index <= lastTick; index += 1) {
      const value = index * step;
      const level = y(value);
      context.beginPath();
      context.moveTo(left, level);
      context.lineTo(right, level);
      context.stroke();
      context.textAlign = 'right';
      context.fillText(compactNumber(value) + ' ₽', left - 9, level);
    }

    const stride = data.axisStep * Math.max(1, Math.ceil(maxMonth / data.axisStep / (width < 410 ? 3 : 4)));
    for (let index = 0; index < maxMonth; index += stride) {
      const position = x(index);
      if (index !== 0 && position > right - 46) break;
      context.textAlign = 'center';
      context.fillText(data.axisLabel(index, false), position, height - 11);
    }
    context.textAlign = data.stack ? 'center' : 'right';
    context.fillText(data.axisLabel(maxMonth, true), x(maxMonth), height - 11);

    const stack = data.stack;
    if (stack) {
      const barWidth = Math.min(46, 0.76 * slot);
      data.values.forEach((total, index) => {
        const barLeft = x(index) - barWidth / 2;
        const split = y(stack.lower[index]);
        context.fillStyle = '#7447d4';
        context.fillRect(barLeft, split, barWidth, y(0) - split);
        context.fillStyle = '#31947e';
        context.fillRect(barLeft, y(total), barWidth, split - y(total));
      });
    } else {
      this.drawLines(context, data, this.plot);
    }
    if (this.activeMonth !== null) this.drawSelection(context, width, this.activeMonth, this.plot, data);
  }

  private drawLines(context: CanvasRenderingContext2D, data: ChartSeries, plot: Plot) {
    const { left, right, top, bottom, x, y } = plot;
    const maxMonth = this.maxMonth;
    const trace = (values: number[]) => {
      context.beginPath();
      context.moveTo(left, y(values[0]));
      for (let index = 1; index <= maxMonth; index += 1) {
        context.lineTo(x(index), y(values[index] ?? 0));
      }
    };
    trace(data.values);
    const base = Math.min(bottom, y(0));
    context.lineTo(right, base);
    context.lineTo(left, base);
    context.closePath();
    const fill = context.createLinearGradient(0, top, 0, bottom);
    fill.addColorStop(0, '#8759df35');
    fill.addColorStop(1, '#8759df08');
    context.fillStyle = fill;
    context.fill();

    if (data.comparison) {
      trace(data.comparison.values);
      context.strokeStyle = '#907bb8';
      context.setLineDash([4, 4]);
      context.lineWidth = 1.5;
      context.stroke();
      context.setLineDash([]);
    }
    trace(data.values);
    context.strokeStyle = '#7447d4';
    context.lineWidth = 2.6;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.stroke();

    if (data.marker) {
      const px = x(data.marker.index);
      const py = y(data.values[data.marker.index]);
      context.beginPath();
      context.arc(px, py, 4.5, 0, 2 * Math.PI);
      context.fillStyle = '#fff';
      context.fill();
      context.strokeStyle = '#5630ba';
      context.stroke();
      const labelWidth = context.measureText(data.marker.label).width;
      const labelX = px + 8 + labelWidth <= right ? px + 8 : Math.max(left, px - 8 - labelWidth);
      const labelY = Math.max(top, py - 13);
      context.fillStyle = '#ffffffed';
      context.fillRect(labelX - 3, labelY - 8, labelWidth + 6, 16);
      context.fillStyle = '#5630ba';
      context.textAlign = 'left';
      context.fillText(data.marker.label, labelX, labelY);
    }
  }

  private drawSelection(
    context: CanvasRenderingContext2D, width: number, month: number, plot: Plot, data: ChartSeries,
  ) {
    const value = data.values[month] ?? 0;
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
    heading.textContent = data.pointLabel(month);
    const format = data.formatValue ?? money;
    const values: (string | Node)[] = [];
    if (data.stack) {
      const lower = data.stack.lower[month];
      values.push(data.stack.lowerLabel + ' ' + format(lower),
        document.createElement('br'), data.stack.upperLabel + ' ' + format(value - lower));
    } else {
      values.push(format(value));
      if (data.comparison) {
        values.push(document.createElement('br'), data.comparison.label + ' ' + format(data.comparison.values[month] ?? 0));
      }
    }
    this.tooltip.replaceChildren(heading, ...values);
    this.tooltip.hidden = false;
    const preferred = position + 9 + this.tooltip.offsetWidth > width
      ? position - this.tooltip.offsetWidth - 9
      : position + 9;
    this.tooltip.style.left = Math.max(0, preferred) + 'px';
    this.tooltip.style.top = '4px';
  }
}
