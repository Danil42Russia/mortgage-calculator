import { BalanceChart } from './chart.ts';
import { decimal, formatTerm, integer, money, numberFromInput, yearWord } from './format.ts';
import { DEFAULT_SCENARIO, evaluateScenario, FAMILY_MONTHS, familyTerms, MARKET_RATE } from './scenario.ts';
import type { Program, Scenario } from './scenario.ts';
import { setupSchedule } from './schedule-table.ts';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing element #' + id);
  return node as T;
}

const programs = document.querySelectorAll<HTMLInputElement>('input[name=program]');
const chart = new BalanceChart(element<HTMLCanvasElement>('chart'), element('chart-tooltip'), element('chart-live'));
const updateSchedule = setupSchedule();
const save = element<HTMLButtonElement>('save');
const live = element('live');
const marketNote = element('market-note');
const limits = {
  price: [500_000, 40_000_000],
  down: [0, 40_000_000],
  rate: [0, 40],
  years: [1, 40],
  extra: [0, 40_000_000],
  extraStart: [1, 480],
  lump: [0, 40_000_000],
  lumpMonth: [1, 480],
  changeMonth: [2, 480],
  changeRate: [0, 40],
  familyRate: [0, 16],
  insurance: [0, 20],
  fees: [0, 40_000_000],
  income: [0, 40_000_000],
  debts: [0, 40_000_000],
} as const;
type NumericKey = keyof typeof limits;
const numericKeys = Object.keys(limits) as NumericKey[];
const fractional = new Set<NumericKey>(['rate', 'changeRate', 'familyRate', 'insurance']);
const sliderKeys = ['price', 'down', 'rate', 'years'] as const;
const storageKey = 'kluchi-scenarios-v1';
const maxScenarios = 3;
let state: Scenario = { ...DEFAULT_SCENARIO };
let current = evaluateScenario(state);

function loadSaved(): Scenario[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is Scenario => {
      if (typeof item !== 'object' || item === null) return false;
      if (!['market', 'family', 'custom'].includes(item.program) || !['other', 'capital'].includes(item.region)
        || !['currency', 'percent'].includes(item.downMode) || !['term', 'payment'].includes(item.goal)
        || !['annuity', 'declining'].includes(item.type) || typeof item.change !== 'boolean'
        || ![1, 2, 3, 4, 5].includes(item.children)) return false;
      return numericKeys.every(key => {
        const value = item[key];
        return (key === 'familyRate' && value === null)
          || (typeof value === 'number' && Number.isFinite(value)
            && (fractional.has(key) || Number.isInteger(value))
            && value >= limits[key][0] && value <= limits[key][1]);
      }) && item.down <= item.price;
    }).slice(0, maxScenarios);
  } catch {
    return [];
  }
}

let saved = loadSaved();
let canPersist = true;

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(saved));
  } catch {
    canPersist = false;
  }
}

function setValue(id: string, value: string) {
  element<HTMLInputElement | HTMLSelectElement>(id).value = value;
}

function message(id: string, value: string) {
  const node = element(id);
  node.textContent = value;
  node.hidden = !value;
}

function family() {
  return familyTerms(state.region, state.children);
}

function activeRate() {
  if (state.program === 'family') return family().rate;
  return state.program === 'market' ? MARKET_RATE : state.rate;
}

function downPercent() {
  return state.down / state.price * 100;
}

function bounds(key: NumericKey): readonly [number, number] {
  if (key === 'down') return [0, state.downMode === 'percent' ? 100 : state.price];
  if (key === 'familyRate') return [0, family().rate + 4];
  return limits[key];
}

function percentInput(key: NumericKey) {
  return fractional.has(key) || (key === 'down' && state.downMode === 'percent');
}

function showInputs(edited?: NumericKey) {
  for (const program of programs) program.checked = program.value === state.program;
  const isFamily = state.program === 'family';
  const familyInfo = family();
  const asPercent = state.downMode === 'percent';

  element('family-options').hidden = !isFamily;
  element('family-future').hidden = !isFamily || state.years * 12 <= FAMILY_MONTHS;
  element('refinance-toggle').hidden = isFamily;
  element('refinance-options').hidden = isFamily || !state.change;
  element('change-note').hidden = isFamily || !state.change || state.changeMonth <= state.years * 12;
  element<HTMLInputElement>('rate').disabled = isFamily;
  element<HTMLInputElement>('rate-slider').disabled = isFamily;
  setValue('region', state.region);
  setValue('children', String(state.children));
  setValue('goal', state.goal);
  setValue('type', state.type);
  element<HTMLInputElement>('change').checked = state.change;
  element('family-note').textContent = 'Лимит ' + money(familyInfo.limit) + '. Для семей, где хотя бы один ребёнок младше 7 лет.';
  element('down-unit').textContent = asPercent ? '%' : '₽';
  const unitButton = element('down-toggle');
  unitButton.textContent = asPercent ? 'Ввод в %' : decimal(downPercent()) + '%';
  unitButton.setAttribute('aria-pressed', String(asPercent));
  unitButton.setAttribute('aria-label', asPercent ? 'Вводить первоначальный взнос в рублях' : 'Вводить первоначальный взнос в процентах');
  element('years-unit').textContent = yearWord(state.years);
  element('extra-dot').hidden = !state.extra && !state.lump;

  const monthCount = state.years * 12;
  const beyond = (state.extra > 0 && state.extraStart > monthCount) || (state.lump > 0 && state.lumpMonth > monthCount);
  element('extra-note').textContent = beyond
    ? 'Взнос после окончания срока не учитывается.'
    : 'Досрочный взнос списывается после планового платежа.';

  const specialValues = {
    rate: activeRate(),
    down: asPercent ? downPercent() : state.down,
    familyRate: Math.min(state.familyRate ?? familyInfo.rate + 4, familyInfo.rate + 4),
  };
  for (const key of numericKeys) {
    if (key === edited) continue;
    const value = key in specialValues ? specialValues[key as keyof typeof specialValues] : (state[key] ?? 0);
    setValue(key, percentInput(key) ? decimal(value) : integer(value));
    element(key).removeAttribute('aria-invalid');
  }

  for (const key of sliderKeys) {
    const node = element<HTMLInputElement>(key + '-slider');
    const value = key === 'down' ? downPercent() : key === 'rate' ? activeRate() : state[key];
    node.value = String(value);
    const position = (value - Number(node.min)) / (Number(node.max) - Number(node.min));
    node.style.setProperty('--progress', (position * 100) + '%');
    if (key === 'price') node.setAttribute('aria-valuetext', money(value));
    if (key === 'down' || key === 'rate') node.setAttribute('aria-valuetext', decimal(value) + '%');
    if (key === 'years') node.setAttribute('aria-valuetext', value + ' ' + yearWord(value));
  }
}

function scenarioFingerprint(scenario: Readonly<Scenario>) {
  return JSON.stringify(Object.keys(DEFAULT_SCENARIO)
    .filter(key => key !== 'downMode')
    .map(key => scenario[key as keyof Scenario]));
}

function showResult() {
  current = evaluateScenario(state);
  const match = saved.some(scenario => scenarioFingerprint(scenario) === scenarioFingerprint(state));
  save.disabled = current.kind !== 'calculated' || !current.result.principal || saved.length >= maxScenarios || match;
  save.querySelector('.save-label')!.textContent = match ? 'Сценарий сохранён' : 'Сохранить сценарий';
  save.title = saved.length >= maxScenarios ? 'Удалите один из трёх сохранённых сценариев' : 'Сохранить параметры для сравнения';
  marketNote.hidden = state.program !== 'market';

  const data = current.kind === 'calculated' ? current : null;
  const result = data?.result;
  const principal = current.kind === 'over-limit' ? current.principal : current.result.principal;
  const hasLoan = Boolean(result?.principal);
  const firstPayment = result?.firstPayment ?? 0;
  const rate = activeRate();
  element('payment-title').textContent = state.type === 'declining' && hasLoan ? 'Первый ежемесячный платёж' : 'Ежемесячный платёж';
  element('payment').textContent = result ? money(firstPayment) : '—';
  element('payment-unit').hidden = !hasLoan;
  element('payment-note').textContent = !result
    ? 'Сумма превышает лимит семейной программы'
    : hasLoan
      ? (state.type === 'annuity' ? 'Аннуитетный платёж' : 'Дифференцированный график') + ' · ' + decimal(rate) + '% годовых'
      : 'Первоначальный взнос покрывает всю стоимость квартиры';

  element('principal').textContent = money(principal);
  element('interest').textContent = result ? money(result.totalInterest) : '—';
  element('total').textContent = result ? money(result.totalPaid) : '—';
  message('result-status', current.kind === 'over-limit'
    ? 'Лимит — ' + money(current.limit) + '. Увеличьте взнос до ' + money(state.price - current.limit) + ' или выберите свою ставку.'
    : '');

  const future = data?.rateChangeRow;
  message('future-summary', future && data ? 'С ' + future.month + '-го месяца · ' + decimal(future.annualRate) + '% годовых · платёж ' + money(future.scheduledPayment)
    : data?.input.rateChange && hasLoan ? 'Кредит погасится до изменения ставки.' : '');
  const baseline = data?.baseline;
  const earlier = baseline && result ? baseline.rows.length - result.rows.length : 0;
  message('saving-summary', baseline && result
    ? 'Досрочные взносы сэкономят ' + money(Math.max(0, baseline.totalInterest - result.totalInterest)) + ' на процентах'
      + (earlier ? '. Кредит закроется на ' + formatTerm(earlier) + ' раньше.' : '.')
    : '');
  message('ownership-summary', data && (state.insurance || state.fees)
    ? 'Расходы на квартиру с учётом взноса, страховки и расходов при покупке — ' + money(data.purchaseCost)
      + (state.insurance ? ' · страховка за весь срок ' + money(data.result.totalInsurance) : '')
    : '');
  message('income-summary', data && data.incomeShare !== null
    ? 'Первый плановый платёж и другие кредиты — ' + decimal(data.incomeShare * 100) + '% указанного месячного дохода.'
    : '');
  const notes = element('result-notes');
  notes.hidden = Array.from(notes.children).every(node => (node as HTMLElement).hidden);

  chart.set(data && hasLoan ? { result: data.result, baseline: data.baseline } : null);
  message('chart-empty', hasLoan ? '' : current.kind === 'over-limit'
    ? 'График появится после уменьшения суммы кредита.'
    : 'При покупке без кредита платежей нет.');
  element('chart-legend').hidden = !hasLoan;
  element('base-legend').hidden = !baseline;
  updateSchedule(result?.rows ?? []);
}

function render(edited?: NumericKey) {
  showInputs(edited);
  showResult();
}

function setPrice(value: number) {
  const amount = state.downMode === 'percent' ? Math.round(value * downPercent() / 100) : state.down;
  state.price = value;
  state.down = Math.min(value, amount);
}

function setNumeric(key: NumericKey, value: number, fromSlider = false) {
  switch (key) {
    case 'price': setPrice(value); break;
    case 'down':
      state.down = (fromSlider || state.downMode === 'percent') ? Math.round(state.price * value / 100) : value;
      break;
    case 'rate':
      state.rate = value;
      if (state.program === 'market' && value !== MARKET_RATE) state.program = 'custom';
      break;
    default: state[key] = value;
  }
}

for (const key of numericKeys) {
  const input = element<HTMLInputElement>(key);
  input.addEventListener('input', () => {
    const value = numberFromInput(input.value, percentInput(key));
    if (!Number.isFinite(value)) {
      input.setAttribute('aria-invalid', 'true');
      return;
    }
    const [min, max] = bounds(key);
    const clamped = Math.max(min, Math.min(max, value));
    if (value === clamped) input.removeAttribute('aria-invalid');
    else input.setAttribute('aria-invalid', 'true');
    setNumeric(key, percentInput(key) ? Math.round(clamped * 100) / 100 : clamped);
    render(key);
  });
  input.addEventListener('blur', () => {
    if (input.hasAttribute('aria-invalid') || input.value) showInputs();
    if (current.kind === 'calculated') live.textContent = 'Первый платёж ' + money(current.result.firstPayment);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') input.blur();
  });
}
for (const key of sliderKeys) {
  const slider = element<HTMLInputElement>(key + '-slider');
  slider.addEventListener('input', () => {
    setNumeric(key, slider.valueAsNumber, true);
    render();
  });
  slider.addEventListener('change', () => {
    if (current.kind === 'calculated') live.textContent = 'Первый платёж ' + money(current.result.firstPayment);
  });
}

programs.forEach(button => button.addEventListener('change', () => {
  if (button.value === 'custom') state.rate = activeRate();
  state.program = button.value as Program;
  render();
}));

for (const key of ['region', 'children', 'type', 'goal'] as const) {
  const select = element<HTMLSelectElement>(key);
  select.addEventListener('change', () => {
    if (key === 'children') state.children = Number(select.value);
    if (key === 'region') state.region = select.value as Scenario['region'];
    if (key === 'type') state.type = select.value as Scenario['type'];
    if (key === 'goal') state.goal = select.value as Scenario['goal'];
    if (key === 'children' || key === 'region') state.familyRate = null;
    render();
  });
}

element<HTMLInputElement>('change').addEventListener('change', event => {
  state.change = (event.currentTarget as HTMLInputElement).checked;
  render();
});
element('down-toggle').addEventListener('click', () => {
  state.downMode = state.downMode === 'currency' ? 'percent' : 'currency';
  showInputs();
  element('down').focus();
});

function showComparison() {
  const comparison = element('comparison');
  const container = element('scenarios');
  comparison.hidden = !saved.length;
  container.replaceChildren();
  saved.forEach((scenario, index) => {
    const data = evaluateScenario(scenario);
    if (data.kind === 'over-limit') return;
    const { result, input } = data;
    const row = document.createElement('article');
    row.className = 'scenario';
    const title = document.createElement('h3');
    title.textContent = 'Сценарий ' + (index + 1);
    const main = document.createElement('p');
    const payment = document.createElement('strong');
    payment.textContent = money(result.firstPayment);
    main.append(payment, ' · первый платёж');
    const term = document.createElement('p');
    term.textContent = decimal(input.annualRate) + '% · ' + formatTerm(result.rows.length);
    const interest = document.createElement('p');
    interest.textContent = 'Проценты — ' + money(result.totalInterest);
    const actions = document.createElement('div');
    actions.className = 'scenario-actions';
    const restore = document.createElement('button');
    restore.type = 'button';
    restore.className = 'outline-button';
    restore.textContent = 'Применить';
    restore.addEventListener('click', () => {
      state = { ...scenario };
      render();
      element('price').focus({ preventScroll: true });
      element('calculator').scrollIntoView();
      live.textContent = 'Сценарий ' + (index + 1) + ' применён';
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'outline-button';
    remove.textContent = 'Удалить';
    remove.setAttribute('aria-label', 'Удалить сценарий ' + (index + 1));
    remove.addEventListener('click', () => {
      saved.splice(index, 1);
      persist();
      showComparison();
      showResult();
      const nextButton = container.querySelector<HTMLButtonElement>('button[aria-label^="Удалить"]') ?? save;
      nextButton.focus();
      live.textContent = 'Сценарий удалён';
    });
    actions.append(restore, remove);
    row.append(title, main, term, interest, actions);
    container.append(row);
  });
}

save.addEventListener('click', () => {
  if (save.disabled) return;
  saved.push({ ...state });
  persist();
  showComparison();
  showResult();
  live.textContent = canPersist ? 'Сценарий сохранён' : 'Сценарий доступен до закрытия страницы';
  element('comparison').scrollIntoView({ block: 'nearest' });
});

element('reset').addEventListener('click', () => {
  state = { ...DEFAULT_SCENARIO };
  element<HTMLDetailsElement>('extra-details').open = false;
  element<HTMLDetailsElement>('more-details').open = false;
  render();
  live.textContent = 'Условия сброшены';
});

showComparison();
render();
