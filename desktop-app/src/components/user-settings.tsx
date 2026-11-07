import { useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { X } from 'lucide-react';
import type { ActionResult, Ledger, Profile, SettingsData } from '@/lib/types';
import { currencyOptions } from '@/lib/currency';
import { bridge, errorMessage } from '@/lib/bridge';

export function ProfileSettings({ profile }: { profile: Profile }) {
  const fetcher = useFetcher<ActionResult>();
  return (
    <fetcher.Form method="post" action="/settings" className="panel form-stack" key={`${profile.username}-${profile.language}`}>
      <h2>Personal details</h2>
      <input type="hidden" name="intent" value="update_profile" />
      <label>
        Username
        <input name="username" defaultValue={profile.username} required maxLength={80} />
      </label>
      <label>
        Language
        <select name="language" defaultValue={profile.language}>
          <option value="en-SG">English</option>
          <option value="zh-SG">简体中文</option>
          <option value="ms-MY">Bahasa Melayu</option>
        </select>
      </label>
      {fetcher.data?.error && (
        <p className="error" role="alert">
          {fetcher.data.error}
        </p>
      )}
      {fetcher.data?.message && (
        <p className="small positive" role="status">
          {fetcher.data.message}
        </p>
      )}
      <div>
        <button className="primary" disabled={fetcher.state !== 'idle'}>
          Save profile
        </button>
      </div>
    </fetcher.Form>
  );
}

export function SettingsForms({ settings }: { settings: SettingsData }) {
  const { profile, ledger, ledgers, defaultCurrency } = settings;
  const fetcher = useFetcher<ActionResult>();
  const pending = fetcher.state !== 'idle';
  const intent = (value: string) => <input type="hidden" name="intent" value={value} />;
  return (
    <>
      {fetcher.data?.error && (
        <p className="error" role="alert">
          {fetcher.data.error}
        </p>
      )}
      {fetcher.data?.message && <p role="status">{fetcher.data.message}</p>}
      {fetcher.data?.warning && <p role="alert">{fetcher.data.warning}</p>}
      <fetcher.Form method="post" action="/settings" className="panel form-stack" key={`${profile.username}-${profile.language}`}>
        <h2>Your profile</h2>
        {intent('update_profile')}
        <label>
          Username
          <input name="username" defaultValue={profile.username} required maxLength={80} />
        </label>
        <label>
          Language
          <select name="language" defaultValue={profile.language}>
            <option value="en-SG">English</option>
            <option value="zh-SG">简体中文</option>
            <option value="ms-MY">Bahasa Melayu</option>
          </select>
        </label>
        <button className="primary" disabled={pending}>
          Save profile
        </button>
      </fetcher.Form>
      <fetcher.Form method="post" action="/settings" className="panel form-stack" key={`create-${defaultCurrency}`}>
        <h2>Create ledger</h2>
        {intent('create_ledger')}
        <label>
          Name
          <input name="name" required maxLength={80} />
        </label>
        <label>
          Currency
          <select name="currency" defaultValue={defaultCurrency}>
            {currencyOptions(defaultCurrency).map((currency) => (
              <option key={currency}>{currency}</option>
            ))}
          </select>
        </label>
        <p className="small muted">
          Defaults to your system region’s currency, or USD if it cannot be determined. Currency belongs to this ledger and cannot be changed. Amounts are not
          converted between ledgers.
        </p>
        <button className="primary" disabled={pending}>
          Create ledger
        </button>
      </fetcher.Form>
      {ledgers.map((item) => (
        <section className="panel form-stack" key={item.id}>
          <h2>
            {item.name} · {item.currency}
            {item.id === ledger.id ? ' · Active ledger' : ''}
          </h2>
          <fetcher.Form method="post" action="/settings" className="form-stack" key={item.name}>
            {intent('update_ledger')}
            <input type="hidden" name="id" value={item.id} />
            <label>
              Ledger name
              <input name="name" defaultValue={item.name} required maxLength={80} />
            </label>
            <button className="secondary" disabled={pending}>
              Rename ledger
            </button>
          </fetcher.Form>
          <fetcher.Form method="post" action="/settings">
            {intent('switch_ledger')}
            <input type="hidden" name="id" value={item.id} />
            <button className="secondary" disabled={pending || item.id === ledger.id}>
              Switch to ledger
            </button>
          </fetcher.Form>
          <fetcher.Form method="post" action="/settings" className="form-stack">
            {intent('delete_ledger')}
            <input type="hidden" name="id" value={item.id} />
            <p className="small muted">
              Deleting this ledger removes its financial records. Make sure your financial records are backed up first. Other ledgers are unaffected.
            </p>
            <label>
              Type DELETE to confirm
              <input name="confirmation" required pattern="DELETE" autoComplete="off" disabled={ledgers.length === 1} />
            </label>
            <button className="secondary negative" disabled={pending || ledgers.length === 1}>
              Delete ledger
            </button>
            {ledgers.length === 1 && <p className="small muted">You must keep at least one ledger.</p>}
          </fetcher.Form>
        </section>
      ))}
      <fetcher.Form method="post" action="/settings" className="panel form-stack">
        <h2>Import legacy data</h2>
        {intent('import_legacy')}
        <p>
          Import before entering financial data. The default target ledger must be empty; the backend rejects a nonempty target. Quit the old app first. Choose
          its data directory containing finance.sqlite, profiles, and receipts. Backup copies are created and originals are left unchanged.
        </p>
        <label>
          Old data directory
          <input name="source" required placeholder="/Users/you/Library/Application Support/Finance Tracker" />
        </label>
        <label>
          Type IMPORT to confirm
          <input name="confirmation" required pattern="IMPORT" autoComplete="off" />
        </label>
        <button className="secondary" disabled={pending}>
          Import legacy data
        </button>
      </fetcher.Form>
    </>
  );
}

export function UserSettings({
  profile,
  ledger,
  ledgers,
  close,
  reset,
}: {
  profile: Profile;
  ledger: Ledger;
  ledgers: Ledger[];
  close: () => void;
  reset: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [settings, setSettings] = useState<SettingsData>();
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    bridge
      .settings()
      .then((value) => {
        if (active) {
          setSettings(value);
        }
      })
      .catch((reason) => {
        if (active) {
          setError(errorMessage(reason));
        }
      });
    return () => {
      active = false;
    };
  }, [profile, ledger, ledgers]);
  return (
    <dialog
      ref={dialog}
      className="user-settings-drawer"
      aria-labelledby="user-settings-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) {
          close();
        }
      }}>
      <div className="user-settings-content">
        <div className="panel-heading">
          <h2 id="user-settings-title">Settings</h2>
          <button type="button" className="icon-button" onClick={close} aria-label="Close settings">
            <X size={20} />
          </button>
        </div>
        <h3>
          Active ledger: {ledger.name} · {ledger.currency}
        </h3>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {settings ? <SettingsForms settings={settings} /> : <p role="status">Loading settings…</p>}
        <section className="form-stack user-settings-reset">
          <h3>Reset ledger</h3>
          <p className="small muted">Clear financial records only in {ledger.name}. Other ledgers are unaffected.</p>
          <button type="button" className="secondary negative" onClick={reset}>
            Reset ledger
          </button>
        </section>
      </div>
    </dialog>
  );
}
