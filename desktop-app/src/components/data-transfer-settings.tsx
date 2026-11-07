import { useRef, useState } from 'react';
import { bridge, errorMessage } from '@/lib/bridge';
import { applyPreferences, collectPreferences, createEnvelope, decodeBackup, encodeBackup, inspectBackup, isEncrypted, MAX_FILE_BYTES } from '@/lib/backup';
import { download } from './native-assets';

const tables = ['transactions', 'accounts', 'categories', 'budgets', 'subscriptions', 'goals', 'contributions'] as const;
export type ExportTable = (typeof tables)[number];

export function DataTransferSettings({ onRestore }: { onRestore?: () => void | Promise<void> }) {
  const [mode, setMode] = useState('table');
  const [table, setTable] = useState<ExportTable>('transactions');
  const [encrypt, setEncrypt] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [decrypt, setDecrypt] = useState(false);
  const [restorePassword, setRestorePassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [restored, setRestored] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const fileSelection = useRef(0);
  const reload = async () => {
    await onRestore?.();
    window.location.reload();
  };
  const clearPasswords = () => {
    setPassword('');
    setConfirmPassword('');
    setRestorePassword('');
  };
  const run = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError('');
    setStatus('');
    try {
      await operation();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      clearPasswords();
      setBusy(false);
    }
  };
  return (
    <section className="panel form-stack data-transfer-settings" aria-busy={busy}>
      <h2>Export & backup</h2>
      <div className="editor-actions" role="group" aria-label="Data transfer mode">
        <button
          type="button"
          className={mode === 'table' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'table'}
          disabled={busy}
          onClick={() => {
            setMode('table');
            clearPasswords();
            setError('');
          }}>
          Table exports
        </button>
        <button
          type="button"
          className={mode === 'backup' ? 'primary' : 'secondary'}
          aria-pressed={mode === 'backup'}
          disabled={busy}
          onClick={() => {
            setMode('backup');
            clearPasswords();
            setError('');
          }}>
          Full backup
        </button>
      </div>
      {mode === 'table' ? (
        <form
          className="form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              download(new Blob([await bridge.exportTableCsv(table)], { type: 'text/csv;charset=utf-8' }), `folio-${table}.csv`);
              setStatus('Table export downloaded.');
            });
          }}>
          <p className="muted">
            Readable CSV for the active ledger only. Exports the full history of the selected table, regardless of current filters. CSV is not restorable and
            excludes assets and app preferences. Use Full backup for restoration.
          </p>
          <label>
            Table
            <select disabled={busy} value={table} onChange={(event) => setTable(event.target.value as ExportTable)}>
              {tables.map((name) => (
                <option key={name} value={name}>
                  {name.charAt(0).toUpperCase() + name.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <button className="primary" disabled={busy}>
            Export CSV
          </button>
        </form>
      ) : (
        <>
          <p className="muted">
            Full backup includes all ledgers, profile, receipts, cover assets, appearance, fonts, component settings and privacy preferences.
          </p>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                if (encrypt && (password.length < 12 || password !== confirmPassword)) {
                  throw new Error('Use at least 12 characters and matching passwords.');
                }

                let preferences;
                try {
                  preferences = collectPreferences(window.localStorage);
                } catch (reason) {
                  throw new Error(`Cannot read saved preferences. Backup was not exported: ${errorMessage(reason)}`);
                }
                const envelope = createEnvelope(await bridge.exportBackup(), preferences);
                const text = await encodeBackup(envelope, encrypt ? password : undefined);
                download(new Blob([text], { type: 'application/json' }), encrypt ? 'backup.folio.enc.json' : 'backup.folio.json');
                setStatus('Full backup downloaded. Keep it in a safe place.');
              });
            }}>
            <h3>Download full backup</h3>
            <label className="component-appearance-toggle">
              <span>Password-protect downloaded backup</span>
              <input
                type="checkbox"
                checked={encrypt}
                disabled={busy}
                onChange={(event) => {
                  setEncrypt(event.target.checked);
                  clearPasswords();
                }}
              />
            </label>
            {encrypt && (
              <>
                <label>
                  Password (at least 12 characters)
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    required
                    disabled={busy}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <label>
                  Confirm password
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    disabled={busy}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </label>
              </>
            )}
            <p className="small muted">
              {encrypt
                ? 'Uses PBKDF2-SHA256 (600,000 iterations) and AES-256-GCM. Lost passwords cannot be recovered. '
                : 'Without password protection, this file contains readable, unencrypted private data. '}
              Password protection applies only to the downloaded file. Folio’s live data and local restore recovery copies are unencrypted. Passwords are not
              saved.
            </p>
            <button className="primary" disabled={busy}>
              Download full backup
            </button>
          </form>
          <form
            className="form-stack"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                if (!file || file.size > MAX_FILE_BYTES) {
                  throw new Error('Choose a full backup file no larger than 192 MiB.');
                }

                if (confirmation !== 'RESTORE') {
                  throw new Error('Type RESTORE exactly to confirm replacement.');
                }

                const envelope = await decodeBackup(await file.text(), decrypt, restorePassword);
                const result = await bridge.restoreBackup(envelope.data, confirmation);

                if (result.error) {
                  throw new Error(result.error);
                }

                setRestored(true);
                setConfirmation('');
                setFile(undefined);

                if (fileInput.current) {
                  fileInput.current.value = '';
                }

                try {
                  applyPreferences(window.localStorage, envelope.preferences);
                } catch {
                  setStatus(
                    `${result.message || 'Backend data restored.'} ${result.warning || ''} Preferences could not be fully saved because local storage is unavailable or full. Reload to use restored data; appearance/privacy may not match the backup.`
                  );
                  return;
                }
                setStatus(`${result.message || 'Backup restored.'} ${result.warning || ''}`);
                await reload();
              });
            }}>
            <h3>Restore full backup</h3>
            <p className="negative">
              Restore replaces ALL ledgers, profile and assets, not just the active ledger. Saved local appearance and privacy settings are replaced too. Export
              a current backup first.
            </p>
            <p className="small muted">
              Before replacement, the backend creates UNENCRYPTED local recovery copies of previous data, even when restoring a password-protected file.
              Recovery copies remain on disk. Allow sufficient disk space.
            </p>
            <label>
              Full backup file (maximum 192 MiB)
              <input
                ref={fileInput}
                type="file"
                accept=".json,application/json"
                required
                disabled={busy}
                onChange={async (event) => {
                  const selected = event.target.files?.[0];
                  const selection = ++fileSelection.current;
                  setFile(undefined);
                  setError('');
                  setRestorePassword('');
                  setConfirmation('');
                  setRestored(false);

                  if (!selected) {
                    return;
                  }

                  try {
                    if (selected.size > MAX_FILE_BYTES) {
                      throw new Error('Backup file exceeds 192 MiB.');
                    }

                    const value = inspectBackup(await selected.text());

                    if (selection !== fileSelection.current) {
                      return;
                    }

                    setDecrypt(isEncrypted(value));
                    setFile(selected);
                  } catch (reason) {
                    if (selection === fileSelection.current) {
                      setError(errorMessage(reason));
                    }
                  }
                }}
              />
            </label>
            <label className="component-appearance-toggle">
              <span>Decrypt password-protected backup</span>
              <input
                type="checkbox"
                checked={decrypt}
                disabled={busy}
                onChange={(event) => {
                  setDecrypt(event.target.checked);
                  setRestorePassword('');
                }}
              />
            </label>
            {decrypt && (
              <label>
                Backup password
                <input
                  type="password"
                  autoComplete="off"
                  required
                  disabled={busy}
                  value={restorePassword}
                  onChange={(event) => setRestorePassword(event.target.value)}
                />
              </label>
            )}
            <label>
              Type RESTORE to confirm
              <input
                autoComplete="off"
                required
                disabled={busy}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                placeholder="RESTORE"
              />
            </label>
            <button className="primary" disabled={busy || !file || confirmation !== 'RESTORE'}>
              Replace all data & restore
            </button>
          </form>
        </>
      )}
      {busy && <p role="status">Working… large backups and password protection can take a moment.</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {status && <p role="status">{status}</p>}
      {restored && (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            void reload().catch((reason) => setError(errorMessage(reason)));
          }}>
          Reload restored app
        </button>
      )}
    </section>
  );
}
