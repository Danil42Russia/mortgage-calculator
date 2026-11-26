import assert from 'node:assert/strict';
import test from 'node:test';
import { formatPercentWhileEditing, groupMoneyWhileEditing, numberFromInput } from '../src/format.ts';
import { bindMoneyGrouping } from '../src/money-input.ts';

test('money input groups each new thousands block immediately', () => {
  assert.deepEqual(groupMoneyWhileEditing('1000', 4), { value: '1\u00a0000', start: 5, end: 5 });
  assert.deepEqual(groupMoneyWhileEditing('100\u00a00000', 8), { value: '1\u00a0000\u00a0000', start: 9, end: 9 });
});

test('money input normalizes leading zeros and pasted spaces', () => {
  assert.deepEqual(groupMoneyWhileEditing('0000', 4), { value: '0', start: 1, end: 1 });
  assert.deepEqual(groupMoneyWhileEditing('0 200\u202f000', 9), { value: '200\u00a0000', start: 7, end: 7 });
});

test('grouping keeps a middle caret or selection beside the same digits', () => {
  assert.deepEqual(groupMoneyWhileEditing('1230\u00a0000', 3), { value: '1\u00a0230\u00a0000', start: 4, end: 4 });
  assert.deepEqual(groupMoneyWhileEditing('1234567', 2, 5), { value: '1\u00a0234\u00a0567', start: 3, end: 7 });
});

test('the formatter leaves empty and partial invalid input editable', () => {
  assert.deepEqual(groupMoneyWhileEditing('', 0), { value: '', start: 0, end: 0 });
  assert.deepEqual(groupMoneyWhileEditing('12,', 3), { value: '12,', start: 3, end: 3 });
});

test('percent input strips pasted units and localizes the decimal separator immediately', () => {
  for (const raw of ['64,85\u202f%', '64.85\u00a0%', ' 64,85 % ', '64,85%', '64.85 % годовых']) {
    assert.deepEqual(formatPercentWhileEditing(raw, raw.length), { value: '64,85', start: 5, end: 5 });
    assert.equal(numberFromInput(raw, true), 64.85);
  }
});

test('percent formatting preserves a selection, a trailing comma and fractional zeros while editing', () => {
  assert.deepEqual(formatPercentWhileEditing(' 64.850 %', 2, 6), { value: '64,850', start: 1, end: 5 });
  assert.deepEqual(formatPercentWhileEditing('64.', 3), { value: '64,', start: 3, end: 3 });
  assert.deepEqual(formatPercentWhileEditing('', 0), { value: '', start: 0, end: 0 });
});

test('a percent suffix is specific to percentage fields and cannot join two different numbers', () => {
  assert.ok(Number.isNaN(numberFromInput('64 %', false)));
  assert.ok(Number.isNaN(numberFromInput('13 % и 15 %', true)));
  assert.ok(Number.isNaN(numberFromInput('6%4', true)));
});

test('committing an IME edit regroups the amount without another input event', () => {
  class TextInput extends EventTarget {
    value = '450\u00a00000';
    selectionStart = this.value.length;
    selectionEnd = this.selectionStart;

    setSelectionRange(start: number, end: number) {
      this.selectionStart = start;
      this.selectionEnd = end;
    }
  }

  const input = new TextInput();
  bindMoneyGrouping(input as unknown as HTMLInputElement);
  input.dispatchEvent(new Event('compositionend'));
  assert.equal(input.value, '4\u00a0500\u00a0000');
  assert.equal(input.selectionStart, input.value.length);
  assert.equal(input.selectionEnd, input.value.length);
});
