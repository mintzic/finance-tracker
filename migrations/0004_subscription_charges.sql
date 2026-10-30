ALTER TABLE subscriptions ADD COLUMN billing_anchor TEXT;
UPDATE subscriptions SET billing_anchor=next_due;

-- Keep billing history even if its expense is edited or deleted.
CREATE TABLE subscription_charges (
  subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  entry_id TEXT REFERENCES entries(id) ON DELETE SET NULL,
  PRIMARY KEY(subscription_id, due_date)
);
