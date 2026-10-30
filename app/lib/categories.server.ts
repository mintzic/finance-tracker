import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
export type Category = { id: string; kind: "income" | "expense"; name: string };
export function listCategories(db: Database.Database): Category[] {
  return db.prepare("SELECT * FROM categories ORDER BY kind,name COLLATE NOCASE").all() as Category[];
}
export function categoryNames(db: Database.Database, kind: string) {
  return listCategories(db)
    .filter((c) => c.kind === kind)
    .map((c) => c.name);
}
export function saveCategory(db: Database.Database, form: FormData, deleting = false) {
  return db.transaction(() => {
    const id = String(form.get("id") || "");
    const previous = id
      ? (db.prepare("SELECT * FROM categories WHERE id=?").get(id) as Category | undefined)
      : undefined;
    if (id && !previous) throw new Error("Category not found.");
    if (previous?.name === "Other") throw new Error("Other is reserved as the fallback category.");
    const kind = previous?.kind || String(form.get("kind") || "");
    if (kind !== "income" && kind !== "expense") throw new Error("Choose income or expense.");
    const name = deleting ? "Other" : String(form.get("name") || "").trim();
    if (!name || name.length > 80) throw new Error("Enter a category name (up to 80 characters).");
    if (name.toLowerCase() === "transfer") throw new Error("Transfer is reserved for transfers.");
    if (deleting && !previous) throw new Error("Category not found.");
    if (
      !deleting &&
      db.prepare("SELECT id FROM categories WHERE kind=? AND name=? COLLATE NOCASE AND id<>?").get(kind, name, id)
    )
      throw new Error("A category with this name already exists for this type.");
    if (previous) {
      db.prepare("UPDATE entries SET category=?,fingerprint=NULL WHERE kind=? AND category=?").run(
        name,
        kind,
        previous.name,
      );
      if (kind === "expense") {
        const budgets = db.prepare("SELECT id,month,amount FROM budgets WHERE category=?").all(previous.name) as {
          id: string;
          month: string;
          amount: number;
        }[];
        for (const budget of budgets) {
          const target = db
            .prepare("SELECT id,amount FROM budgets WHERE month=? AND category=? AND id<>?")
            .get(budget.month, name, budget.id) as { id: string; amount: number } | undefined;
          if (target) {
            if (target.amount + budget.amount > 999999999999)
              throw new Error("Combined budget exceeds the supported amount.");
            db.prepare("UPDATE budgets SET amount=? WHERE id=?").run(target.amount + budget.amount, target.id);
            db.prepare("DELETE FROM budgets WHERE id=?").run(budget.id);
          } else db.prepare("UPDATE budgets SET category=? WHERE id=?").run(name, budget.id);
        }
      }
      if (deleting) db.prepare("DELETE FROM categories WHERE id=?").run(id);
      else db.prepare("UPDATE categories SET name=? WHERE id=?").run(name, id);
    } else db.prepare("INSERT INTO categories VALUES (?,?,?)").run(randomUUID(), kind, name);
  })();
}
