import { legacyStartMonth, numberFromInput, parseStartMonth } from './format.ts';

export type CalculatorRoute = 'calculator' | 'affordability' | 'schedule';

export function parseCalculatorHash(hash: string) {
  const question = hash.indexOf('?');
  const name = hash.slice(1, question < 0 ? undefined : question);
  const route: CalculatorRoute = name === 'affordability' || name === 'schedule' ? name : 'calculator';
  return { route, params: new URLSearchParams(question < 0 ? '' : hash.slice(question + 1)) };
}

export function budgetParamsFromHash(hash: string) {
  const { route, params } = parseCalculatorHash(hash);
  return route === 'affordability' ? params : new URLSearchParams();
}

export function restoreStartMonth(params: URLSearchParams, today = new Date()): string {
  const value = params.get('startMonth');
  if (value && parseStartMonth(value)) return value;
  if (params.size) return legacyStartMonth;
  return today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
}

export function calculatorHash<T extends object>(route: CalculatorRoute, state: T, defaults: Readonly<T>) {
  const params = new URLSearchParams();
  for (const key of Object.keys(defaults) as Array<keyof T & string>) {
    const value = state[key];
    if (value !== defaults[key]) params.set(key, String(value ?? ''));
  }
  return '#' + route + (params.size ? '?' + params.toString() : '');
}

export function readNumberParam(params: URLSearchParams, key: string, min: number, max: number, fractional = false) {
  const value = numberFromInput(params.get(key) ?? '', fractional);
  if (!Number.isFinite(value)) return undefined;
  const clamped = Math.min(max, Math.max(min, value));
  return fractional ? Math.round(clamped * 100) / 100 : clamped;
}

export function readChoiceParam<T extends string>(params: URLSearchParams, key: string, choices: readonly T[]) {
  const value = params.get(key);
  return choices.find(choice => choice === value);
}
