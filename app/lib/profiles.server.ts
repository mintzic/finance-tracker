import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { data, redirect } from "react-router";
import { workspaceDatabase, databaseContext, databasePath } from "../db/connection.server";
import { migrate } from "../../desktop/migrate.mjs";

export type Profile = { id: string; username: string; language: string; currency: string; legacy: number };
workspaceDatabase.exec(`CREATE TABLE IF NOT EXISTS local_profiles (
  id TEXT PRIMARY KEY, username TEXT NOT NULL COLLATE NOCASE UNIQUE,
  language TEXT NOT NULL DEFAULT 'en-SG', currency TEXT NOT NULL DEFAULT 'SGD', legacy INTEGER NOT NULL DEFAULT 0
)`);
const connections = new Map<string, Promise<Database.Database>>();
export const listProfiles = () =>
  workspaceDatabase.prepare("SELECT * FROM local_profiles ORDER BY username").all() as Profile[];
export function currentProfile(request: Request) {
  const id = request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("folio_profile="))
    ?.slice(14);
  return listProfiles().find((profile) => profile.id === id);
}
export function withProfile<T>(request: Request, run: (profile: Profile) => T): Promise<Awaited<T>> {
  const profile = currentProfile(request);
  if (!profile) throw redirect("/profiles");
  let connection = connections.get(profile.id);
  if (!connection) {
    connection = (async () => {
      if (profile.legacy) return workspaceDatabase;
      const path = join(dirname(databasePath), "profiles", `${profile.id}.sqlite`);
      await migrate(path, process.env.MIGRATION_DIR || resolve("migrations"));
      const db = new Database(path);
      db.pragma("foreign_keys=ON");
      db.pragma("journal_mode=WAL");
      db.pragma("busy_timeout=5000");
      return db;
    })();
    connections.set(profile.id, connection);
    connection.catch(() => connections.delete(profile.id));
  }
  return connection.then((db) => databaseContext.run(db, () => run(profile))) as Promise<Awaited<T>>;
}
export function profileAction(request: Request, form: FormData) {
  const intent = String(form.get("intent"));
  let profile: Profile | undefined;
  if (intent === "switch_profile") {
    profile = listProfiles().find((p) => p.id === form.get("profile_id"));
    if (!profile) throw new Error("Choose a profile.");
  } else {
    const username = String(form.get("username") || "").trim();
    if (!username || username.length > 80) throw new Error("Enter a username of 1–80 characters.");
    if (intent === "create_profile") {
      if (listProfiles().some((p) => p.username.toLowerCase() === username.toLowerCase()))
        throw new Error("That username already exists. Switch to that profile instead.");
      const id = randomUUID();
      workspaceDatabase
        .prepare("INSERT INTO local_profiles(id,username,legacy) VALUES (?,?,?)")
        .run(id, username, listProfiles().length ? 0 : 1);
      profile = listProfiles().find((p) => p.id === id);
    } else if (intent === "save_profile") {
      profile = currentProfile(request);
      if (!profile) throw new Error("Select a profile first.");
      const language = String(form.get("language")),
        currency = String(form.get("currency"));
      if (
        !["en-SG", "zh-SG", "ms-MY"].includes(language) ||
        !["SGD", "USD", "EUR", "GBP", "MYR", "CNY", "AUD"].includes(currency)
      )
        throw new Error("Choose a supported language and currency.");
      if (listProfiles().some((p) => p.id !== profile!.id && p.username.toLowerCase() === username.toLowerCase()))
        throw new Error("That username already exists.");
      workspaceDatabase
        .prepare("UPDATE local_profiles SET username=?,language=?,currency=? WHERE id=?")
        .run(username, language, currency, profile.id);
    } else throw new Error("Unknown profile action.");
  }
  const headers = {
    "Set-Cookie": `folio_profile=${profile!.id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`,
  };
  return form.get("inline") === "true"
    ? data({ message: intent === "save_profile" ? "Settings saved." : "Workspace opened." }, { headers })
    : redirect("/", { headers });
}
