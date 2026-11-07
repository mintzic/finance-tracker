CREATE TABLE IF NOT EXISTS wallets (id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 80), opening INTEGER NOT NULL CHECK(typeof(opening)='integer' AND abs(opening)<=999999999999), currency TEXT NOT NULL DEFAULT 'SGD' CHECK(currency='SGD'), archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)));
CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('income','expense','transfer')), date TEXT NOT NULL CHECK(date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'), description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 200), amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0 AND amount<=999999999999), wallet_id TEXT NOT NULL, destination_id TEXT, category TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', fingerprint TEXT, FOREIGN KEY(wallet_id) REFERENCES wallets(id), FOREIGN KEY(destination_id) REFERENCES wallets(id), CHECK((kind='transfer' AND destination_id IS NOT NULL AND destination_id<>wallet_id AND category='Transfer') OR (kind<>'transfer' AND destination_id IS NULL)), UNIQUE(id,fingerprint));
CREATE TABLE IF NOT EXISTS budgets (id TEXT PRIMARY KEY, month TEXT NOT NULL, category TEXT NOT NULL, amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0 AND amount<=999999999999), UNIQUE(month,category));
CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0 AND amount<=999999999999), wallet_id TEXT NOT NULL, recurrence TEXT NOT NULL CHECK(recurrence IN ('weekly','monthly','yearly')), next_due TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('active','paused','cancelled')), FOREIGN KEY(wallet_id) REFERENCES wallets(id));
CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, name TEXT NOT NULL, amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0 AND amount<=999999999999), target_date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS contributions (id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE, amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount>0 AND amount<=999999999999), date TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, entry_id TEXT NOT NULL UNIQUE REFERENCES entries(id) ON DELETE CASCADE, filename TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL);
ALTER TABLE subscriptions ADD COLUMN billing_anchor TEXT;
UPDATE subscriptions SET billing_anchor=next_due;

-- Keep billing history even if its expense is edited or deleted.
CREATE TABLE subscription_charges (
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
  PRIMARY KEY(subscription_id, due_date)
);

CREATE TABLE categories (id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('income','expense')), name TEXT NOT NULL COLLATE NOCASE CHECK(length(trim(name)) BETWEEN 1 AND 80), UNIQUE(kind,name));
INSERT INTO categories VALUES ('expense-0','expense','Food & dining');
INSERT INTO categories VALUES ('expense-1','expense','Groceries');
INSERT INTO categories VALUES ('expense-2','expense','Transport');
INSERT INTO categories VALUES ('expense-3','expense','Shopping');
INSERT INTO categories VALUES ('expense-4','expense','Home & bills');
INSERT INTO categories VALUES ('expense-5','expense','Health');
INSERT INTO categories VALUES ('expense-6','expense','Entertainment');
INSERT INTO categories VALUES ('expense-7','expense','Travel');
INSERT INTO categories VALUES ('expense-8','expense','Other');
INSERT INTO categories VALUES ('income-0','income','Salary');
INSERT INTO categories VALUES ('income-1','income','Freelance');
INSERT INTO categories VALUES ('income-2','income','Interest');
INSERT INTO categories VALUES ('income-3','income','Gifts');
INSERT INTO categories VALUES ('income-4','income','Other');
INSERT OR IGNORE INTO categories SELECT 'legacy-' || kind || '-' || category,kind,category FROM entries WHERE kind IN ('income','expense');
INSERT OR IGNORE INTO categories SELECT 'legacy-budget-' || category,'expense',category FROM budgets;

CREATE TABLE workspace_cover (
  id INTEGER PRIMARY KEY CHECK(id=1),
  version TEXT NOT NULL,
  mime TEXT NOT NULL CHECK(mime IN ('image/png','image/jpeg','image/webp')),
  image BLOB NOT NULL,
  position REAL NOT NULL DEFAULT 50 CHECK(position BETWEEN 0 AND 100)
);

ALTER TABLE budgets ADD COLUMN all_months INTEGER NOT NULL DEFAULT 0 CHECK(all_months IN (0,1));

ALTER TABLE subscriptions ADD COLUMN category TEXT NOT NULL DEFAULT 'Other';
