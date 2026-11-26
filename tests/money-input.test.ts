import assert from 'node:assert/strict';
import test from 'node:test';
import { groupMoneyWhileEditing } from '../src/format.ts';

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
