import { integer } from './format.ts';
import { summarizeSchedule } from './mortgage.ts';
import type { PaymentRow, SchedulePeriod } from './mortgage.ts';

const pageSize = 12;
const headings = ['Платежи, ₽', 'В основной долг, ₽', 'Проценты, ₽', 'Досрочно, ₽', 'Страховка, ₽', 'Остаток долга, ₽'];

function amounts(row: SchedulePeriod) {
  return [row.payment, row.principal, row.interest, row.prepayment, row.insurance, row.balance];
}

export function scheduleCsv(rows: readonly PaymentRow[], grouping: 'month' | 'year') {
  const header = [grouping === 'year' ? 'Год' : 'Месяц', ...headings].join(';');
  const data = summarizeSchedule(rows, grouping).map(row => (
    [row.period, ...amounts(row).map(value => value.toFixed(2).replace('.', ','))].join(';')
  ));
  return '\uFEFF' + [header, ...data].join('\r\n') + '\r\n';
}

export function setupSchedule() {
  const byYear = document.querySelector<HTMLButtonElement>('#by-year')!;
  const byMonth = document.querySelector<HTMLButtonElement>('#by-month')!;
  const previous = document.querySelector<HTMLButtonElement>('#previous')!;
  const next = document.querySelector<HTMLButtonElement>('#next')!;
  const download = document.querySelector<HTMLButtonElement>('#export')!;
  const rowsElement = document.querySelector<HTMLTableSectionElement>('#schedule-rows')!;
  const pagination = document.querySelector<HTMLElement>('#pagination')!;
  const heading = document.querySelector<HTMLElement>('#period-heading')!;
  const caption = document.querySelector<HTMLElement>('#schedule-caption')!;
  const pageLabel = document.querySelector<HTMLElement>('#page-label')!;

  let grouping: 'month' | 'year' = 'year';
  let page = 0;
  let rows: readonly PaymentRow[] = [];

  function render() {
    const joined = summarizeSchedule(rows, grouping);
    const pageCount = Math.ceil(joined.length / pageSize);
    page = Math.max(0, Math.min(page, pageCount - 1));
    const start = page * pageSize;
    const visible = joined.slice(start, start + pageSize);
    rowsElement.replaceChildren();

    if (visible.length) {
      for (const row of visible) {
        const tr = rowsElement.insertRow();
        tr.insertCell().textContent = String(row.period);
        for (const value of amounts(row)) tr.insertCell().textContent = integer(value);
      }
    } else {
      const cell = rowsElement.insertRow().insertCell();
      cell.colSpan = 7;
      cell.className = 'no-rows';
      cell.textContent = 'График появится после расчёта кредита.';
    }

    byYear.setAttribute('aria-pressed', String(grouping === 'year'));
    byMonth.setAttribute('aria-pressed', String(grouping === 'month'));
    heading.textContent = grouping === 'year' ? 'Год' : 'Месяц';
    caption.textContent = 'Основной долг и проценты за каждый ' + (grouping === 'year' ? 'год' : 'месяц') + ' кредита.';
    pagination.hidden = pageCount <= 1;
    previous.disabled = page <= 0;
    next.disabled = page + 1 >= pageCount;
    pageLabel.textContent = (start + 1) + '–' + (start + visible.length) + ' из ' + joined.length;
    download.disabled = !rows.length;
  }

  byYear.addEventListener('click', () => { grouping = 'year'; page = 0; render(); });
  byMonth.addEventListener('click', () => { grouping = 'month'; page = 0; render(); });
  previous.addEventListener('click', () => { page -= 1; render(); });
  next.addEventListener('click', () => { page += 1; render(); });
  download.addEventListener('click', () => {
    if (!rows.length) return;
    const url = URL.createObjectURL(new Blob([scheduleCsv(rows, grouping)], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ipoteka-' + (grouping === 'year' ? 'po-godam' : 'po-mesyatsam') + '.csv';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  return (resultRows: readonly PaymentRow[]) => {
    rows = resultRows;
    render();
  };
}
