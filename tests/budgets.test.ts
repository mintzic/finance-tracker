import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { monthlyBudgetsSQL } from '../app/db/queries.ts';
import { saveBudget } from '../app/lib/budgets.server.ts';

test('recurring budgets carry forward, allow monthly overrides, and count only selected-month spending', () => {
  const db = new Database(':memory:');
  try {
    for (const name of readdirSync('migrations')
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      db.exec(readFileSync(`migrations/${name}`, 'utf8'));
    }
    db.exec(`INSERT INTO budgets(id,month,category,amount,all_months) VALUES
      ('repeat','2026-11','Food',50000,1), ('once','2026-11','Travel',20000,0),
      ('override','2026-12','Food',60000,0), ('new-repeat','2027-02','Food',70000,1);
      INSERT INTO wallets(id,name,opening) VALUES ('wallet','Everyday',0);
      INSERT INTO entries(id,kind,wallet_id,category,amount,date,description) VALUES
      ('old','expense','wallet','Food',1000,'2026-11-02','Old'),
      ('new','expense','wallet','Food',2500,'2027-01-02','New');`);
    const list = (month: string) => db.prepare(monthlyBudgetsSQL).all({ month, start: `${month}-01`, end: `${month}-32` }) as { id: string; spent: number }[];
    assert.deepEqual(list('2026-10'), []);
    assert.deepEqual(
      list('2026-11').map((b) => b.id),
      ['repeat', 'once']
    );
    assert.deepEqual(
      list('2026-12').map((b) => b.id),
      ['override']
    );
    assert.equal(list('2027-01').length, 1);
    assert.equal(list('2027-01')[0].id, 'repeat');
    assert.equal(list('2027-01')[0].spent, 2500);
    assert.equal(list('2027-02')[0].id, 'new-repeat');
    assert.equal(list('2027-03')[0].id, 'new-repeat');
  } finally {
    db.close();
  }
});

test('saving an earlier recurring budget replaces recurring limits but preserves monthly exceptions', () => {
  const db = new Database(':memory:');
  try {
    for (const name of readdirSync('migrations')
      .filter((name) => name.endsWith('.sql'))
      .sort()) {
      db.exec(readFileSync(`migrations/${name}`, 'utf8'));
    }
    saveBudget(db, { month: '2026-09', category: 'Entertainment', amount: 5000, allMonths: false });
    saveBudget(db, { month: '2026-11', category: 'Entertainment', amount: 10000, allMonths: true });
    saveBudget(db, { month: '2026-12', category: 'Entertainment', amount: 15000, allMonths: false });
    saveBudget(db, { month: '2026-11', category: 'Travel', amount: 30000, allMonths: true });
    saveBudget(db, { month: '2026-10', category: 'Entertainment', amount: 20000, allMonths: true });
    const rows = db.prepare('SELECT month,amount FROM budgets WHERE category=? ORDER BY month').all('Entertainment');
    assert.deepEqual(rows, [
      { month: '2026-09', amount: 5000 },
      { month: '2026-10', amount: 20000 },
      { month: '2026-12', amount: 15000 },
    ]);
    for (const month of ['2026-10', '2026-11', '2026-12', '2027-01']) {
      const budgets = db.prepare(monthlyBudgetsSQL).all({ month, start: `${month}-01`, end: `${month}-32` }) as { category: string; amount: number }[];
      assert.equal(budgets.find((b) => b.category === 'Entertainment')?.amount, month === '2026-12' ? 15000 : 20000);
    }
    assert.equal((db.prepare('SELECT amount FROM budgets WHERE category=?').get('Travel') as { amount: number }).amount, 30000);
    const recurring = db.prepare('SELECT id FROM budgets WHERE category=? AND all_months=1').get('Entertainment') as { id: string };
    saveBudget(db, { id: recurring.id, month: '2027-01', category: 'Entertainment', amount: 8000, allMonths: false });
    assert.equal((db.prepare('SELECT amount FROM budgets WHERE id=?').get(recurring.id) as { amount: number }).amount, 20000);
    saveBudget(db, { id: recurring.id, month: '2026-10', category: 'Entertainment', amount: 9000, allMonths: false });
    assert.equal((db.prepare('SELECT month FROM budgets WHERE id=?').get(recurring.id) as { month: string }).month, '2026-11');
  } finally {
    db.close();
  }
});
