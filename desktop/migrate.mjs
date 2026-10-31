import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export async function migrate(databasePath, migrationDirectory) {
  mkdirSync(dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL)');
    for (const name of readdirSync(migrationDirectory)
      .filter((n) => n.endsWith('.sql'))
      .sort()) {
      const sql = readFileSync(join(migrationDirectory, name), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = db.prepare('SELECT checksum FROM _migrations WHERE name=?').get(name);

      if (previous && previous.checksum !== checksum) {
        throw new Error(`Applied migration changed: ${name}`);
      }

      if (previous) {
        continue;
      }

      if (name === '0003_shared_workspace.sql') {
        await db.backup(`${databasePath}.before-shared-workspace-${Date.now()}.bak`);
      }

      db.transaction(() => {
        db.exec(sql);

        if (db.pragma('foreign_key_check').length) {
          throw new Error(`Foreign key check failed: ${name}`);
        }

        db.prepare('INSERT INTO _migrations VALUES (?,?)').run(name, checksum);
      })();
    }
  } finally {
    db.close();
  }
}
