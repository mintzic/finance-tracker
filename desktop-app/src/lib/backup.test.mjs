// Run: node --test src/lib/backup.test.mjs (no browser or native backend needed).
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import assert from 'node:assert/strict';
import test from 'node:test';
import ts from 'typescript';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
const source = readFileSync(new URL('./backup.ts', import.meta.url), 'utf8');
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const backup = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
const password = 'a long test password';
const envelope = backup.createEnvelope({ opaque: [1, 2, 3], asset: 'receipt' }, { 'folio.privacy': 'true' });

class MemoryStorage {
  values = new Map();
  get length() {
    return this.values.size;
  }
  key(index) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key) {
    return this.values.get(key) ?? null;
  }
  setItem(key, value) {
    this.values.set(key, value);
  }
  removeItem(key) {
    this.values.delete(key);
  }
}

test('plaintext roundtrip preserves opaque data and preferences', async () => {
  assert.deepEqual(await backup.decodeBackup(await backup.encodeBackup(envelope), false, ''), envelope);
});
test('encrypted roundtrip uses random salt and IV', async () => {
  const a = await backup.encodeBackup(envelope, password);
  const b = await backup.encodeBackup(envelope, password);
  assert.notEqual(JSON.parse(a).salt, JSON.parse(b).salt);
  assert.notEqual(JSON.parse(a).iv, JSON.parse(b).iv);
  assert.deepEqual(await backup.decodeBackup(a, true, password), envelope);
  await assert.rejects(backup.decodeBackup(a, true, 'incorrect password'), /wrong password/);
  const damaged = JSON.parse(a);
  damaged.ciphertext = (damaged.ciphertext[0] === 'A' ? 'B' : 'A') + damaged.ciphertext.slice(1);
  await assert.rejects(backup.decodeBackup(JSON.stringify(damaged), true, password), /damaged/);
  damaged.salt = Buffer.alloc(16).toString('base64');
  await assert.rejects(backup.decodeBackup(JSON.stringify(damaged), true, password));
});
test('rejects unsupported headers, lengths, encoding and wrong toggle', async () => {
  const encrypted = JSON.parse(await backup.encodeBackup(envelope, password));
  for (const [field, value] of [
    ['iterations', 1],
    ['iterations', 999999999],
    ['version', 2],
    ['hash', 'SHA-1'],
    ['cipher', 'AES-CBC'],
    ['kdf', 'other'],
    ['salt', 'AAAA'],
    ['iv', 'AAAA'],
    ['ciphertext', '!!!!'],
    ['extra', true],
  ]) {
    await assert.rejects(backup.decodeBackup(JSON.stringify({ ...encrypted, [field]: value }), true, password));
  }
  await assert.rejects(backup.decodeBackup(JSON.stringify(encrypted), false, ''), /Enable/);
  await assert.rejects(backup.decodeBackup(JSON.stringify(envelope), true, password), /Turn off/);
  await assert.rejects(backup.encodeBackup(envelope, 'short'), /12 characters/);
  await assert.rejects(backup.decodeBackup(JSON.stringify(encrypted), true, ''), /Enter/);
});
test('rejects malformed envelopes and preferences before returning a restore payload', () => {
  for (const value of [null, [], {}, { ...envelope, version: 2 }, { ...envelope, extra: 1 }, { ...envelope, data: null }]) {
    assert.throws(() => backup.validateEnvelope(value));
  }
  for (const prefs of [
    { arbitrary: 'true' },
    { 'folio.unknown': 'true' },
    { 'folio.privacy': 'yes' },
    { 'folio.appearance.v1': '[]' },
    { 'folio.appearance.v1': '{}' },
    { 'folio.component-appearance.v1.test': '{}' },
    { 'folio.privacy': 'x'.repeat(65537) },
    Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`folio.component-appearance.v1.${i}`, '{}'])),
  ]) {
    assert.throws(() => backup.validatePreferences(prefs));
  }
  assert.throws(() => backup.inspectBackup('not JSON'), /Invalid backup JSON/);
});
test('preferences replace only recognized keys and surface storage failures', () => {
  const storage = new MemoryStorage();
  storage.setItem('other-app', 'keep');
  storage.setItem('folio.future', 'keep');
  storage.setItem('folio.privacy', 'false');
  assert.deepEqual(backup.collectPreferences(storage), { 'folio.privacy': 'false' });
  backup.applyPreferences(storage, envelope.preferences);
  assert.equal(storage.getItem('folio.privacy'), 'true');
  backup.applyPreferences(storage, {});
  assert.equal(storage.getItem('folio.privacy'), null);
  assert.equal(storage.getItem('other-app'), 'keep');
  assert.equal(storage.getItem('folio.future'), 'keep');
  assert.throws(
    () =>
      backup.applyPreferences(
        {
          get length() {
            throw new Error('blocked');
          },
        },
        {}
      ),
    /blocked/
  );
});
test('bounded chunk conversion handles multi-chunk Unicode payloads', async () => {
  const large = backup.createEnvelope({ text: '€abc'.repeat(30000) }, {});
  assert.deepEqual(await backup.decodeBackup(await backup.encodeBackup(large, password), true, password), large);
});
test('valid appearance and component settings survive validation; aggregate preferences are bounded', () => {
  const chart = {
    legend: true,
    tooltips: true,
    animation: true,
    grid: true,
    height: 'default',
    palette: 'theme',
    thickness: '23',
    incomeColor: '',
    expenseColor: '',
    savingsColor: '',
  };
  const appearance = {
    preset: 'folio',
    font: 'mono',
    colors: Object.fromEntries(['background', 'surface', 'chrome', 'text', 'muted', 'accent', 'border'].map((name) => [name, '#123abc'])),
  };
  const prefs = { 'folio.appearance.v1': JSON.stringify(appearance), 'folio.component-appearance.v1.Spending donut': JSON.stringify(chart) };
  assert.deepEqual(backup.validatePreferences(prefs), prefs);
  const padded = JSON.stringify(chart).padEnd(65000, ' ');
  assert.throws(
    () => backup.validatePreferences(Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`folio.component-appearance.v1.Chart ${i}`, padded]))),
    /1 MiB/
  );
});
test('backend and frontend byte bounds', () => {
  assert.throws(() => backup.createEnvelope({ text: 'x'.repeat(backup.MAX_BACKEND_BYTES) }, {}), /128 MiB/);
  assert.throws(() => backup.inspectBackup(' '.repeat(backup.MAX_FILE_BYTES + 1)), /192 MiB/);
});
