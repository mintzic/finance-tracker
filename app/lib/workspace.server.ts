import { sqlite } from "../db/connection.server";

// Keep the existing owner's ID so all saved financial records remain available.
export function getWorkspace() {
  return sqlite
    .transaction(() => {
      const existing = sqlite.prepare("SELECT id, name, email FROM user ORDER BY created_at, id LIMIT 1").get() as
        | { id: string; name: string; email: string }
        | undefined;
      if (existing) return existing;

      const workspace = { id: "local-workspace", name: "My workspace", email: "workspace@localhost" };
      const now = Date.now();
      sqlite
        .prepare("INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)")
        .run(workspace.id, workspace.name, workspace.email, now, now);
      return workspace;
    })
    .immediate();
}

export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin)
    throw new Response("Invalid request origin", { status: 403 });
}
