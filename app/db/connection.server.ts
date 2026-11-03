import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import * as schema from './schema';
import { AsyncLocalStorage } from 'node:async_hooks';
import { migrate } from '../../desktop/migrate.mjs';

export const databasePath = resolve(process.env.DATABASE_PATH || 'data/finance.sqlite');

mkdirSync(dirname(databasePath), { recursive: true });

await migrate(databasePath, process.env.MIGRATION_DIR || resolve('migrations'));

export const workspaceDatabase = new Database(databasePath);
export const databaseContext = new AsyncLocalStorage<Database.Database>();

export const sqlite = new Proxy(workspaceDatabase, {
  get(_target, property) {
    const database = databaseContext.getStore() || workspaceDatabase;
    const value = Reflect.get(database, property, database);
    return typeof value === 'function' ? value.bind(database) : value;
  },
});

sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('busy_timeout = 5000');

export const db = drizzle(sqlite, { schema });
