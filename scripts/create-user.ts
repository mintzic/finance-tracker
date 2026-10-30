// Bootstrap is CLI-only. Public sign-up stays disabled.
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, sqlite } from "../app/db/connection.server";
if (!process.env.BETTER_AUTH_SECRET || !process.env.BETTER_AUTH_URL) throw new Error("Load .env first.");
if (sqlite.prepare("SELECT id FROM user LIMIT 1").get()) throw new Error("A private user already exists.");
const email = process.env.OWNER_EMAIL;
const password = process.env.OWNER_PASSWORD;
if (!email || !password || password.length < 12)
  throw new Error("Set OWNER_EMAIL and OWNER_PASSWORD (12+ characters).");
const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "sqlite" }),
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: { enabled: true, minPasswordLength: 12 },
});
await auth.api.signUpEmail({ body: { email, password, name: process.env.OWNER_NAME || "My workspace" } });
console.log("Private account created. Remove OWNER_PASSWORD from your environment.");
sqlite.close();
