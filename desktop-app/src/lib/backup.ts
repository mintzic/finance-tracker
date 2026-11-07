// Backend data is deliberately opaque; native restore owns schema validation.
export const MAX_BACKEND_BYTES = 128 * 1024 * 1024;
export const MAX_FILE_BYTES = 192 * 1024 * 1024;
export const MAX_PREFERENCES_BYTES = 1024 * 1024;
const MAX_PLAIN_BYTES = MAX_BACKEND_BYTES + MAX_PREFERENCES_BYTES + 4096;
const FORMAT = 'folio-backup';
const ENCRYPTED_FORMAT = 'folio-encrypted-backup';
const ITERATIONS = 600_000;
const encoder = new TextEncoder();
type Preferences = Record<string, string>;
export type BackupEnvelope = { format: typeof FORMAT; version: 1; data: unknown; preferences: Preferences };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const bytes = (value: string) => encoder.encode(value).byteLength;
export const knownPreference = (key: string) =>
  key === 'folio.privacy' || key === 'folio.appearance.v1' || /^folio\.component-appearance\.v1\.[\w .-]{1,100}$/.test(key);

function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).length !== keys.length || keys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    throw new Error('Unexpected backup fields.');
  }
}

export function validatePreferences(value: unknown): Preferences {
  if (!object(value) || Object.keys(value).length > 128) {
    throw new Error('Invalid backup preferences (maximum 128 keys).');
  }

  for (const [key, entry] of Object.entries(value)) {
    if (!knownPreference(key) || typeof entry !== 'string' || entry.length > 65_536) {
      throw new Error('Invalid or unsupported backup preference.');
    }

    if (key === 'folio.privacy') {
      if (entry !== 'true' && entry !== 'false') {
        throw new Error('Invalid privacy preference.');
      }
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(entry);
      } catch {
        throw new Error('Invalid preference JSON.');
      }

      if (!object(parsed)) {
        throw new Error('Invalid preference object.');
      }

      const color = (entry: unknown) => typeof entry === 'string' && /^#[0-9a-f]{6}$/i.test(entry);

      if (key === 'folio.appearance.v1') {
        if (
          !['folio', 'midnight', 'forest', 'paper'].includes(String(parsed.preset)) ||
          !['inter', 'system', 'humanist', 'serif', 'mono'].includes(String(parsed.font ?? 'inter')) ||
          !object(parsed.colors)
        ) {
          throw new Error('Invalid appearance preference.');
        }

        const colors = parsed.colors;

        if (!['background', 'surface', 'chrome', 'text', 'muted', 'accent', 'border'].every((field) => color(colors[field]))) {
          throw new Error('Invalid theme colors.');
        }
      } else {
        const choices: Record<string, readonly string[]> = {
          height: ['default', '220', '300', '360'],
          palette: ['theme', 'pastel', 'vivid'],
          thickness: ['16', '23', '30'],
          density: ['comfortable', 'compact'],
          fontSize: ['10', '12', '14'],
        };
        const booleans = ['legend', 'tooltips', 'animation', 'grid', 'striped', 'dividers', 'icons', 'account', 'category', 'date'];
        const colors = ['incomeColor', 'expenseColor', 'savingsColor'];
        const chartFields = ['legend', 'tooltips', 'animation', 'grid', 'height', 'palette', 'thickness', ...colors];
        const tableFields = ['density', 'fontSize', 'striped', 'dividers', 'icons', 'account', 'category', 'date'];
        exact(parsed, 'legend' in parsed ? chartFields : tableFields);
        for (const [field, candidate] of Object.entries(parsed)) {
          const valid = booleans.includes(field)
            ? typeof candidate === 'boolean'
            : colors.includes(field)
              ? candidate === '' || color(candidate)
              : typeof candidate === 'string' && choices[field]?.includes(candidate);

          if (!valid) {
            throw new Error('Invalid component appearance preference.');
          }
        }
      }
    }
  }

  if (bytes(JSON.stringify(value)) > MAX_PREFERENCES_BYTES) {
    throw new Error('Preferences exceed 1 MiB.');
  }

  return value as Preferences;
}

export function collectPreferences(storage: Storage): Preferences {
  const result: Preferences = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);

    if (key && knownPreference(key)) {
      const value = storage.getItem(key);

      if (value !== null) {
        result[key] = value;
      }
    }
  }
  return validatePreferences(result);
}

export function applyPreferences(storage: Storage, preferences: Preferences) {
  validatePreferences(preferences);
  const keys: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);

    if (key && knownPreference(key)) {
      keys.push(key);
    }
  }
  for (const key of keys) {
    storage.removeItem(key);
  }
  for (const [key, value] of Object.entries(preferences)) {
    storage.setItem(key, value);
  }
}

export function validateEnvelope(value: unknown): BackupEnvelope {
  if (!object(value) || value.format !== FORMAT || value.version !== 1) {
    throw new Error('Unsupported Folio backup format or version. Choose a full .folio.json backup.');
  }

  exact(value, ['format', 'version', 'data', 'preferences']);
  validatePreferences(value.preferences);

  if (!object(value.data) || bytes(JSON.stringify(value.data)) > MAX_BACKEND_BYTES) {
    throw new Error('Backend backup must be an object no larger than 128 MiB.');
  }

  return value as BackupEnvelope;
}

export function createEnvelope(data: unknown, preferences: Preferences): BackupEnvelope {
  return validateEnvelope({ format: FORMAT, version: 1, data, preferences });
}

function base64(value: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += 24_576) {
    chunks.push(btoa(String.fromCharCode(...value.subarray(i, i + 24_576))));
  }
  return chunks.join('');
}
function unbase64(value: unknown, min: number, max: number): Uint8Array<ArrayBuffer> {
  if (
    typeof value !== 'string' ||
    value.length > Math.ceil(max / 3) * 4 ||
    value.length % 4 !== 0 ||
    /[^A-Za-z0-9+/]/.test(value.slice(0, value.endsWith('==') ? -2 : value.endsWith('=') ? -1 : undefined))
  ) {
    throw new Error('Invalid backup base64 encoding or size.');
  }

  const result = new Uint8Array((value.length / 4) * 3 - (value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0));

  if (result.length < min || result.length > max) {
    throw new Error('Invalid encrypted backup field length.');
  }

  for (let i = 0, offset = 0; i < value.length; i += 32_768) {
    const chunk = atob(value.slice(i, i + 32_768));
    for (let j = 0; j < chunk.length; j++) {
      result[offset++] = chunk.charCodeAt(j);
    }
  }

  if (base64(result) !== value) {
    throw new Error('Noncanonical backup encoding.');
  }

  return result;
}
function cryptoApi() {
  if (!globalThis.crypto?.subtle) {
    throw new Error('WebCrypto is unavailable. Use a supported secure desktop environment.');
  }

  return globalThis.crypto;
}
async function key(password: string, salt: Uint8Array<ArrayBuffer>) {
  if (!password) {
    throw new Error('Enter the backup password.');
  }

  const api = cryptoApi();
  const material = await api.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return api.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, material, { name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
}
function header(salt: string, iv: string) {
  return { format: ENCRYPTED_FORMAT, version: 1, kdf: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, cipher: 'AES-256-GCM', salt, iv };
}
export async function encodeBackup(envelope: BackupEnvelope, password?: string): Promise<string> {
  const plaintext = JSON.stringify(validateEnvelope(envelope));

  if (password === undefined) {
    return plaintext;
  }

  if (password.length < 12) {
    throw new Error('Use a password of at least 12 characters.');
  }

  const api = cryptoApi();
  const salt = api.getRandomValues(new Uint8Array(16));
  const iv = api.getRandomValues(new Uint8Array(12));
  const metadata = header(base64(salt), base64(iv));
  const ciphertext = await api.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(JSON.stringify(metadata)), tagLength: 128 },
    await key(password, salt),
    encoder.encode(plaintext)
  );
  const output = JSON.stringify({ ...metadata, ciphertext: base64(new Uint8Array(ciphertext)) });

  if (bytes(output) > MAX_FILE_BYTES) {
    throw new Error('Backup file exceeds 192 MiB.');
  }

  return output;
}
export function inspectBackup(text: string): Record<string, unknown> {
  if (bytes(text) > MAX_FILE_BYTES) {
    throw new Error('Backup file exceeds 192 MiB.');
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Invalid backup JSON. Select a Folio full backup, not CSV.');
  }

  if (!object(value)) {
    throw new Error('Invalid backup object.');
  }

  return value;
}
export function isEncrypted(value: Record<string, unknown>) {
  return value.format === ENCRYPTED_FORMAT;
}
export async function decodeBackup(text: string, decrypt: boolean, password: string): Promise<BackupEnvelope> {
  const value = inspectBackup(text);

  if (!isEncrypted(value)) {
    if (decrypt) {
      throw new Error('This backup is not encrypted. Turn off “Decrypt password-protected backup”.');
    }

    return validateEnvelope(value);
  }

  if (!decrypt) {
    throw new Error('This backup is encrypted. Enable “Decrypt password-protected backup” and enter its password.');
  }

  exact(value, ['format', 'version', 'kdf', 'hash', 'iterations', 'cipher', 'salt', 'iv', 'ciphertext']);

  if (value.version !== 1 || value.kdf !== 'PBKDF2' || value.hash !== 'SHA-256' || value.iterations !== ITERATIONS || value.cipher !== 'AES-256-GCM') {
    throw new Error('Unsupported encrypted backup version or cryptographic parameters.');
  }

  const salt = unbase64(value.salt, 16, 16);
  const iv = unbase64(value.iv, 12, 12);
  const ciphertext = unbase64(value.ciphertext, 16, MAX_PLAIN_BYTES + 16);
  const derived = await key(password, salt);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await cryptoApi().subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: encoder.encode(JSON.stringify(header(value.salt as string, value.iv as string))), tagLength: 128 },
      derived,
      ciphertext
    );
  } catch {
    throw new Error('Unable to decrypt backup: wrong password or damaged file. No data was restored.');
  }
  return validateEnvelope(inspectBackup(new TextDecoder('utf-8', { fatal: true }).decode(plaintext)));
}
