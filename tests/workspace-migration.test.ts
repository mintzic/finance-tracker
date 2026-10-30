import { test } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { balancesSQL } from "../app/db/queries";

test("shared workspace migration preserves financial records and removes ownership", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys=ON");
    db.exec(readFileSync("migrations/0001_initial.sql", "utf8"));
    db.exec(readFileSync("migrations/0002_login_attempts.sql", "utf8"));
    db.exec(`
      INSERT INTO user(id,name,email,created_at,updated_at) VALUES ('u','Owner','one@example.com',0,0),('v','Other','two@example.com',0,0);
      INSERT INTO wallets(id,user_id,name,opening) VALUES ('a','u','Everyday',10000),('b','u','Savings',20000),('c','v','Other',5000);
      INSERT INTO entries(id,user_id,kind,date,description,amount,wallet_id,destination_id,category) VALUES ('t','u','transfer','2026-10-01','Move',1000,'a','b','Transfer');
      INSERT INTO budgets VALUES ('budget1','u','2026-10','Food & dining',10000),('budget2','v','2026-10','Food & dining',5000);
      INSERT INTO subscriptions VALUES ('s','u','Music',1000,'a','monthly','2026-11-01','active');
      INSERT INTO goals VALUES ('g','u','Trip',100000,'2027-01-01');
      INSERT INTO contributions VALUES ('c','u','g',5000,'2026-10-01');
      INSERT INTO receipts VALUES ('r','u','t','receipt.pdf','application/pdf',123);
    `);
    db.transaction(() => db.exec(readFileSync("migrations/0003_shared_workspace.sql", "utf8")))();
    assert.deepEqual(db.pragma("foreign_key_check"), []);
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    for (const name of ["user", "account", "session", "verification", "login_attempts"])
      assert.ok(!names.some(table => table.name === name));
    for (const { name } of names) {
      const columns = db.pragma(`table_info(${name})`) as { name: string }[];
      assert.ok(!columns.some(column => column.name === "user_id"));
    }
    assert.deepEqual(db.prepare(balancesSQL).all("9999-12-31", "9999-12-31").map((w: any) => w.balance), [9000, 5000, 21000]);
    assert.deepEqual(db.prepare("SELECT id,entry_id,filename,size FROM receipts").get(), { id: "r", entry_id: "t", filename: "receipt.pdf", size: 123 });
    assert.equal((db.prepare("SELECT amount FROM budgets").get() as any).amount, 15000);
    assert.equal((db.prepare("SELECT amount FROM contributions WHERE goal_id='g'").get() as any).amount, 5000);
    assert.equal((db.prepare("SELECT wallet_id FROM subscriptions").get() as any).wallet_id, "a");
    db.prepare("DELETE FROM entries WHERE id='t'").run();
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM receipts").get() as any).n, 0);
  } finally {
    db.close();
  }
});
