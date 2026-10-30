import { mkdir, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { sqlite } from "../db/connection.server";

export const receiptDirectory = resolve(process.env.RECEIPT_DIR || "data/receipts");

export async function boundedForm(request: Request) {
  const reader = request.body?.getReader();

  if (!reader) throw new Error("Empty request.");

  const chunks: Uint8Array[] = [];

  let length = 0;
  while (true) {
    const { value, done } = await reader.read();

    if (done) break;

    length += value.byteLength;

    if (length > 6 * 1024 * 1024) {
      await reader.cancel();
      throw new Error("Request exceeds 6 MB.");
    }
    chunks.push(value);
  }
  return new Response(Buffer.concat(chunks), {
    headers: { "Content-Type": request.headers.get("content-type") || "" },
  }).formData();
}

export async function stageReceipt(file: FormDataEntryValue | null) {
  if (!file || typeof file === "string" || file.size === 0) return null;
  if (file.size > 5 * 1024 * 1024) throw new Error("Receipt must be no larger than 5 MB.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime =
    bytes.subarray(0, 5).toString() === "%PDF-"
      ? "application/pdf"
      : bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
          ? "image/jpeg"
          : null;
  if (!mime) throw new Error("Only PDF, PNG, and JPEG receipts are supported.");
  await mkdir(receiptDirectory, { recursive: true, mode: 0o700 });
  const id = randomUUID();
  await writeFile(resolve(receiptDirectory, id), bytes, { flag: "wx", mode: 0o600 });
  return { id, mime, size: file.size, filename: file.name.replace(/[\r\n\x00-\x1f]/g, "").slice(0, 200) || "receipt" };
}

export async function removeReceiptFile(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid receipt ID.");
  await unlink(resolve(receiptDirectory, id)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") console.error("Receipt cleanup failed:", id);
  });
}

export function receiptFor(entry: string) {
  return sqlite.prepare("SELECT id FROM receipts WHERE entry_id=?").get(entry) as { id: string } | undefined;
}
