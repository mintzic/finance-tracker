import { Form, Link, useNavigation } from 'react-router';
import type { Route } from './+types/profiles';
import { currentProfile, listProfiles, profileAction } from '../lib/profiles.server';
import { sameOrigin } from '../lib/workspace.server';
import { boundedForm } from '../lib/receipts.server';

export function loader({ request }: Route.LoaderArgs) {
  return { profile: currentProfile(request) || null, profiles: listProfiles() };
}
export async function action({ request }: Route.ActionArgs) {
  sameOrigin(request);
  try {
    return profileAction(request, await boundedForm(request));
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Unable to update profile.' };
  }
}
export default function Profiles({ loaderData: { profile, profiles }, actionData }: Route.ComponentProps) {
  const pending = useNavigation().state !== 'idle';
  return (
    <main className="profile-page">
      <h1>{profile ? 'User settings' : 'Welcome to Folio'}</h1>
      <p className="muted">Local profiles have separate financial workspaces. No password is required.</p>
      {actionData?.error && (
        <p role="alert" className="error">
          {actionData.error}
        </p>
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
              {['SGD', 'USD', 'EUR', 'GBP', 'MYR', 'CNY', 'AUD'].map((currency) => (
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
