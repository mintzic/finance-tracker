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
    const signup = await fetch(`${local.origin}/profiles`, {
      method: 'POST',
      redirect: 'manual',
      headers: { ...headers, Origin: local.origin },
      body: new URLSearchParams({ intent: 'create_profile', username: 'First user' }),
    });
    assert.equal(signup.status, 302);
    headers.Cookie += `; ${signup.headers.get('set-cookie').split(';')[0]}`;
    const home = await fetch(local.origin, { headers });
    assert.equal(home.status, 200);
    assert.match(await home.text(), /Preserved/);
    const saved = await fetch(`${local.origin}/?index`, {
      method: 'POST',
      headers: { ...headers, Origin: local.origin },
      body: new URLSearchParams({ intent: 'wallet', name: 'Desktop savings', opening: '125.50' }),
    });
    assert.equal(saved.status, 200);
    const persisted = new Database(databasePath, { readonly: true });
    try {
      assert.equal(persisted.prepare("SELECT opening FROM wallets WHERE name='Desktop savings'").get().opening, 12550);
    } finally {
      persisted.close();
    }
    const css = (await readdir('build/client/assets')).find((name) => name.endsWith('.css'));
    const asset = await fetch(`${local.origin}/assets/${css}`, { headers });
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get('content-type'), 'text/css');
    assert.equal((await fetch(`${local.origin}/export`, { headers })).status, 200);
    const post = async (values) => {
      const response = await fetch(`${local.origin}/?index`, {
        method: 'POST',
        headers: { ...headers, Origin: local.origin },
        body: new URLSearchParams(values),
      });
      assert.equal(response.status, 200);
      return response.text();
    };
    const inspect = new Database(databasePath);
    inspect.pragma('foreign_keys=ON');
    try {
      const other = inspect.prepare("SELECT id FROM wallets WHERE name='Desktop savings'").get().id;
      inspect
        .prepare(
          "INSERT INTO entries(id,kind,date,description,amount,wallet_id,destination_id,category) VALUES ('transfer','transfer','2026-10-01','Move',50,'desktop-test',?,'Transfer')"
        )
        .run(other);
      await post({ intent: 'adjust_wallet', id: 'desktop-test', balance: '10.00' });
      assert.equal(inspect.prepare("SELECT opening FROM wallets WHERE id='desktop-test'").get().opening, 1050);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM entries').get().n, 1);
      await post({ intent: 'delete_wallet', id: 'desktop-test', policy: 'keep' });
      assert.equal(inspect.prepare("SELECT archived FROM wallets WHERE id='desktop-test'").get().archived, 1);
      await post({ intent: 'delete_wallet', id: 'desktop-test', policy: 'delete' });
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM entries').get().n, 1);
      await post({ intent: 'delete_wallet', id: 'desktop-test', policy: 'delete', confirmation: 'DELETE' });
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM entries').get().n, 0);
      assert.equal(inspect.prepare('PRAGMA foreign_key_check').all().length, 0);
      await post({ intent: 'reset', confirmation: 'wrong' });
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM wallets').get().n, 1);
      const second = await fetch(`${local.origin}/profiles`, {
        method: 'POST',
        redirect: 'manual',
        headers: { ...headers, Origin: local.origin },
        body: new URLSearchParams({ intent: 'create_profile', username: 'Second user' }),
      });
      assert.equal(second.status, 302);
      const secondHeaders = { ...headers, Cookie: `desktop_session=${local.token}; ${second.headers.get('set-cookie').split(';')[0]}` };
      const secondHome = await fetch(local.origin, { headers: secondHeaders });
      assert.equal(secondHome.status, 200);
      const secondText = await secondHome.text();
      assert.match(secondText, /Second user/);
      assert.doesNotMatch(secondText, /Desktop savings/);
      const crossWrite = await fetch(`${local.origin}/?index`, {
        method: 'POST',
        headers: { ...secondHeaders, Origin: local.origin },
        body: new URLSearchParams({ intent: 'adjust_wallet', id: other, balance: '0' }),
      });
      assert.match(await crossWrite.text(), /Account not found/);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM wallets').get().n, 1);
      const settings = await fetch(`${local.origin}/profiles`, {
        method: 'POST',
        redirect: 'manual',
        headers: { ...secondHeaders, Origin: local.origin },
        body: new URLSearchParams({ intent: 'save_profile', username: 'Renamed user', language: 'zh-SG', currency: 'USD' }),
      });
      assert.equal(settings.status, 302);
      const translated = await (await fetch(local.origin, { headers: secondHeaders })).text();
      assert.match(translated, /Renamed user/);
      assert.match(translated, /USD/);
      assert.match(translated, /总览/);
      assert.equal((await fetch(`${local.origin}/export`, { headers: secondHeaders })).status, 200);
      await post({ intent: 'reset', confirmation: 'RESET' });
      for (const table of ['wallets', 'entries', 'subscriptions', 'budgets', 'goals', 'contributions', 'receipts', 'subscription_charges', 'workspace_cover']) {
        assert.equal(inspect.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n, 0);
      }
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM categories').get().n, 14);
      assert.equal(inspect.prepare('SELECT COUNT(*) n FROM local_profiles').get().n, 2);
    } finally {
      inspect.close();
    }
  } finally {
    if (server) {
      server.closeAllConnections();
      await new Promise((accept) => server.close(accept));
    }
    // The parent test runner removes the database after SQLite exits on Windows.
  }
});
