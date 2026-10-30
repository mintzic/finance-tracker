import { randomUUID } from "node:crypto";
import { sqlite } from "../db/connection.server";
import { owned, positive, text, saveEntry, expenseCategories } from "./ledger.server";
import { minor, monthRange, validDate, today } from "./money";
import { commitImport, previewImport, type ImportRow } from "./import.server";
import { stageReceipt, receiptFor, removeReceiptFile } from "./receipts.server";

export type ActionResult = { error?: string; message?: string; preview?: ImportRow[]; csv?: string };

export async function mutate(user: string, form: FormData): Promise<ActionResult> {
  const intent = text(form, "intent");
  const id = String(form.get("id") || "");

  if (intent === "entry") {
    const receipt = await stageReceipt(form.get("receipt"));
    let previous: { id: string } | undefined;

    try {
      sqlite.transaction(() => {
        const entryId = saveEntry(sqlite, user, form);
        previous = receiptFor(entryId, user);
        if (receipt || form.get("remove_receipt") === "on")
          sqlite.prepare("DELETE FROM receipts WHERE entry_id=? AND user_id=?").run(entryId, user);
        if (receipt)
          sqlite
            .prepare("INSERT INTO receipts(id,user_id,entry_id,filename,mime,size) VALUES (?,?,?,?,?,?)")
            .run(receipt.id, user, entryId, receipt.filename, receipt.mime, receipt.size);
      })();
    } catch (error) {
      if (receipt) await removeReceiptFile(receipt.id);
      throw error;
    }

    if (previous && (receipt || form.get("remove_receipt") === "on")) await removeReceiptFile(previous.id);
    return { message: "Transaction saved." };
  }

  if (intent === "delete_entry") {
    owned(sqlite, "entries", id, user);
    const receipt = receiptFor(id, user);
    sqlite.prepare("DELETE FROM entries WHERE id=? AND user_id=?").run(id, user);
    if (receipt) await removeReceiptFile(receipt.id);
    return { message: "Transaction deleted. Account balances updated." };
  }

  if (intent === "wallet") {
    const name = text(form, "name", 80),
      opening = minor(text(form, "opening"));
    if (id) {
      owned(sqlite, "wallets", id, user);
      sqlite
        .prepare("UPDATE wallets SET name=?,opening=?,archived=? WHERE id=? AND user_id=?")
        .run(name, opening, form.get("archived") === "on" ? 1 : 0, id, user);
    } else
      sqlite
        .prepare("INSERT INTO wallets(id,user_id,name,opening) VALUES (?,?,?,?)")
        .run(randomUUID(), user, name, opening);
    return { message: "Account saved. Balances recalculated." };
  }

  if (intent === "budget") {
    const month = text(form, "month");
    monthRange(month);
    const category = text(form, "category");
    if (!expenseCategories.includes(category)) throw new Error("Choose an expense category.");
    sqlite
      .prepare(
        "INSERT INTO budgets(id,user_id,month,category,amount) VALUES (?,?,?,?,?) ON CONFLICT(user_id,month,category) DO UPDATE SET amount=excluded.amount",
      )
      .run(randomUUID(), user, month, category, positive(text(form, "amount")));
  } else if (intent === "delete_budget") {
    sqlite.prepare("DELETE FROM budgets WHERE id=? AND user_id=?").run(id, user);
  } else if (intent === "subscription") {
    const wallet = text(form, "wallet_id");
    const w = owned(sqlite, "wallets", wallet, user);

    if (id) {
      owned(sqlite, "subscriptions", id, user);
    }

    if (w.archived) {
      throw new Error("Choose an active account.");
    }

    const recurrence = text(form, "recurrence"),
      status = text(form, "status");

    if (!["weekly", "monthly", "yearly"].includes(recurrence) || !["active", "paused", "cancelled"].includes(status))
      throw new Error("Invalid subscription settings.");

    const values = [
      text(form, "name", 80),
      positive(text(form, "amount")),
      wallet,
      recurrence,
      validDate(text(form, "next_due")),
      status,
    ];

    if (id) {
      sqlite
        .prepare(
          "UPDATE subscriptions SET name=?,amount=?,wallet_id=?,recurrence=?,next_due=?,status=? WHERE id=? AND user_id=?",
        )
        .run(...values, id, user);
    } else {
      sqlite
        .prepare(
          "INSERT INTO subscriptions(name,amount,wallet_id,recurrence,next_due,status,id,user_id) VALUES (?,?,?,?,?,?,?,?)",
        )
        .run(...values, randomUUID(), user);
    }
  } else if (intent === "goal") {
    if (id) {
      owned(sqlite, "goals", id, user);
    }

    const values = [text(form, "name", 80), positive(text(form, "amount")), validDate(text(form, "target_date"))];

    if (id) {
      sqlite
        .prepare("UPDATE goals SET name=?,amount=?,target_date=? WHERE id=? AND user_id=?")
        .run(...values, id, user);
    } else {
      sqlite
        .prepare("INSERT INTO goals(name,amount,target_date,id,user_id) VALUES (?,?,?,?,?)")
        .run(...values, randomUUID(), user);
    }
  } else if (intent === "contribute") {
    const goal = text(form, "goal_id");
    owned(sqlite, "goals", goal, user);
    sqlite
      .prepare("INSERT INTO contributions(id,user_id,goal_id,amount,date) VALUES (?,?,?,?,?)")
      .run(randomUUID(), user, goal, positive(text(form, "amount")), validDate(text(form, "date")));
  } else if (intent === "delete_contribution") {
    owned(sqlite, "contributions", id, user);
    sqlite.prepare("DELETE FROM contributions WHERE id=? AND user_id=?").run(id, user);
  } else if (intent === "preview_import" || intent === "commit_import") {
    let csv = String(form.get("csv") || "");
    const file = form.get("file");

    if (file && typeof file !== "string" && file.size) {
      if (file.size > 1024 * 1024) throw new Error("CSV must be at most 1 MB.");
      csv = await file.text();
    }

    if (intent === "preview_import")
      return {
        preview: previewImport(sqlite, user, csv),
        csv,
        message: "Preview only. No transactions have been saved.",
      };

    const result = commitImport(sqlite, user, csv, text(form, "policy"));
    return { message: `Imported ${result.imported} transactions; skipped ${result.skipped} duplicates.` };
  } else if (intent === "demo") {
    sqlite.transaction(() => {
      if (sqlite.prepare("SELECT id FROM wallets WHERE user_id=? LIMIT 1").get(user))
        throw new Error("Demo data is only available in an empty workspace.");

      const main = randomUUID(),
        savings = randomUUID(),
        cash = randomUUID();

      for (const [id, name, opening] of [
        [main, "Demo · Everyday", 125000],
        [savings, "Demo · Savings", 600000],
        [cash, "Demo · Wallet", 15000],
      ])
        sqlite.prepare("INSERT INTO wallets(id,user_id,name,opening) VALUES (?,?,?,?)").run(id, user, name, opening);

      const month = today().slice(0, 7);
      const rows = [
        ["income", "Salary", "Fictional monthly salary", "4800.00", main, "", 1],
        ["expense", "Food & dining", "Demo · Little café", "18.50", main, "", 3],
        ["expense", "Groceries", "Demo · Weekly groceries", "96.40", main, "", 5],
        ["expense", "Transport", "Demo · MRT top-up", "40.00", main, "", 8],
        ["expense", "Home & bills", "Demo · Internet", "49.90", main, "", 9],
        ["expense", "Shopping", "Demo · A good book", "32.00", main, "", 12],
        ["expense", "Food & dining", "Demo · Dinner with friends", "64.80", main, "", 15],
        ["transfer", "Transfer", "Demo · Move to savings", "600.00", main, savings, 16],
      ];

      for (const [kind, category, description, amount, wallet, destination, day] of rows) {
        const f = new FormData();
        for (const [key, value] of Object.entries({
          kind,
          category,
          description,
          amount,
          wallet_id: wallet,
          destination_id: destination,
          date: `${month}-${String(day).padStart(2, "0")}`,
          notes: "Fictional demo data — not real financial records.",
        }))
          f.set(key, String(value));
        saveEntry(sqlite, user, f);
      }

      for (const [category, amount] of [
        ["Food & dining", 50000],
        ["Groceries", 35000],
        ["Transport", 15000],
        ["Shopping", 20000],
      ])
        sqlite.prepare("INSERT INTO budgets VALUES (?,?,?,?,?)").run(randomUUID(), user, month, category, amount);
      sqlite
        .prepare("INSERT INTO subscriptions VALUES (?,?,?,?,?,?,?,?)")
        .run(randomUUID(), user, "Demo · Music", 1098, main, "monthly", `${month}-28`, "active");

      const goal = randomUUID();

      sqlite
        .prepare("INSERT INTO goals VALUES (?,?,?,?,?)")
        .run(goal, user, "Demo · A little adventure", 300000, `${Number(month.slice(0, 4)) + 1}-06-01`);
      sqlite
        .prepare("INSERT INTO contributions VALUES (?,?,?,?,?)")
        .run(randomUUID(), user, goal, 60000, `${month}-16`);
    })();
    return { message: "Fictional demo data added. All demo accounts and descriptions are labelled." };
  } else throw new Error("Unknown action.");
  return { message: "Saved successfully." };
}
