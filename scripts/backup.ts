import Database from 'better-sqlite3';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const target=process.argv[2];
if(!target) throw new Error('Usage: npm run db:backup -- /path/to/new-backup-directory (stop the app first)');
// Stop the app first so SQLite metadata and the receipt directory are one consistent snapshot.
await mkdir(target,{recursive:false,mode:0o700});
const db=new Database(resolve(process.env.DATABASE_PATH||'data/finance.sqlite'),{readonly:true,fileMustExist:true});
try {
  await db.backup(resolve(target,'finance.sqlite'));
  await cp(resolve(process.env.RECEIPT_DIR||'data/receipts'),resolve(target,'receipts'),{recursive:true,force:false}).catch((error:NodeJS.ErrnoException)=>{if(error.code!=='ENOENT')throw error;});
  await writeFile(resolve(target,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),currency:'SGD',timezone:'Asia/Singapore',note:'Database and receipts. Store environment secrets separately.'},null,2),{mode:0o600});
  console.log(`Backup complete: ${resolve(target)}`);
}finally{db.close();}
