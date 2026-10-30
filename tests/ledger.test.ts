import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { saveEntry, balances } from '../app/lib/ledger.server';
import { previewImport, commitImport, csvCell } from '../app/lib/import.server';
function setup() {
  const db=new Database(':memory:');db.pragma('foreign_keys=ON');db.exec(readFileSync('migrations/0001_initial.sql','utf8'));db.exec(readFileSync('migrations/0002_login_attempts.sql','utf8'));db.exec(readFileSync('migrations/0003_shared_workspace.sql','utf8'));
  db.exec(readFileSync('migrations/0005_categories.sql','utf8'));
  db.prepare('INSERT INTO wallets(id,name,opening) VALUES (?,?,?)').run('a','Everyday',10000);
  db.prepare('INSERT INTO wallets(id,name,opening) VALUES (?,?,?)').run('b','Savings',20000);
  return db;
}
function form(overrides:Record<string,string>={}) {const f=new FormData();for(const [k,v] of Object.entries({kind:'expense',date:'2026-10-01',description:'Coffee',amount:'5.50',wallet_id:'a',category:'Food & dining',...overrides}))f.set(k,v);return f;}
test('transfer updates both balances, edit and deletion reverse both sides',()=>{
  const db=setup();try{
    const id=saveEntry(db,form({kind:'transfer',destination_id:'b',amount:'30.00'}));
    assert.deepEqual(balances(db).map(w=>w.balance),[7000,23000]);
    const summary=db.prepare("SELECT COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END),0) expense,COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE 0 END),0) income FROM entries").get();
    assert.deepEqual(summary,{expense:0,income:0});
    saveEntry(db,form({id,kind:'transfer',destination_id:'b',amount:'20.00'}));
    assert.deepEqual(balances(db).map(w=>w.balance),[8000,22000]);
    db.prepare('DELETE FROM entries WHERE id=?').run(id);
    assert.deepEqual(balances(db).map(w=>w.balance),[10000,20000]);
  }finally{db.close();}
});
test('invalid transfers cannot write a partial record',()=>{
  const db=setup();try{
    for(const destination of ['a','missing']) assert.throws(()=>saveEntry(db,form({kind:'transfer',destination_id:destination})));
    assert.equal((db.prepare('SELECT COUNT(*) n FROM entries').get() as any).n,0);
  }finally{db.close();}
});
test('income, expense, edits and opening balances all recalculate consistently',()=>{
  const db=setup();try{
    const id=saveEntry(db,form());saveEntry(db,form({kind:'income',category:'Salary',amount:'100.00'}));
    assert.equal(balances(db)[0].balance,19450);
    saveEntry(db,form({id,amount:'10.00'}));assert.equal(balances(db)[0].balance,19000);
    db.prepare('UPDATE wallets SET opening=20000 WHERE id=?').run('a');assert.equal(balances(db)[0].balance,29000);
  }finally{db.close();}
});
test('SQL month boundary includes leap day, excludes next month and transfers',()=>{
  const db=setup();try{
    saveEntry(db,form({date:'2024-02-29',amount:'1.01'}));
    saveEntry(db,form({date:'2024-03-01',amount:'9.99'}));
    const row=db.prepare("SELECT SUM(amount) spent FROM entries WHERE kind='expense' AND date>=? AND date<?").get('2024-02-01','2024-03-01') as any;
    assert.equal(row.spent,101);assert.equal(balances(db,'2024-02-29')[0].balance,9899);
  }finally{db.close();}
});
test('goal allocations do not change account balances or spending',()=>{
  const db=setup();try{
    db.prepare('INSERT INTO goals VALUES (?,?,?,?)').run('g','Trip',100000,'2027-01-01');
    db.prepare('INSERT INTO contributions VALUES (?,?,?,?)').run('c','g',5000,'2026-10-01');
    assert.deepEqual(balances(db).map(w=>w.balance),[10000,20000]);
    assert.equal((db.prepare('SELECT count(*) n FROM entries').get() as any).n,0);
  }finally{db.close();}
});
const csv='date,kind,description,amount,account,destination,category,notes\n2026-10-01,expense,Coffee,5.50,Everyday,,Food & dining,\n';
test('CSV preview never writes; duplicate detection covers batch, repeat and manual entries',()=>{
  const db=setup();try{
    assert.equal(previewImport(db,csv).length,1);assert.equal((db.prepare('SELECT count(*) n FROM entries').get() as any).n,0);
    const doubled=csv+'2026-10-01,expense,Coffee,5.50,Everyday,,Food & dining,\n';
    assert.equal(previewImport(db,doubled)[1].duplicate,true);
    assert.deepEqual(commitImport(db,doubled,'skip'),{imported:1,skipped:1});
    assert.deepEqual(commitImport(db,csv,'skip'),{imported:0,skipped:1});
    assert.throws(()=>commitImport(db,csv,'reject'));
    db.exec('DELETE FROM entries');saveEntry(db,form());assert.equal(previewImport(db,csv)[0].duplicate,true);
  }finally{db.close();}
});
test('CSV invalid rows reject the entire import without writes',()=>{
  const db=setup();try{
    const invalid=csv+'2026-10-02,expense,Bad,1.001,Everyday,,Food & dining,\n';
    assert.throws(()=>commitImport(db,invalid,'skip'));
    assert.equal((db.prepare('SELECT count(*) n FROM entries').get() as any).n,0);
    assert.ok(csvCell('=SUM(A1)').startsWith('"\''));
  }finally{db.close();}
});
