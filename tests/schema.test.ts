import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {balancesSQL,monthlySummarySQL} from '../app/db/queries.ts';
function database() {
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');
  db.exec(readFileSync('migrations/0001_initial.sql','utf8'));db.exec(readFileSync('migrations/0002_login_attempts.sql','utf8'));
  db.exec("INSERT INTO user(id,name,email,created_at,updated_at) VALUES ('u','Test','test@example.com',0,0),('x','Other','other@example.com',0,0)");
  db.exec("INSERT INTO wallets(id,user_id,name,opening) VALUES ('a','u','Everyday',10000),('b','u','Savings',20000),('x','x','Foreign',50000)");
  return db;
}
test('actual balance and summary SQL handles transfer creation, edits, and deletion',()=>{
  const db=database();try{
    const values=()=>db.prepare(balancesSQL).all('9999-12-31','9999-12-31','u').map(w=>w.balance);
    db.exec("INSERT INTO entries(id,user_id,kind,date,description,amount,wallet_id,destination_id,category) VALUES ('t','u','transfer','2026-10-01','Move',1000,'a','b','Transfer')");
    assert.deepEqual(values(),[9000,21000]);
    const summary=db.prepare(monthlySummarySQL).get('u','2026-10-01','2026-11-01');
    assert.equal(summary?.income,0);assert.equal(summary?.expense,0);
    db.exec("UPDATE entries SET amount=2500 WHERE id='t'");assert.deepEqual(values(),[7500,22500]);
    db.exec("DELETE FROM entries WHERE id='t'");assert.deepEqual(values(),[10000,20000]);
  }finally{db.close();}
});
test('database constraints reject invalid transfers, fractional amounts and non-SGD accounts',()=>{
  const db=database();try{
    const insert=db.prepare("INSERT INTO entries(id,user_id,kind,date,description,amount,wallet_id,destination_id,category) VALUES ('t','u','transfer','2026-10-01','Move',?,'a',?,'Transfer')");
    for(const destination of ['a','missing','x',null])assert.throws(()=>insert.run(100,destination));
    assert.throws(()=>insert.run(1.5,'b'));assert.throws(()=>insert.run(-1,'b'));
    assert.throws(()=>db.exec("UPDATE wallets SET currency='USD' WHERE id='a'"));
    assert.equal(db.prepare('SELECT COUNT(*) n FROM entries').get()?.n,0);
  }finally{db.close();}
});
test('SQL monthly boundaries, opening balances, and goal allocations remain consistent',()=>{
  const db=database();try{
    db.exec("INSERT INTO entries(id,user_id,kind,date,description,amount,wallet_id,category) VALUES ('e','u','expense','2024-02-29','Leap day',101,'a','Food & dining'),('f','u','expense','2024-03-01','Next month',999,'a','Food & dining'),('i','u','income','2024-02-01','Pay',20000,'a','Salary')");
    const summary=db.prepare(monthlySummarySQL).get('u','2024-02-01','2024-03-01');assert.equal(summary?.income,20000);assert.equal(summary?.expense,101);
    assert.equal(db.prepare(balancesSQL).all('2024-02-29','2024-02-29','u')[0].balance,29899);
    db.exec("INSERT INTO goals VALUES ('g','u','Trip',100000,'2027-01-01'); INSERT INTO contributions VALUES ('c','u','g',5000,'2024-02-29'); UPDATE wallets SET opening=15000 WHERE id='a'");
    assert.equal(db.prepare(balancesSQL).all('2024-02-29','2024-02-29','u')[0].balance,34899);
    db.exec("DELETE FROM entries WHERE id='e'");assert.equal(db.prepare(balancesSQL).all('2024-02-29','2024-02-29','u')[0].balance,35000);
  }finally{db.close();}
});
