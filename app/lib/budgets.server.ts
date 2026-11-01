import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export function saveBudget(db: Database.Database, budget: { id?: string; month: string; category: string; amount: number; allMonths: boolean }) {
  const { id, month, category, amount, allMonths } = budget;
  db.transaction(() => {
    let saveId = id || randomUUID();

    if (id) {
      const existing = db.prepare('SELECT month,all_months FROM budgets WHERE id=?').get(id) as { month: string; all_months: number } | undefined;

      if (!existing) {
        throw new Error('Budget not found.');
      }

      if (existing.all_months && !allMonths) {
        saveId = randomUUID();

        if (existing.month === month) {
          const nextMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7);
          db.prepare('UPDATE budgets SET month=? WHERE id=? AND NOT EXISTS (SELECT 1 FROM budgets WHERE category=? AND month=?)').run(
            nextMonth,
            id,
            category,
            nextMonth
          );
          // A limit already starting next month takes over the recurring series.
          db.prepare('DELETE FROM budgets WHERE id=? AND month=?').run(id, month);
        }
      } else {
        db.prepare('DELETE FROM budgets WHERE id=?').run(id);
      }
    }

    if (allMonths) {
      db.prepare('DELETE FROM budgets WHERE category=? AND month>=? AND all_months=1').run(category, month);
    }

    db.prepare(
      'INSERT INTO budgets(id,month,category,amount,all_months) VALUES (?,?,?,?,?) ON CONFLICT(month,category) DO UPDATE SET amount=excluded.amount,all_months=excluded.all_months'
    ).run(saveId, month, category, amount, allMonths ? 1 : 0);
  })();
}
