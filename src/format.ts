const rubles = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const decimals = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });

export const integer = (value: number) => rubles.format(value);
export const decimal = (value: number) => decimals.format(value);
export const money = (value: number) => integer(value) + '\u00a0₽';
export const compactNumber = (value: number) => compact.format(value);

function percentText(value: string) {
  return value.replace(/\s/gu, '').replace(/%+(?:годовых)?$/iu, '').replace('.', ',');
}

export function numberFromInput(value: string, fractional: boolean): number {
  const text = fractional ? percentText(value).replace(',', '.') : value.replace(/\s/gu, '');
  const pattern = fractional ? /^-?(?:\d+(?:\.\d*)?|\.\d+)$/u : /^-?\d+$/u;
  return pattern.test(text) ? Number(text) : NaN;
}

export function formatPercentWhileEditing(value: string, start: number, end = start) {
  const formatted = percentText(value);
  if (formatted === value) return { value, start, end };
  const position = (offset: number) => Math.min(formatted.length, value.slice(0, offset).replace(/\s/gu, '').length);
  return { value: formatted, start: position(start), end: position(end) };
}

export function groupMoneyWhileEditing(value: string, start: number, end = start) {
  const compact = value.replace(/\s/gu, '');
  if (!/^-?\d+$/u.test(compact)) return { value, start, end };

  // Deleting a prefix can expose zeros that the user still wants to type in front of.
  const digits = /\d/u.test(value.slice(start)) ? compact : compact.replace(/^(-?)0+(?=\d)/u, '$1');
  const grouped = digits.replace(/\B(?=(?:\d{3})+(?!\d))/gu, '\u00a0');
  if (grouped === value) return { value, start, end };

  function position(offset: number) {
    let digitsToRight = value.slice(offset).replace(/\D/gu, '').length;
    const minimum = grouped.startsWith('-') && offset > value.indexOf('-') ? 1 : 0;
    let cursor = grouped.length;
    while (cursor > minimum && digitsToRight > 0) {
      cursor -= 1;
      if (/\d/u.test(grouped[cursor])) digitsToRight -= 1;
    }
    if (grouped[cursor - 1] === '\u00a0' && /\d/u.test(value[offset - 1] ?? '')) cursor -= 1;
    return cursor;
  }

  return { value: grouped, start: position(start), end: position(end) };
}

export function plural(value: number, forms: readonly [string, string, string]): string {
  const lastTwo = value % 100;
  const last = value % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return forms[2];
  if (last === 1) return forms[0];
  return last >= 2 && last <= 4 ? forms[1] : forms[2];
}

export const yearWord = (value: number) => plural(value, ['год', 'года', 'лет']);
export const monthWord = (value: number) => plural(value, ['месяц', 'месяца', 'месяцев']);

export const firstPaymentYear = 2026;
export const legacyStartMonth = firstPaymentYear + '-01';
export interface PaymentStart { year: number; month: number }

export function parseStartMonth(value: string | null): PaymentStart | undefined {
  if (!value || !/^[1-9]\d{3}-(0[1-9]|1[0-2])$/u.test(value)) return undefined;
  return { year: Number(value.slice(0, 4)), month: Number(value.slice(5)) };
}

const paymentCalendar = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const shortPaymentCalendar = new Intl.DateTimeFormat('ru-RU', { month: '2-digit', year: 'numeric', timeZone: 'UTC' });

function paymentDate(month: number, start: PaymentStart) {
  return Date.UTC(start.year, start.month + month - 2, 1);
}

export function formatPaymentMonth(month: number, start: PaymentStart = { year: firstPaymentYear, month: 1 }) {
  return paymentCalendar.format(paymentDate(month, start));
}

export function paymentAxisLabel(month: number, start: PaymentStart) {
  return month === 0 ? 'Старт' : shortPaymentCalendar.format(paymentDate(month, start));
}

export function formatPaymentPeriod(first: number, start: PaymentStart, last = first) {
  if (first === 0) return 'До первого платежа';
  if (first === last) return formatPaymentMonth(first, start) + ' · месяц ' + first;
  const dates = paymentCalendar.formatRange(paymentDate(first, start), paymentDate(last, start));
  return dates + ' · месяцы ' + first + '–' + last;
}

export function formatPaymentYear(yearIndex: number, start: PaymentStart, months: number) {
  const january = 12 * yearIndex + 2 - start.month;
  return formatPaymentPeriod(Math.max(1, january), start, Math.min(january + 11, months));
}

export function formatTerm(months: number, monthStyle: 'short' | 'long' = 'short') {
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  if (years === 0) return months + ' ' + monthWord(months);
  if (remainder === 0) return years + ' ' + yearWord(years);
  return years + ' ' + yearWord(years) + ' ' + remainder + ' ' + (monthStyle === 'long' ? monthWord(remainder) : 'мес.');
}
