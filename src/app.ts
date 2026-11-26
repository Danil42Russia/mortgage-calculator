import { setupAffordability } from './affordability-view.ts';
import { budgetParamsFromHash } from './calculator-uri.ts';

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error('Missing element #' + id);
  return node as T;
}

const homeLinks = document.querySelectorAll<HTMLAnchorElement>('a[href="#affordability"]');
let addressTimer: number | undefined;
const budgetView = setupAffordability(queueAddressUpdate);

function syncAddress() {
  window.clearTimeout(addressTimer);
  const hash = budgetView.hash();
  if (hash !== window.location.hash) window.history.replaceState(window.history.state, '', hash);
  for (const link of homeLinks) link.href = hash;
}

function queueAddressUpdate() {
  window.clearTimeout(addressTimer);
  addressTimer = window.setTimeout(syncAddress, 180);
}

function restoreAddress() {
  budgetView.restore(budgetParamsFromHash(window.location.hash));
  syncAddress();
}

for (const link of homeLinks) {
  link.addEventListener('click', event => {
    if (event.defaultPrevented || event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    syncAddress();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
}

let shareTimer: number | undefined;
element('share-link').addEventListener('click', async () => {
  syncAddress();
  const address = window.location.href;
  try {
    await navigator.clipboard.writeText(address);
    element('share-label').textContent = 'Скопировано';
    element('share-status').textContent = 'Ссылка на расчёт скопирована';
    window.clearTimeout(shareTimer);
    shareTimer = window.setTimeout(() => {
      element('share-label').textContent = 'Ссылка';
      element('share-status').textContent = '';
    }, 1800);
  } catch {
    const input = element<HTMLInputElement>('share-address');
    input.value = address;
    element<HTMLDialogElement>('share-dialog').showModal();
    input.select();
  }
});

element('reset').addEventListener('click', () => {
  budgetView.restore();
  syncAddress();
  element('budget-live').textContent = 'Условия расчёта по бюджету сброшены';
});

restoreAddress();
window.addEventListener('hashchange', restoreAddress);
