import { parse } from "csv-parse/sync";
import type Database from "better-sqlite3";
import { parseEntry, fingerprint, saveEntry } from "./ledger.server";
import { decimal } from "./money";

export const csvHeaders = ["date", "kind", "description", "amount", "account", "destination", "category", "notes"];
export type ImportRow = {
  line: number;
  description: string;
  error?: string;
  duplicate: boolean;
  value?: ReturnType<typeof parseEntry>;
};

export function previewImport(database: Database.Database, user: string, csv: string): ImportRow[] {
  if (Buffer.byteLength(csv) > 1024 * 1024) throw new Error("CSV must be at most 1 MB.");
  const rows = parse(csv, { columns: true, bom: true, skip_empty_lines: true, max_record_size: 10000 }) as Record<
    string,
    string
  >[];
  if (!rows.length || rows.length > 1000) throw new Error("Import between 1 and 1,000 rows at a time.");
  if (!csvHeaders.every((header) => header in rows[0])) throw new Error(`Required headers: ${csvHeaders.join(",")}`);
  const wallets = database.prepare("SELECT id,name FROM wallets WHERE user_id=?").all(user) as {
    id: string;
    name: string;
  }[];
  const seen = new Set<string>();
  // Compare normalized content against all existing entries, including manually created records.
  for (const entry of database.prepare("SELECT * FROM entries WHERE user_id=?").all(user) as any[])
    seen.add(fingerprint({ ...entry, walletId: entry.wallet_id, destinationId: entry.destination_id }));
  return rows.map((row, index) => {
    try {
      const form = new FormData();
      for (const key of ["date", "kind", "description", "amount", "category", "notes"]) form.set(key, row[key] || "");
      const matching = wallets.filter((w) => w.name === row.account);
      if (matching.length !== 1) throw new Error("Account name must match exactly one account.");
      form.set("wallet_id", matching[0].id);
      if (row.kind === "transfer") {
        const destination = wallets.filter((w) => w.name === row.destination);
        if (destination.length !== 1) throw new Error("Destination must match exactly one account.");
        form.set("destination_id", destination[0].id);
      }
      const value = parseEntry(database, user, form),
        hash = fingerprint(value),
        duplicate = seen.has(hash);
      seen.add(hash);
      return { line: index + 2, description: row.description, duplicate, value };
    } catch (error) {
      return {
        line: index + 2,
        description: row.description,
        duplicate: false,
        error: error instanceof Error ? error.message : "Invalid row",
      };
    }
  });
}

export function commitImport(database: Database.Database, user: string, csv: string, policy: string) {
  if (!["skip", "reject"].includes(policy)) throw new Error("Choose a duplicate policy.");
  return database
    .transaction(() => {
      const rows = previewImport(database, user, csv);
      if (rows.some((row) => row.error)) throw new Error("Fix all invalid rows before importing.");
      if (policy === "reject" && rows.some((row) => row.duplicate))
        throw new Error("Duplicates found. Choose skip duplicates or edit the CSV.");
      let count = 0;
      for (const row of rows) {
        if (row.duplicate || !row.value) continue;
        const form = new FormData();
        const value = row.value;
        for (const [key, v] of Object.entries({
          kind: value.kind,
          date: value.date,
          description: value.description,
          amount: decimal(value.amount),
          wallet_id: value.walletId,
          destination_id: value.destinationId || "",
          category: value.category,
          notes: value.notes,
        }))
          form.set(key, v);
        saveEntry(database, user, form);
        count++;
      }
      return { imported: count, skipped: rows.length - count };
    })
    .immediate();
}

export function csvCell(value: unknown) {
  let text = String(value ?? "");
  // Protect spreadsheet users from formula injection.
  if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}
