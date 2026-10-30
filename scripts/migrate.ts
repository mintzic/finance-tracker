import { resolve } from 'node:path';
import { migrate } from '../desktop/migrate.mjs';

const databasePath = resolve(process.env.DATABASE_PATH || 'data/finance.sqlite');
await migrate(databasePath, resolve('migrations'));
console.log(`Migrations complete: ${databasePath}`);
