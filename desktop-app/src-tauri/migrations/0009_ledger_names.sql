-- Applied only to ledger copies, never to the legacy source databases.
CREATE TABLE IF NOT EXISTS native_files (id TEXT PRIMARY KEY REFERENCES receipts(id) ON DELETE CASCADE, bytes BLOB NOT NULL CHECK(typeof(bytes)='blob'));
ALTER TABLE wallets RENAME TO accounts;
ALTER TABLE entries RENAME TO transactions;
ALTER TABLE workspace_cover RENAME TO ledger_cover;
ALTER TABLE native_files RENAME TO receipt_files;
ALTER TABLE transactions RENAME COLUMN wallet_id TO account_id;
ALTER TABLE transactions RENAME COLUMN destination_id TO destination_account_id;
ALTER TABLE subscriptions RENAME COLUMN wallet_id TO account_id;
ALTER TABLE receipts RENAME COLUMN entry_id TO transaction_id;
ALTER TABLE subscription_charges RENAME COLUMN entry_id TO transaction_id;
DROP INDEX IF EXISTS entries_month;
DROP INDEX IF EXISTS entries_wallet;
DROP INDEX IF EXISTS entries_destination;
CREATE INDEX transactions_month ON transactions(date,kind);
CREATE INDEX transactions_account ON transactions(account_id);
CREATE INDEX transactions_destination ON transactions(destination_account_id);
