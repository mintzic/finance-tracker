import { sqlite } from "../db/connection.server";
import { createHash } from "node:crypto";
export function allowLogin(email: string) {
  // Persist throttling because direct server API calls bypass HTTP-handler rate limits.
  const key = createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
  const now = Date.now(),
    window = 15 * 60 * 1000;
  return sqlite
    .transaction(() => {
      sqlite.prepare("DELETE FROM login_attempts WHERE window_start<?").run(now - window);
      const old = sqlite.prepare("SELECT attempts FROM login_attempts WHERE email=?").get(key) as
        | { attempts: number }
        | undefined;
      if (old && old.attempts >= 10) return false;
      sqlite
        .prepare("INSERT INTO login_attempts VALUES (?,1,?) ON CONFLICT(email) DO UPDATE SET attempts=attempts+1")
        .run(key, now);
      return true;
    })
    .immediate();
}
