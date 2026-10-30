import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { X } from "lucide-react";
import type { Profile } from "../lib/profiles.server";
import type { action } from "../routes/profiles";
import { translate } from "../lib/preferences";

export function UserSettings({ profile, profiles, close, reset }: {
  profile: Profile; profiles: Profile[]; close: () => void; reset: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fetcher = useFetcher<typeof action>();
  const pending = fetcher.state !== "idle";
  const t = (text: string) => translate(profile.language, text);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const fields = (intent: string) => <>
    <input type="hidden" name="intent" value={intent} />
    <input type="hidden" name="inline" value="true" />
  </>;
  return <dialog ref={dialog} className="user-settings-drawer" aria-labelledby="user-settings-title"
    onCancel={event => { event.preventDefault(); close(); }}
    onClick={event => { if (event.target === dialog.current) close(); }}>
    <div className="user-settings-content">
      <div className="panel-heading"><h2 id="user-settings-title">{t("User settings")}</h2>
        <button type="button" className="icon-button" onClick={close} aria-label="Close user settings"><X size={20} /></button>
      </div>
      <p className="small muted">{profile.username} · Local workspace</p>
      <fetcher.Form method="post" action="/profiles" className="form-stack" key={`${profile.id}-${profile.language}-${profile.currency}-${profile.username}`}>
        {fields("save_profile")}
        <h3>{t("Change profile")}</h3>
        <label>Username<input name="username" defaultValue={profile.username} required maxLength={80} autoComplete="nickname" /></label>
        <label>{t("Change language")}<select name="language" defaultValue={profile.language}>
          <option value="en-SG">English</option><option value="zh-SG">简体中文</option><option value="ms-MY">Bahasa Melayu</option>
        </select></label>
        <label>{t("Change currency")}<select name="currency" defaultValue={profile.currency}>
          {["SGD", "USD", "EUR", "GBP", "MYR", "CNY", "AUD"].map(currency => <option key={currency}>{currency}</option>)}
        </select></label>
        <p className="small muted">Currency changes the prefix for all amounts in this workspace. Recorded amounts are not converted.</p>
        <button className="primary" disabled={pending}>{pending ? "Saving…" : "Save settings"}</button>
      </fetcher.Form>
      {fetcher.data && "error" in fetcher.data && <p className="error" role="alert">{fetcher.data.error}</p>}
      {fetcher.data && "message" in fetcher.data && <p className="small" role="status">{fetcher.data.message}</p>}
      <fetcher.Form method="post" action="/profiles" className="form-stack" key={profile.id}>
        {fields("switch_profile")}<h3>{t("Switch user")}</h3>
        <label>User<select name="profile_id" defaultValue={profile.id}>{profiles.map(user => <option key={user.id} value={user.id}>{user.username}</option>)}</select></label>
        <button className="secondary" disabled={pending}>Open workspace</button>
      </fetcher.Form>
      <fetcher.Form method="post" action="/profiles" className="form-stack">
        {fields("create_profile")}<h3>{t("Add user")}</h3>
        <label>Username<input name="username" required maxLength={80} autoComplete="off" /></label>
        <button className="secondary" disabled={pending}>Create profile</button>
      </fetcher.Form>
      <section className="form-stack user-settings-reset">
        <h3>{t("Reset workspace")}</h3>
        <p className="small muted">Clear all financial records for {profile.username}. Other users keep their workspaces.</p>
        <button type="button" className="secondary negative" onClick={reset} disabled={pending}>{t("Reset workspace")}</button>
      </section>
    </div>
  </dialog>;
}
