import { formatPercentWhileEditing, groupMoneyWhileEditing } from './format.ts';

export function bindMoneyGrouping(input: HTMLInputElement, enabled = () => true) {
  input.addEventListener('beforeinput', event => {
    if (!enabled() || event.isComposing) return;
    const cursor = input.selectionStart;
    if (cursor === null || cursor !== input.selectionEnd) return;

    const backward = event.inputType === 'deleteContentBackward';
    if (!backward && event.inputType !== 'deleteContentForward') return;
    const adjacent = backward ? cursor - 1 : cursor;
    if (/\s/u.test(input.value[adjacent] ?? '')) {
      const next = cursor + (backward ? -1 : 1);
      input.setSelectionRange(next, next);
    }
  });
  bindFormatting(input, groupMoneyWhileEditing, enabled);
}

export function bindPercentFormatting(input: HTMLInputElement, enabled = () => true) {
  bindFormatting(input, formatPercentWhileEditing, enabled);
}

function bindFormatting(input: HTMLInputElement, format: typeof groupMoneyWhileEditing, enabled: () => boolean) {
  function applyFormat() {
    if (!enabled()) return;
    const start = input.selectionStart;
    if (start === null) return;

    const formatted = format(input.value, start, input.selectionEnd ?? start);
    if (formatted.value !== input.value) {
      const direction = input.selectionDirection ?? undefined;
      input.value = formatted.value;
      input.setSelectionRange(formatted.start, formatted.end, direction);
    }
  }

  input.addEventListener('input', event => {
    if (!(event instanceof InputEvent && event.isComposing)) applyFormat();
  });
  input.addEventListener('compositionend', applyFormat);
}
