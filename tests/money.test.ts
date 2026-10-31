import { test } from 'node:test';
import assert from 'node:assert/strict';
import { minor, decimal, monthRange, validDate, today } from '../app/lib/money.ts';
test('SGD decimal conversion never uses floating point arithmetic', () => {
  assert.equal(minor('0.10') + minor('0.20'), 30);
  assert.equal(minor('12.5'), 1250);
  assert.equal(minor('-0.01'), -1);
  assert.equal(decimal(12345), '123.45');
  assert.equal(decimal(-1), '-0.01');
  for (const value of ['1.001', '1e2', 'NaN', 'Infinity', '1,000.00', '9999999999999', '']) {
    assert.throws(() => minor(value));
  }
});
test('monthly ranges are half open and roll across years', () => {
  assert.deepEqual(monthRange('2026-12'), { start: '2026-12-01', end: '2027-01-01' });
  assert.deepEqual(monthRange('2024-02'), { start: '2024-02-01', end: '2024-03-01' });
  assert.throws(() => monthRange('2026-13'));
  assert.throws(() => monthRange('bad'));
});
test('calendar validation catches non-existent dates', () => {
  assert.equal(validDate('2024-02-29'), '2024-02-29');
  assert.throws(() => validDate('2026-02-29'));
  assert.throws(() => validDate('2026-04-31'));
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
});
