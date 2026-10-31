import { sqlite } from '../db/connection.server';
import { monthlySummarySQL } from '../db/queries';
import { balances, type Entry } from './ledger.server';
import { monthRange, today } from './money';
import { deductSubscriptions } from './subscriptions.server';

import { listCategories } from './categories.server';
import { getCover } from './cover.server';

export function dashboard(url: URL) {
  deductSubscriptions(sqlite);
  const month = url.searchParams.get('month') || today().slice(0, 7);
  const { start, end } = monthRange(month);
  const section = url.searchParams.get('view') || 'dashboard';

  if (!['dashboard', 'accounts', 'income', 'expenses', 'transfers', 'budgets', 'subscriptions', 'goals', 'reports', 'import'].includes(section)) {
    throw new Response('Not found', { status: 404 });
  }

  const sum = sqlite.prepare(monthlySummarySQL).get(start, end) as {
    income: number;
    expense: number;
  };
  const spending = sqlite
    .prepare(`SELECT category, SUM(amount) amount FROM entries WHERE kind='expense' AND date>=? AND date<? GROUP BY category ORDER BY amount DESC`)
    .all(start, end) as { category: string; amount: number }[];
  const budgets = sqlite
    .prepare(
      `SELECT b.*,COALESCE((SELECT SUM(e.amount) FROM entries e WHERE e.category=b.category AND e.kind='expense' AND e.date>=? AND e.date<?),0) spent FROM budgets b WHERE b.month=? ORDER BY b.category`
    )
    .all(start, end, month) as {
    id: string;
    category: string;
    amount: number;
    spent: number;
  }[];
  const wallets = balances(sqlite);
  const monthBalances = balances(sqlite, new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10));
  const goals = sqlite
    .prepare(`SELECT g.*,COALESCE((SELECT SUM(c.amount) FROM contributions c WHERE c.goal_id=g.id),0) saved FROM goals g ORDER BY g.target_date`)
    .all() as {
    id: string;
    name: string;
    amount: number;
    target_date: string;
    saved: number;
  }[];
  const subscriptions = sqlite.prepare('SELECT s.*,w.name account_name FROM subscriptions s JOIN wallets w ON w.id=s.wallet_id ORDER BY s.next_due').all() as {
    id: string;
    name: string;
    amount: number;
    wallet_id: string;
    account_name: string;
    recurrence: string;
    next_due: string;
    status: string;
  }[];
  const contributions = sqlite.prepare('SELECT c.*,g.name FROM contributions c JOIN goals g ON g.id=c.goal_id ORDER BY c.date DESC LIMIT 100').all() as {
    id: string;
    goal_id: string;
    name: string;
    amount: number;
    date: string;
  }[];
  const trends = sqlite
    .prepare(
      `WITH RECURSIVE months(month,n) AS (SELECT strftime('%Y-%m',date(?,'-5 months')),1 UNION ALL SELECT strftime('%Y-%m',date(month||'-01','+1 month')),n+1 FROM months WHERE n<6) SELECT month,COALESCE((SELECT SUM(amount) FROM entries WHERE kind='income' AND substr(date,1,7)=month),0) income, COALESCE((SELECT SUM(amount) FROM entries WHERE kind='expense' AND substr(date,1,7)=month),0) expense,COALESCE((SELECT SUM(amount) FROM contributions WHERE substr(date,1,7)=month),0) savings FROM months`
    )
    .all(start) as {
    month: string;
    income: number;
    expense: number;
    savings: number;
  }[];
  const q = (url.searchParams.get('q') || '').slice(0, 200);
  const account = url.searchParams.get('account') || '';
  const category = url.searchParams.get('category') || '';
  const kind = section === 'income' ? 'income' : section === 'expenses' ? 'expense' : section === 'transfers' ? 'transfer' : '';
  const where = `e.date>=@start AND e.date<@end AND (@kind='' OR e.kind=@kind) AND (@q='' OR instr(lower(e.description||' '||e.notes),lower(@q))>0) AND (@account='' OR e.wallet_id=@account OR e.destination_id=@account) AND (@category='' OR e.category=@category)`;
  const args = { start, end, kind, q, account, category };
  const count = (sqlite.prepare(`SELECT count(*) count FROM entries e WHERE ${where}`).get(args) as { count: number }).count;
  const page = Math.min(Math.max(1, Number(url.searchParams.get('page')) || 1), Math.max(1, Math.ceil(count / 20)));
  const sort = url.searchParams.get('sort') || 'date';
  const direction = url.searchParams.get('dir') === 'asc' ? 'ASC' : 'DESC';
  const sortColumn =
    (
      {
        date: 'e.date',
        amount: 'e.amount',
        description: 'e.description',
      } as Record<string, string>
    )[sort] || 'e.date';
  const select = `SELECT e.*,w.name account_name,d.name destination_name,r.id receipt_id FROM entries e JOIN wallets w ON w.id=e.wallet_id LEFT JOIN wallets d ON d.id=e.destination_id LEFT JOIN receipts r ON r.entry_id=e.id`;
  const transactions = sqlite
    .prepare(`${select} WHERE ${where} ORDER BY ${sortColumn} ${direction},e.id LIMIT 20 OFFSET @offset`)
    .all({ ...args, offset: (page - 1) * 20 }) as Entry[];
  const recent = (kind: string) =>
    sqlite.prepare(`${select} WHERE e.kind=? AND e.date>=? AND e.date<? ORDER BY e.date DESC,e.rowid DESC LIMIT 5`).all(kind, start, end) as Entry[];
  const editId = url.searchParams.get('edit');
  const edit = editId ? (sqlite.prepare('SELECT * FROM entries WHERE id=?').get(editId) as Entry | undefined) : undefined;

  return {
    month,
    section,
    categories: listCategories(sqlite),
    cover: getCover(sqlite) || null,
    sum,
    spending,
    budgets,
    wallets,
    monthBalances,
    goals,
    subscriptions,
    contributions,
    trends,
    transactions,
    count,
    page,
    q,
    account,
    category,
    sort,
    dir: direction.toLowerCase(),
    recentExpenses: recent('expense'),
    recentIncome: recent('income'),
    recentTransfers: recent('transfer'),
    edit,
  };
}
