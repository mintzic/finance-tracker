import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { saveCategory, categoryNames } from '../app/lib/categories.server';
import { saveEntry, balances } from '../app/lib/ledger.server';
import { deductSubscriptions } from '../app/lib/subscriptions.server';
import { previewImport } from '../app/lib/import.server';
function setup() {
 const db = new Database(':memory:'); db.pragma('foreign_keys=ON');
 for(const name of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort()) db.exec(readFileSync('migrations/'+name,'utf8'));
 db.exec("INSERT INTO wallets(id,name,opening) VALUES ('w','Everyday',10000)"); return db;
}
function form(values: Record<string,string>) { const f=new FormData(); for(const [k,v] of Object.entries(values)) f.set(k,v); return f; }
test('custom categories persist, validate transactions and CSV, and reject duplicates',()=>{
 const db=setup(); try {
 saveCategory(db,form({kind:'expense',name:'  Pets  '}));
 assert.ok(categoryNames(db,'expense').includes('Pets'));
 assert.throws(()=>saveCategory(db,form({kind:'expense',name:'pets'})),/already exists/);
 assert.throws(()=>saveCategory(db,form({kind:'expense',name:'Transfer'})),/reserved/);
 assert.throws(()=>saveCategory(db,form({kind:'expense',name:' '})),/name/);
 assert.throws(()=>saveCategory(db,form({kind:'wrong',name:'Pets'})),/Choose/);
 const csv='date,kind,description,amount,account,destination,category,notes\n2026-10-01,expense,Food,5.00,Everyday,,Pets,\n';
 assert.equal(previewImport(db,csv)[0].error,undefined);
 assert.ok(previewImport(db,csv.replace('Pets','Unknown'))[0].error);
 } finally {db.close();}
});
test('renaming and deleting preserve balances, propagate records and merge budgets',()=>{
 const db=setup(); try {
 saveEntry(db,form({kind:'expense',date:'2026-10-01',description:'Dinner',amount:'5',wallet_id:'w',category:'Food & dining'}));
 db.exec("INSERT INTO budgets VALUES ('b','2026-10','Food & dining',5000),('o','2026-10','Other',1000)");
 saveCategory(db,form({id:'expense-0',name:'Dining'}));
 assert.equal((db.prepare('SELECT category FROM entries').get() as any).category,'Dining');
 assert.equal((db.prepare("SELECT category FROM budgets WHERE id='b'").get() as any).category,'Dining');
 saveCategory(db,form({id:'expense-0'}),true);
 assert.equal((db.prepare('SELECT category FROM entries').get() as any).category,'Other');
 assert.deepEqual(db.prepare('SELECT category,amount FROM budgets').all(),[{category:'Other',amount:6000}]);
 assert.equal(balances(db)[0].balance,9500);
 assert.throws(()=>saveCategory(db,form({id:'expense-8'}),true),/fallback/);
 assert.throws(()=>saveCategory(db,form({id:'missing',name:'Name'})),/not found/);
 } finally {db.close();}
});
test('subscription charges follow renamed category and fall back after deletion',()=>{
 const db=setup(); try {
 saveCategory(db,form({id:'expense-4',name:'Bills'}));
 db.exec("INSERT INTO subscriptions(id,name,amount,wallet_id,recurrence,next_due,status) VALUES ('s','Music',100,'w','monthly','2026-01-01','active')");
 deductSubscriptions(db,'2026-01-01');
 assert.equal((db.prepare('SELECT category FROM entries').get() as any).category,'Bills');
 saveCategory(db,form({id:'expense-4'}),true);
 deductSubscriptions(db,'2026-02-01');
 assert.ok((db.prepare('SELECT category FROM entries').all() as any[]).every(e=>e.category==='Other'));
 } finally {db.close();}
});
