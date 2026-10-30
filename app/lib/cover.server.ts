import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";

export function getCover(database: Database.Database) {
  return database.prepare("SELECT version,position FROM workspace_cover WHERE id=1").get() as
    { version: string; position: number } | undefined;
}

export async function updateCover(database: Database.Database, form: FormData) {
  const intent = String(form.get("intent"));
  if (intent === "remove_cover") {
    database.prepare("DELETE FROM workspace_cover WHERE id=1").run();
    return;
  }
  if (intent === "position_cover") {
    const raw = form.get("position");
    const position = Number(raw);
    if (raw === null || raw === "" || !Number.isFinite(position) || position < 0 || position > 100)
      throw new Error("Choose a cover position between 0 and 100.");
    const result = database.prepare("UPDATE workspace_cover SET position=? WHERE id=1 AND version=?")
      .run(position, String(form.get("version") || ""));
    if (!result.changes) throw new Error("The cover changed. Refresh and try again.");
    return;
  }
  if (intent !== "upload_cover") throw new Error("Invalid cover action.");
  const file = form.get("cover");
  if (!file || typeof file === "string" || !file.size) throw new Error("Choose an image.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Cover images must be no larger than 5 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ? "image/png"
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 ? "image/jpeg"
    : bytes.subarray(0,4).toString() === "RIFF" && bytes.subarray(8,12).toString() === "WEBP" ? "image/webp" : null;
  if (!mime) throw new Error("Choose a PNG, JPEG, or WebP image.");
  database.prepare("INSERT INTO workspace_cover(id,version,mime,image,position) VALUES (1,?,?,?,50) ON CONFLICT(id) DO UPDATE SET version=excluded.version,mime=excluded.mime,image=excluded.image,position=50")
    .run(randomUUID(), mime, bytes);
}
