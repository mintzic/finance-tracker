import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { redirect } from "react-router";
import { db } from "../db/connection.server";

let instance: ReturnType<typeof betterAuth> | undefined;

export function getAuth() {
  if (instance) return instance;
  const secret = process.env.BETTER_AUTH_SECRET;

  // if (!secret || secret.length < 32 || secret.startsWith("replace-"))
  //   throw new Error("Set BETTER_AUTH_SECRET to a random secret of at least 32 characters.");

  if (!process.env.BETTER_AUTH_URL) throw new Error("Set BETTER_AUTH_URL to the application origin.");
  instance = betterAuth({
    database: drizzleAdapter(db, { provider: "sqlite" }),
    secret,
    baseURL: process.env.BETTER_AUTH_URL,
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
    advanced: { cookiePrefix: "finance", useSecureCookies: process.env.NODE_ENV === "production" },
  });
  return instance;
}

export async function requireUser(request: Request) {
  const session = await getAuth().api.getSession({ headers: request.headers });
  if (!session) throw redirect("/login");
  return session.user;
}

export function sameOrigin(request: Request) {
  if (!process.env.BETTER_AUTH_URL || request.headers.get("origin") !== new URL(process.env.BETTER_AUTH_URL).origin)
    throw new Response("Invalid request origin", { status: 403 });
}
