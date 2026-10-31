import { randomUUID } from 'node:crypto';
import { sqlite } from '../db/connection.server';
import { record, positive, text, saveEntry, balances } from './ledger.server';
import { expenseCategories, incomeCategories } from './categories';
import { minor, monthRange, validDate, today } from './money';
import { commitImport, previewImport, type ImportRow } from './import.server';
import { stageReceipt, receiptFor, removeReceiptFile } from './receipts.server';

import { categoryNames, saveCategory } from './categories.server';
import { updateCover } from './cover.server';

export type ActionResult = {
  error?: string;
  message?: string;
  preview?: ImportRow[];
  csv?: string;
};

export async function mutate(form: FormData): Promise<ActionResult> {
  const intent = text(form, 'intent');
  const id = String(form.get('id') || '');

  if (intent === 'reset') {
    if (form.get('confirmation') !== 'RESET') {
      throw new Error('Type RESET to clear the workspace.');
    }

    const receipts = sqlite.prepare('SELECT id FROM receipts').all() as {
      id: string;
    }[];
    sqlite.transaction(() => {
      for (const table of [
        'subscription_charges',
        'receipts',
        'contributions',
        'goals',
        'subscriptions',
        'budgets',
        'entries',
        'wallets',
        'categories',
        'workspace_cover',
      ]) {
        sqlite.prepare(`DELETE FROM ${table}`).run();
      }
      for (const [kind, names] of [
        ['expense', expenseCategories],
        ['income', incomeCategories],
      ] as const) {
        for (const name of names) {
          sqlite.prepare('INSERT INTO categories(id,kind,name) VALUES (?,?,?)').run(randomUUID(), kind, name);
        }
      }
    })();
    for (const receipt of receipts) {
      await removeReceiptFile(receipt.id);
    }
    return {
      message: 'Workspace reset. All records and the cover were removed; default categories restored.',
    };
  }

  if (intent === 'adjust_wallet') {
    const wallet = balances(sqlite).find((wallet) => wallet.id === id);

    if (!wallet) {
      throw new Error('Account not found.');
    }

    const target = minor(text(form, 'balance'));
    const opening = wallet.opening + target - wallet.balance;

    if (!Number.isSafeInteger(opening) || Math.abs(opening) > 999999999999) {
      throw new Error('Adjusted opening balance is too large.');
    }

    sqlite.prepare('UPDATE wallets SET opening=? WHERE id=?').run(opening, id);

    return {
      message: 'Balance adjusted. Income and spending are unchanged.',
    };
  }

  if (intent === 'delete_wallet') {
    record(sqlite, 'wallets', id);

    if (form.get('policy') === 'keep') {
      sqlite.prepare('UPDATE wallets SET archived=1 WHERE id=?').run(id);

      return {
        message: 'Account archived. Transactions and reports preserved.',
      };
    }

    if (form.get('policy') !== 'delete' || form.get('confirmation') !== 'DELETE') {
      throw new Error('Type DELETE to remove the account and its transactions.');
    }

    const receipts = sqlite.prepare('SELECT r.id FROM receipts r JOIN entries e ON e.id=r.entry_id WHERE e.wallet_id=? OR e.destination_id=?').all(id, id) as {
      id: string;
    }[];
    sqlite.transaction(() => {
      sqlite.prepare('DELETE FROM subscriptions WHERE wallet_id=?').run(id);
      sqlite.prepare('DELETE FROM entries WHERE wallet_id=? OR destination_id=?').run(id, id);
      sqlite.prepare('DELETE FROM wallets WHERE id=?').run(id);
    })();
    for (const receipt of receipts) {
      await removeReceiptFile(receipt.id);
    }
    return {
      message: 'Account and linked transactions, transfers, receipts, and subscriptions deleted. Balances recalculated.',
    };
  }

  if (['upload_cover', 'remove_cover', 'position_cover'].includes(intent)) {
    await updateCover(sqlite, form);
    return { message: 'Cover updated.' };
  }

  if (intent === 'category' || intent === 'delete_category') {
    saveCategory(sqlite, form, intent === 'delete_category');
    return {
      message: intent === 'category' ? 'Category saved.' : 'Category deleted. Records moved to Other.',
    };
  }

  if (intent === 'entry') {
    const receipt = await stageReceipt(form.get('receipt'));
    let previous: { id: string } | undefined;

    try {
      sqlite.transaction(() => {
        const entryId = saveEntry(sqlite, form);
        previous = receiptFor(entryId);

        if (receipt || form.get('remove_receipt') === 'on') {
          sqlite.prepare('DELETE FROM receipts WHERE entry_id=?').run(entryId);
        }

        if (receipt) {
          sqlite
            .prepare('INSERT INTO receipts(id,entry_id,filename,mime,size) VALUES (?,?,?,?,?)')
            .run(receipt.id, entryId, receipt.filename, receipt.mime, receipt.size);
        }
      })();
    } catch (error) {
      if (receipt) {
        await removeReceiptFile(receipt.id);
      }

      throw error;
    }

    if (previous && (receipt || form.get('remove_receipt') === 'on')) {
      await removeReceiptFile(previous.id);
    }

    return { message: 'Transaction saved.' };
  }

  if (intent === 'delete_entry') {
    record(sqlite, 'entries', id);
    const receipt = receiptFor(id);
    sqlite.prepare('DELETE FROM entries WHERE id=?').run(id);

    if (receipt) {
      await removeReceiptFile(receipt.id);
    }

    return { message: 'Transaction deleted. Account balances updated.' };
  }

  if (intent === 'wallet') {
    const name = text(form, 'name', 80),
      opening = minor(text(form, 'opening'));

    if (id) {
      record(sqlite, 'wallets', id);
      sqlite.prepare('UPDATE wallets SET name=?,opening=?,archived=? WHERE id=?').run(name, opening, form.get('archived') === 'on' ? 1 : 0, id);
    } else {
      sqlite.prepare('INSERT INTO wallets(id,name,opening) VALUES (?,?,?)').run(randomUUID(), name, opening);
    }

    return { message: 'Account saved. Balances recalculated.' };
  }

  if (intent === 'budget') {
    const month = text(form, 'month');
    monthRange(month);
    const category = text(form, 'category');

    if (!categoryNames(sqlite, 'expense').includes(category)) {
      throw new Error('Choose an expense category.');
    }

    sqlite
      .prepare('INSERT INTO budgets(id,month,category,amount) VALUES (?,?,?,?) ON CONFLICT(month,category) DO UPDATE SET amount=excluded.amount')
      .run(randomUUID(), month, category, positive(text(form, 'amount')));
  } else if (intent === 'delete_budget') {
    sqlite.prepare('DELETE FROM budgets WHERE id=?').run(id);
  } else if (intent === 'subscription') {
    const wallet = text(form, 'wallet_id');
    const w = record(sqlite, 'wallets', wallet);

    if (id) {
      record(sqlite, 'subscriptions', id);
    }

    if (w.archived) {
      throw new Error('Choose an active account.');
    }

    const recurrence = text(form, 'recurrence'),
      status = text(form, 'status');

    if (!['weekly', 'monthly', 'yearly'].includes(recurrence) || !['active', 'paused', 'cancelled'].includes(status)) {
      throw new Error('Invalid subscription settings.');
    }

    const values = [text(form, 'name', 80), positive(text(form, 'amount')), wallet, recurrence, validDate(text(form, 'next_due')), status];

    if (id) {
      sqlite
        .prepare(
          'UPDATE subscriptions SET billing_anchor=CASE WHEN next_due<>? OR recurrence<>? THEN ? ELSE billing_anchor END,name=?,amount=?,wallet_id=?,recurrence=?,next_due=?,status=? WHERE id=?'
        )
        .run(values[4], values[3], values[4], ...values, id);
    } else {
      sqlite.prepare('INSERT INTO subscriptions(name,amount,wallet_id,recurrence,next_due,status,id) VALUES (?,?,?,?,?,?,?)').run(...values, randomUUID());
    }
  } else if (intent === 'goal') {
    if (id) {
      record(sqlite, 'goals', id);
    }

    const values = [text(form, 'name', 80), positive(text(form, 'amount')), validDate(text(form, 'target_date'))];

    if (id) {
      sqlite.prepare('UPDATE goals SET name=?,amount=?,target_date=? WHERE id=?').run(...values, id);
    } else {
      sqlite.prepare('INSERT INTO goals(name,amount,target_date,id) VALUES (?,?,?,?)').run(...values, randomUUID());
    }
  } else if (intent === 'contribute') {
    const goal = text(form, 'goal_id');
    record(sqlite, 'goals', goal);
    sqlite
      .prepare('INSERT INTO contributions(id,goal_id,amount,date) VALUES (?,?,?,?)')
      .run(randomUUID(), goal, positive(text(form, 'amount')), validDate(text(form, 'date')));
  } else if (intent === 'delete_contribution') {
    record(sqlite, 'contributions', id);
    sqlite.prepare('DELETE FROM contributions WHERE id=?').run(id);
  } else if (intent === 'preview_import' || intent === 'commit_import') {
    let csv = String(form.get('csv') || '');
    const file = form.get('file');

    if (file && typeof file !== 'string' && file.size) {
      if (file.size > 1024 * 1024) {
        throw new Error('CSV must be at most 1 MB.');
      }

      csv = await file.text();
    }

    if (intent === 'preview_import') {
      return {
        preview: previewImport(sqlite, csv),
        csv,
        message: 'Preview only. No transactions have been saved.',
      };
    }

    const result = commitImport(sqlite, csv, text(form, 'policy'));
    return {
      message: `Imported ${result.imported} transactions; skipped ${result.skipped} duplicates.`,
    };
  } else if (intent === 'demo') {
    sqlite.transaction(() => {
      if (sqlite.prepare('SELECT id FROM wallets LIMIT 1').get()) {
        throw new Error('Demo data is only available in an empty workspace.');
      }

      const main = randomUUID(),
        savings = randomUUID(),
        cash = randomUUID();

      for (const [id, name, opening] of [
        [main, 'Demo · Everyday', 125000],
        [savings, 'Demo · Savings', 600000],
        [cash, 'Demo · Wallet', 15000],
      ]) {
        sqlite.prepare('INSERT INTO wallets(id,name,opening) VALUES (?,?,?)').run(id, name, opening);
      }

      const month = today().slice(0, 7);
      const rows = [
        ['income', 'Salary', 'Fictional monthly salary', '4800.00', main, '', 1],
        ['expense', 'Food & dining', 'Demo · Little café', '18.50', main, '', 3],
        ['expense', 'Groceries', 'Demo · Weekly groceries', '96.40', main, '', 5],
        ['expense', 'Transport', 'Demo · MRT top-up', '40.00', main, '', 8],
        ['expense', 'Home & bills', 'Demo · Internet', '49.90', main, '', 9],
        ['expense', 'Shopping', 'Demo · A good book', '32.00', main, '', 12],
        ['expense', 'Food & dining', 'Demo · Dinner with friends', '64.80', main, '', 15],
        ['transfer', 'Transfer', 'Demo · Move to savings', '600.00', main, savings, 16],
      ];

      for (const [kind, category, description, amount, wallet, destination, day] of rows) {
        const f = new FormData();
        for (const [key, value] of Object.entries({
          kind,
          category,
          description,
          amount,
          wallet_id: wallet,
          destination_id: destination,
          date: `${month}-${String(day).padStart(2, '0')}`,
          notes: 'Fictional demo data — not real financial records.',
        })) {
          f.set(key, String(value));
        }
        saveEntry(sqlite, f);
      }

      for (const [category, amount] of [
        ['Food & dining', 50000],
        ['Groceries', 35000],
        ['Transport', 15000],
        ['Shopping', 20000],
      ]) {
        sqlite.prepare('INSERT INTO budgets VALUES (?,?,?,?)').run(randomUUID(), month, category, amount);
      }
      sqlite
        .prepare('INSERT INTO subscriptions(id,name,amount,wallet_id,recurrence,next_due,status) VALUES (?,?,?,?,?,?,?)')
        .run(randomUUID(), 'Demo · Music', 1098, main, 'monthly', `${month}-28`, 'active');

      const goal = randomUUID();

      sqlite.prepare('INSERT INTO goals VALUES (?,?,?,?)').run(goal, 'Demo · A little adventure', 300000, `${Number(month.slice(0, 4)) + 1}-06-01`);
      sqlite.prepare('INSERT INTO contributions VALUES (?,?,?,?)').run(randomUUID(), goal, 60000, `${month}-16`);
    })();
    return {
      message: 'Fictional demo data added. All demo accounts and descriptions are labelled.',
    };
  } else {
    throw new Error('Unknown action.');
  }

  return { message: 'Saved successfully.' };
}
