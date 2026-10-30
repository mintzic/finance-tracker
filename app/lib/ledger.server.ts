import { randomUUID, createHash } from "node:crypto";
import type Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { entries } from "../db/schema";
import { balancesSQL } from "../db/queries";
import { minor, validDate } from "./money";
export { expenseCategories, incomeCategories } from "./categories";
import { expenseCategories, incomeCategories } from "./categories";

export type Entry = {
  id: string;
  user_id: string;
  kind: string;
  date: string;
  description: string;
  amount: number;
  wallet_id: string;
  destination_id: string | null;
  category: string;
  notes: string;
  fingerprint: string | null;
  account_name?: string;
  destination_name?: string;
  receipt_id?: string;
};

export type Wallet = { id: string; name: string; opening: number; balance: number; archived: number; currency: string };

export function text(form: FormData, key: string, max = 200) {
  const value = String(form.get(key) || "").trim();
  if (!value || value.length > max) throw new Error(`Enter ${key.replaceAll("_", " ")} (up to ${max} characters).`);
  return value;
}

export function positive(value: string) {
  const amount = minor(value);
  if (amount <= 0) throw new Error("Amount must be greater than zero.");
  return amount;
}

export function owned(
  database: Database.Database,
  table: "wallets" | "entries" | "goals" | "subscriptions" | "contributions",
  id: string,
  user: string,
) {
  const row = database.prepare(`SELECT * FROM ${table} WHERE id=? AND user_id=?`).get(id, user) as
    | Record<string, unknown>
    | undefined;
  if (!row) throw new Error("Record not found.");
  return row;
}

export function parseEntry(database: Database.Database, user: string, form: FormData) {
  const kind = text(form, "kind");

  if (!["income", "expense", "transfer"].includes(kind)) {
    throw new Error("Invalid transaction type.");
  }

  const walletId = text(form, "wallet_id");
  const wallet = owned(database, "wallets", walletId, user);
  const id = String(form.get("id") || "");
  const previous = id ? owned(database, "entries", id, user) : null;

  if (wallet.archived && previous?.wallet_id !== walletId) {
    throw new Error("Choose an active account.");
  }

  let destinationId: string | null = null;

  if (kind === "transfer") {
    destinationId = text(form, "destination_id");
    const destination = owned(database, "wallets", destinationId, user);

    if (destination.archived && previous?.destination_id !== destinationId) {
      throw new Error("Choose an active destination.");
    }
    if (destinationId === walletId) {
      throw new Error("Transfer accounts must be different.");
    }
  }

  const category = kind === "transfer" ? "Transfer" : text(form, "category", 80);

  if (kind !== "transfer" && !(kind === "income" ? incomeCategories : expenseCategories).includes(category)) {
    throw new Error("Choose a valid category.");
  }
  const notes = String(form.get("notes") || "").trim();

  if (notes.length > 2000) {
    throw new Error("Notes are limited to 2,000 characters.");
  }

  return {
    id: id || randomUUID(),
    userId: user,
    kind,
    date: validDate(text(form, "date")),
    description: text(form, "description"),
    amount: positive(text(form, "amount")),
    walletId,
    destinationId,
    category,
    notes,
  };
}

export function saveEntry(database: Database.Database, user: string, form: FormData) {
  const value = parseEntry(database, user, form);

  database.transaction(() => {
    if (form.get("id")) {
      database
        .prepare(
          "UPDATE entries SET kind=?,date=?,description=?,amount=?,wallet_id=?,destination_id=?,category=?,notes=?,fingerprint=NULL WHERE id=? AND user_id=?",
        )
        .run(
          value.kind,
          value.date,
          value.description,
          value.amount,
          value.walletId,
          value.destinationId,
          value.category,
          value.notes,
          value.id,
          user,
        );
    } else {
      drizzle(database).insert(entries).values(value).run();
    }
  })();

  return value.id;
}
export function balances(database: Database.Database, user: string, through = "9999-12-31"): Wallet[] {
  return database.prepare(balancesSQL).all(through, through, user) as Wallet[];
}

export function fingerprint(entry: {
  date: string;
  kind: string;
  amount: number;
  description: string;
  walletId: string;
  destinationId: string | null;
  category: string;
  notes: string;
}) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        entry.date,
        entry.kind,
        entry.amount,
        entry.description.trim().toLowerCase(),
        entry.walletId,
        entry.destinationId,
        entry.category,
        entry.notes,
      ]),
    )
    .digest("hex");
}
