import { Form, Link, useNavigation, useLoaderData, useActionData, redirect, type ActionFunctionArgs } from 'react-router';
import { bridge, serializeForm, errorMessage } from '@/lib/bridge';
import type { ActionResult } from '@/lib/types';
import { currencies } from '@/lib/currency';

export function loader() {
  return bridge.profiles();
}
export async function action({ request }: ActionFunctionArgs) {
  try {
    const form = await serializeForm(await request.formData());
    if (form.intent === 'import_legacy') {
      return await bridge.importLegacy(String(form.source || ''), String(form.confirmation || ''));
    }
    let result: ActionResult;
    switch (form.intent) {
      case 'create_profile':
        result = await bridge.createProfile(form);
        break;
      case 'save_profile':
        result = await bridge.updateProfile(form);
        break;
      case 'switch_profile':
        result = await bridge.switchProfile(form);
        break;
      default:
        return { error: 'Unknown profile action.' };
    }
    if (result && typeof result === 'object' && 'error' in result && result.error) {
      return { error: String(result.error) };
    }
    return form.inline === 'true' ? result : redirect('/');
  } catch (error) {
    return { error: errorMessage(error) };
  }
}
export default function Profiles() {
  const { profile, profiles } = useLoaderData<typeof loader>();
  const actionData = useActionData<ActionResult>();
  const pending = useNavigation().state !== 'idle';
  return (
    <main className="profile-page">
      <h1>{profile ? 'User settings' : 'Welcome to Folio'}</h1>
      <p className="muted">Local profiles have separate financial workspaces. No password is required.</p>
      {actionData && 'error' in actionData && actionData.error && (
        <p role="alert" className="error">
          {actionData.error}
        </p>
      )}
      {actionData?.message && <p role="status">{actionData.message}</p>}
      {!profiles.length && (
        <Form method="post" className="panel form-stack">
          <h2>Import your Electron workspace</h2>
          <input type="hidden" name="intent" value="import_legacy" />
          <p>
            Quit the old app first. Choose its data directory containing finance.sqlite, profiles, and receipts. Folio creates backup copies and leaves the
            originals unchanged. Import is only available before creating a profile.
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
            Copy existing workspace
          </button>
        </Form>
      )}
      {profile && (
        <Form method="post" className="panel form-stack" key={profile.id}>
          <h2>Change profile</h2>
          <input type="hidden" name="intent" value="save_profile" />
          <label>
            Username
            <input name="username" defaultValue={profile.username} maxLength={80} required />
          </label>
          <label>
            Language
            <select name="language" defaultValue={profile.language}>
              <option value="en-SG">English</option>
              <option value="zh-SG">简体中文</option>
              <option value="ms-MY">Bahasa Melayu</option>
            </select>
          </label>
          <label>
            Currency
            <select name="currency" defaultValue={profile.currency}>
              {currencies.map((currency) => (
                <option key={currency}>{currency}</option>
              ))}
            </select>
          </label>
          <p className="small muted">Currency applies to this whole workspace. Changing it relabels recorded amounts; it does not convert exchange rates.</p>
          <button className="primary" disabled={pending}>
            Save settings
          </button>
        </Form>
      )}
      {!!profiles.length && (
        <Form method="post" className="panel form-stack">
          <h2>Switch user</h2>
          <input type="hidden" name="intent" value="switch_profile" />
          <label>
            User
            <select name="profile_id" defaultValue={profile?.id}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.username}
                </option>
              ))}
            </select>
          </label>
          <button className="secondary" disabled={pending}>
            Open workspace
          </button>
        </Form>
      )}
      <Form method="post" className="panel form-stack">
        <h2>{profiles.length ? 'Add user' : 'What’s your username?'}</h2>
        <input type="hidden" name="intent" value="create_profile" />
        <label>
          Username
          <input name="username" required maxLength={80} autoComplete="nickname" />
        </label>
        <p className="small muted">{profiles.length ? 'Creates an empty workspace for this user.' : 'Your existing workspace will belong to this username.'}</p>
        <button className="primary" disabled={pending}>
          Create profile
        </button>
      </Form>
      {profile && (
        <Link to="/" className="text-button">
          Back to workspace
        </Link>
      )}
    </main>
  );
}
