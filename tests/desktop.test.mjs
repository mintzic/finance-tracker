import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../desktop/migrate.mjs';

test('desktop migrates persistent storage and restricts the local backend', async () => {
  const directory = process.env.DESKTOP_TEST_DIRECTORY;
  assert.ok(directory, 'Run this test with npm run desktop:test');
  const databasePath = join(directory, 'finance.sqlite');
  let server;
  try {
    await migrate(databasePath, resolve('migrations'));
    const db = new Database(databasePath);
    db.prepare("INSERT INTO wallets(id,name,opening) VALUES ('desktop-test','Preserved',100)").run();
    db.close();
    await migrate(databasePath, resolve('migrations'));
    const reopened = new Database(databasePath);
    assert.equal(reopened.prepare("SELECT opening FROM wallets WHERE id='desktop-test'").get().opening, 100);
    reopened.close();
    process.env.DATABASE_PATH = databasePath;
    process.env.RECEIPT_DIR = join(directory, 'receipts');
    process.env.NODE_ENV = 'production';
    const { startServer } = await import('../desktop/server.mjs');
    const local = await startServer(resolve('.'));
    server = local.server;
    const headers = { Cookie: `desktop_session=${local.token}` };
    assert.equal((await fetch(local.origin)).status, 403);
    assert.equal((await fetch(local.origin, { headers: { Cookie: 'desktop_session=wrong' } })).status, 403);
    assert.equal((await fetch(local.origin, { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
    const home = await fetch(local.origin, { headers });
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Preserved/);
    const saved = await fetch(`${local.origin}/?index`, {
      method: 'POST', headers: { ...headers, Origin: local.origin },
      body: new URLSearchParams({ intent: 'wallet', name: 'Desktop savings', opening: '125.50' }),
    });
    assert.equal(saved.status, 200);
    const persisted = new Database(databasePath, { readonly: true });
    try {
      assert.equal(persisted.prepare("SELECT opening FROM wallets WHERE name='Desktop savings'").get().opening, 12550);
    } finally {
      persisted.close();
    }
    const css = (await readdir('build/client/assets')).find(name => name.endsWith('.css'));
    const asset = await fetch(`${local.origin}/assets/${css}`, { headers });
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'text/css');
    assert.equal((await fetch(`${local.origin}/export`, { headers })).status, 200);
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise(accept => server.close(accept));
    }
    // The parent test runner removes the database after SQLite exits on Windows.
  }
});
