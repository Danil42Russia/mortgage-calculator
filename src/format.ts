const rubles = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const decimals = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const compact = new Intl.NumberFormat('ru-RU', { notation: 'compact', maximumFractionDigits: 1 });

export const integer = (value: number) => rubles.format(value);
export const decimal = (value: number) => decimals.format(value);
export const money = (value: number) => integer(value) + '\u00a0₽';
export const compactNumber = (value: number) => compact.format(value);

export function numberFromInput(value: string, fractional: boolean): number {
  const text = value.trim().replace(/\s/gu, '').replace(',', '.');
  const pattern = fractional ? /^-?(?:\d+(?:\.\d*)?|\.\d+)$/u : /^-?\d+$/u;
  return pattern.test(text) ? Number(text) : NaN;
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

export function formatTerm(months: number) {
  const years = Math.floor(months / 12);
  const remainder = months % 12;
  if (years === 0) return months + ' ' + monthWord(months);
  if (remainder === 0) return years + ' ' + yearWord(years);
  return years + ' ' + yearWord(years) + ' ' + remainder + ' мес.';
}
