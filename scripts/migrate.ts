import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
const path = resolve(process.env.DATABASE_PATH || 'data/finance.sqlite');
mkdirSync(dirname(path),{recursive:true});
const db = new Database(path);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)');
for(const name of readdirSync('migrations').filter(n=>n.endsWith('.sql')).sort()) {
  const sql = readFileSync(`migrations/${name}`,'utf8');
  const checksum = createHash('sha256').update(sql).digest('hex');
  const previous = db.prepare('SELECT checksum FROM _migrations WHERE name=?').get(name) as {checksum:string}|undefined;
  if(previous && previous.checksum !== checksum) throw new Error(`Applied migration changed: ${name}`);
  if(!previous) db.transaction(()=>{db.exec(sql);db.prepare('INSERT INTO _migrations VALUES (?,?)').run(name,checksum);})();
}
db.close();
console.log(`Migrations complete: ${path}`);
