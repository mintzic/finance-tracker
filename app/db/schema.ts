import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

export const wallets = sqliteTable('wallets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  opening: integer('opening').notNull(),
  currency: text('currency').notNull().default('SGD'),
  archived: integer('archived').notNull().default(0),
});

export const entries = sqliteTable('entries', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  date: text('date').notNull(),
  description: text('description').notNull(),
  amount: integer('amount').notNull(),
  walletId: text('wallet_id').notNull(),
  destinationId: text('destination_id'),
  category: text('category').notNull(),
  notes: text('notes').notNull().default(''),
  fingerprint: text('fingerprint'),
});

export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey(),
  month: text('month').notNull(),
  category: text('category').notNull(),
  amount: integer('amount').notNull(),
});

export const subscriptions = sqliteTable('subscriptions', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  amount: integer('amount').notNull(),
  walletId: text('wallet_id').notNull(),
  recurrence: text('recurrence').notNull(),
  nextDue: text('next_due').notNull(),
  billingAnchor: text('billing_anchor'),
  status: text('status').notNull(),
});

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  amount: integer('amount').notNull(),
  targetDate: text('target_date').notNull(),
});

export const subscriptionCharges = sqliteTable(
  'subscription_charges',
  {
    subscriptionId: text('subscription_id')
      .notNull()
      .references(() => subscriptions.id, { onDelete: 'cascade' }),
    dueDate: text('due_date').notNull(),
    entryId: text('entry_id').references(() => entries.id, {
      onDelete: 'set null',
    }),
  },
  (table) => [primaryKey({ columns: [table.subscriptionId, table.dueDate] })]
);

export const contributions = sqliteTable('contributions', {
  id: text('id').primaryKey(),
  goalId: text('goal_id').notNull(),
  amount: integer('amount').notNull(),
  date: text('date').notNull(),
});

export const receipts = sqliteTable('receipts', {
  id: text('id').primaryKey(),
  entryId: text('entry_id').notNull(),
  filename: text('filename').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
});
