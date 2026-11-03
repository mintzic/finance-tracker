import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { today, validDate } from './money';

type Subscription = {
  id: string;
  name: string;
  amount: number;
  category: string;
  wallet_id: string;
  recurrence: string;
  next_due: string;
  billing_anchor: string | null;
};

export function nextBillingDate(due: string, recurrence: string, anchor: string) {
  validDate(due);
  validDate(anchor);
  const date = new Date(`${due}T00:00:00Z`);

  if (recurrence === 'weekly') {
    date.setUTCDate(date.getUTCDate() + 7);
  } else {
    const day = Number(anchor.slice(8, 10));
    const month = recurrence === 'yearly' ? Number(anchor.slice(5, 7)) - 1 : date.getUTCMonth() + 1;
    const year = date.getUTCFullYear() + (recurrence === 'yearly' ? 1 : 0);

    if (recurrence !== 'monthly' && recurrence !== 'yearly') {
      throw new Error('Invalid recurrence.');
    }

    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    date.setUTCDate(1);
    date.setUTCFullYear(year, month, Math.min(day, lastDay));
  }

  return validDate(date.toISOString().slice(0, 10));
}

export function deductSubscriptions(database: Database.Database, through = today()) {
  validDate(through);
  return database
    .transaction(() => {
      const due = database
        .prepare(
          `
      SELECT s.* FROM subscriptions s JOIN wallets w ON w.id=s.wallet_id
      WHERE s.status='active' AND w.archived=0 AND s.next_due<=?
      ORDER BY s.next_due,s.id
    `
        )
        .all(through) as Subscription[];
      let deducted = 0;
      for (const subscription of due) {
        const anchor = subscription.billing_anchor || subscription.next_due;
        let date = subscription.next_due;
        while (date <= through) {
          const next = nextBillingDate(date, subscription.recurrence, anchor);
          const charged = database.prepare('SELECT 1 FROM subscription_charges WHERE subscription_id=? AND due_date=?').get(subscription.id, date);

          if (!charged) {
            const entry = randomUUID();
            database
              .prepare(
                `INSERT INTO entries(id,kind,date,description,amount,wallet_id,category,notes)
            VALUES (?,'expense',?,?,?,?,?)`
              )
              .run(entry, date, subscription.name, subscription.amount, subscription.wallet_id, subscription.category, `Automatic subscription payment (${subscription.recurrence}).`);
            database.prepare('INSERT INTO subscription_charges(subscription_id,due_date,entry_id) VALUES (?,?,?)').run(subscription.id, date, entry);
            deducted++;
          }

          date = next;
        }
        database.prepare('UPDATE subscriptions SET next_due=?,billing_anchor=? WHERE id=?').run(date, anchor, subscription.id);
      }
      return deducted;
    })
    .immediate();
}
