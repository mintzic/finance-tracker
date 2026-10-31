import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { deductSubscriptions, nextBillingDate } from '../app/lib/subscriptions.server';
import { balances } from '../app/lib/ledger.server';

function setup() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  for (const name of readdirSync('migrations')
    .filter((n) => n.endsWith('.sql'))
    .sort()) {
    db.exec(readFileSync(`migrations/${name}`, 'utf8'));
  }
  db.exec("INSERT INTO wallets(id,name,opening) VALUES ('w','Everyday',10000)");
  return db;
}

test('due subscriptions catch up once and reduce balances on the correct dates', () => {
  const db = setup();
  try {
    db.exec("INSERT INTO subscriptions(id,name,amount,wallet_id,recurrence,next_due,status) VALUES ('s','Music',1000,'w','monthly','2024-01-31','active')");
    assert.equal(deductSubscriptions(db, '2024-03-31'), 3);
    assert.deepEqual(db.prepare('SELECT date,amount FROM entries ORDER BY date').all(), [
      { date: '2024-01-31', amount: 1000 },
      { date: '2024-02-29', amount: 1000 },
      { date: '2024-03-31', amount: 1000 },
    ]);
    assert.equal(balances(db)[0].balance, 7000);
    assert.equal(balances(db, '2024-02-29')[0].balance, 8000);
    assert.equal(deductSubscriptions(db, '2024-03-31'), 0);
    assert.equal((db.prepare('SELECT next_due FROM subscriptions').get() as any).next_due, '2024-04-30');
    // Editing/deleting a generated expense and resetting the due date must not charge it again.
    db.exec("DELETE FROM entries; UPDATE subscriptions SET next_due='2024-01-31'");
    assert.equal(deductSubscriptions(db, '2024-03-31'), 0);
    assert.equal(balances(db)[0].balance, 10000);
  } finally {
    db.close();
  }
});

test('paused, cancelled, future and archived-account subscriptions are skipped', () => {
  const db = setup();
  try {
    const insert = db.prepare("INSERT INTO subscriptions(id,name,amount,wallet_id,recurrence,next_due,status) VALUES (?, ?,100,'w','weekly',?,?)");
    insert.run('p', 'Paused', '2026-10-01', 'paused');
    insert.run('c', 'Cancelled', '2026-10-01', 'cancelled');
    insert.run('f', 'Future', '2026-12-01', 'active');
    assert.equal(deductSubscriptions(db, '2026-10-31'), 0);
    insert.run('a', 'Archived', '2026-10-01', 'active');
    db.exec('UPDATE wallets SET archived=1');
    assert.equal(deductSubscriptions(db, '2026-10-31'), 0);
    db.exec("UPDATE wallets SET archived=0; UPDATE subscriptions SET status='active' WHERE id='p'");
    assert.equal(deductSubscriptions(db, '2026-10-15'), 6);
    assert.equal(balances(db)[0].balance, 9400);
  } finally {
    db.close();
  }
});

test('billing calendars handle weekly rollover, short months and leap years', () => {
  assert.equal(nextBillingDate('2026-12-28', 'weekly', '2026-12-28'), '2027-01-04');
  assert.equal(nextBillingDate('2025-01-31', 'monthly', '2025-01-31'), '2025-02-28');
  assert.equal(nextBillingDate('2025-02-28', 'monthly', '2025-01-31'), '2025-03-31');
  assert.equal(nextBillingDate('2024-02-29', 'yearly', '2024-02-29'), '2025-02-28');
  assert.equal(nextBillingDate('2027-02-28', 'yearly', '2024-02-29'), '2028-02-29');
});

test('failed billing rolls back both charges and schedule advancement', () => {
  const db = setup();
  try {
    db.exec(`INSERT INTO subscriptions(id,name,amount,wallet_id,recurrence,next_due,status) VALUES ('s','Music',1000,'w','weekly','2026-10-01','active');
      CREATE TRIGGER fail_charge BEFORE INSERT ON subscription_charges BEGIN SELECT RAISE(ABORT,'test failure'); END;`);
    assert.throws(() => deductSubscriptions(db, '2026-10-15'));
    assert.equal(balances(db)[0].balance, 10000);
    assert.equal((db.prepare('SELECT next_due FROM subscriptions').get() as any).next_due, '2026-10-01');
    assert.equal((db.prepare('SELECT COUNT(*) n FROM subscription_charges').get() as any).n, 0);
  } finally {
    db.close();
  }
});
