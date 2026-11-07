import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps } from 'react';
import { Form, Link, useFetcher, useNavigation, useSearchParams } from 'react-router';
import {
  Wallet,
  LayoutDashboard,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  Repeat2,
  Flag,
  ChartNoAxesCombined,
  SlidersHorizontal,
  ChevronRight,
  ChevronLeft,
  Plus,
  X,
  Upload,
  Download,
  Search,
  CircleHelp,
  Landmark,
  CreditCard,
  Coins,
  ArrowRight,
  Cat,
  PawPrint,
  Menu,
  Target,
  UserRound,
} from 'lucide-react';
import { useLoaderData, useActionData, redirect, type LoaderFunctionArgs, type ActionFunctionArgs } from 'react-router';
import { bridge, serializeForm, errorMessage } from '@/lib/bridge';
import type { DashboardData, ActionResult } from '@/lib/types';
import { ExportLink } from '@/components/native-assets';

import { decimal, today } from '@/lib/money';
import { Preferences, useMoney, translate } from '@/lib/preferences';
import { TransactionTable } from '@/components/transaction-table';
import { Button } from '@/components/ui/button';
import { WorkspaceCover } from '@/components/workspace-cover';
import type { Entry } from '@/lib/types';
import catIcon from '@/assets/icon.png';
import { UserSettings } from '@/components/user-settings';

const SpendingChart = lazy(() => import('@/components/charts').then((module) => ({ default: module.SpendingChart })));
const TrendChart = lazy(() => import('@/components/charts').then((module) => ({ default: module.TrendChart })));

function DeferredSpendingChart(props: ComponentProps<typeof SpendingChart>) {
  return (
    <Suspense
      fallback={
        <div className="chart-empty" role="status">
          Loading chart…
        </div>
      }>
      <SpendingChart {...props} />
    </Suspense>
  );
}

function DeferredTrendChart(props: ComponentProps<typeof TrendChart>) {
  return (
    <Suspense
      fallback={
        <div className="chart-empty" role="status">
          Loading chart…
        </div>
      }>
      <TrendChart {...props} />
    </Suspense>
  );
}

export async function loader({ request }: LoaderFunctionArgs): Promise<DashboardData> {
  const { profile } = await bridge.profiles();
  if (!profile) throw redirect('/profiles');
  const params: Record<string, string> = {};
  new URL(request.url).searchParams.forEach((value, key) => {
    params[key] = value;
  });
  return bridge.dashboard(params);
}

export async function action({ request }: ActionFunctionArgs): Promise<ActionResult> {
  try {
    const form = await serializeForm(await request.formData());
    switch (form.intent) {
      case 'wallet':
        return await bridge.saveAccount(form);
      case 'adjust_wallet':
        return await bridge.adjustAccount(form);
      case 'delete_wallet':
        return await bridge.deleteAccount(form);
      case 'entry':
        return await bridge.saveTransaction(form);
      case 'delete_entry':
        return await bridge.deleteTransaction(form);
      case 'budget':
        return await bridge.saveBudget(form);
      case 'delete_budget':
        return await bridge.deleteBudget(form);
      case 'category':
        return await bridge.saveCategory(form);
      case 'delete_category':
        return await bridge.deleteCategory(form);
      case 'subscription':
        return await bridge.saveSubscription(form);
      case 'goal':
        return await bridge.saveGoal(form);
      case 'contribute':
        return await bridge.addContribution(form);
      case 'delete_contribution':
        return await bridge.deleteContribution(form);
      case 'preview_import':
        return await bridge.previewImport(form);
      case 'commit_import':
        return await bridge.commitImport(form);
      case 'upload_cover':
        return await bridge.uploadCover(form);
      case 'remove_cover':
        return await bridge.removeCover(form);
      case 'position_cover':
        return await bridge.positionCover(form);
      case 'reset':
        return await bridge.resetWorkspace(form);
      case 'demo':
        return await bridge.seedDemo(form);
      default:
        return { error: 'Unknown action.' };
    }
  } catch (error) {
    return { error: errorMessage(error) };
  }
}

export function meta() {
  return [{ title: 'Folio — Personal finance' }, { name: 'description', content: 'A private space for a clearer financial life.' }];
}

export function headers() {
  return {
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  };
}

const navigation = [
  ['dashboard', 'Overview', LayoutDashboard],
  ['accounts', 'Accounts', Wallet],
  ['income', 'Income', ArrowDownLeft],
  ['expenses', 'Expenses', ArrowUpRight],
  ['transfers', 'Transfers', ArrowLeftRight],
  ['budgets', 'Budgets', SlidersHorizontal],
  ['subscriptions', 'Subscriptions', Repeat2],
  ['goals', 'Savings goals', Flag],
  ['reports', 'Reports', ChartNoAxesCombined],
] as const;
type Modal = {
  type: 'entry' | 'wallet' | 'budget' | 'subscription' | 'goal' | 'contribute' | 'category' | 'categories' | 'reset';
  value?: any;
};

export default function Home() {
  const d = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  return (
    <Preferences.Provider value={d.profile}>
      <HomeContent loaderData={d} actionData={actionData} />
    </Preferences.Provider>
  );
}
function HomeContent({ loaderData: d, actionData }: { loaderData: DashboardData; actionData?: ActionResult }) {
  const money = useMoney();
  const t = (text: string) => translate(d.profile.language, text);
  const expenseCategories = d.categories.filter((c) => c.kind === 'expense').map((c) => c.name);
  const incomeCategories = d.categories.filter((c) => c.kind === 'income').map((c) => c.name);
  const isIncome = d.section === 'income';
  const [params] = useSearchParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modal, setModal] = useState<Modal | null>(null),
    [mobile, setMobile] = useState(false);
  const pending = useNavigation().state !== 'idle';

  useEffect(() => {
    if (actionData && 'message' in actionData && !('preview' in actionData)) {
      setModal(null);
    }
  }, [actionData]);

  const href = (view: string, extra: Record<string, string> = {}) => {
    const p = new URLSearchParams({ view, month: d.month, ...extra });
    return '/?' + p;
  };

  const edit = (entry: Entry) => setModal({ type: 'entry', value: entry });
  const total = d.wallets.reduce((sum, w) => sum + w.balance, 0);
  const monthName = new Date(d.month + '-01T12:00:00').toLocaleDateString(d.profile.language, { month: 'long', year: 'numeric' });
  const title = navigation.find((n) => n[0] === d.section)?.[1] || 'Import transactions';
  const changePage = (page: number) => {
    const p = new URLSearchParams(params);
    p.set('page', String(page));
    return '/?' + p;
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobile ? 'mobile-open' : ''}`}>
        <Link to="/" className="brand" aria-label="Folio home">
          <img className="brand-cat" src={catIcon} alt="" width="42" height="42" />
          folio<span className="brand-dot">.</span>
        </Link>
        <button className="mobile-close icon-button" onClick={() => setMobile(false)} aria-label="Close navigation">
          <X />
        </button>
        <nav>
          {navigation.map(([key, label, Icon]) => (
            <Link key={key} to={href(key)} onClick={() => setMobile(false)} className={d.section === key ? 'active' : ''}>
              <Icon size={17} />
              {t(label)}
              {d.section === key && <span className="active-dot" />}
            </Link>
          ))}
          <button
            type="button"
            onClick={() => {
              setMobile(false);
              setModal({ type: 'categories' });
            }}>
            <SlidersHorizontal size={17} />
            {t('Categories')}
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="cat-companion">
            <Cat size={24} strokeWidth={1.5} aria-hidden="true" />
            <p>
              A little set aside.
              <br />A little peace of mind.
            </p>
            <span>Small steps. Steady habits.</span>
          </div>
          <Link to={href('import')} className="utility-link">
            <Upload size={16} />
            {t('Import & export')}
          </Link>
          <div className="sidebar-footer">
            <span className="status-dot" />
            {d.profile.username}
            <span>{d.profile.currency}</span>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div>
            <button className="mobile-toggle icon-button" onClick={() => setMobile(true)} aria-label="Open navigation">
              <Menu size={20} />
            </button>
            <span>{d.profile.username}</span>
            <ChevronRight size={13} />
            <strong>{t(title)}</strong>
          </div>
          <button
            type="button"
            className="user-menu-trigger"
            aria-label={t('User settings')}
            aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(true)}>
            <UserRound size={18} />
            <span>{d.profile.username}</span>
          </button>
        </header>
        <WorkspaceCover profileId={d.profile.id} cover={d.cover} />
        <main className="content">
          <div className="page-heading">
            <div>
              <p className="eyebrow">YOUR MONEY, WITH INTENTION</p>
              <h1>
                {d.section === 'dashboard' ? 'A clearer picture.' : title}
                {d.section === 'dashboard' && <PawPrint className="heading-paw" size={23} strokeWidth={1.6} aria-hidden="true" />}
              </h1>
              <p className="muted">
                {d.section === 'dashboard'
                  ? 'A little overview of where you are, and where you’re going.'
                  : d.section === 'reports'
                    ? 'Understand your cash flow and the habits behind it.'
                    : d.section === 'accounts'
                      ? 'Every account, one place. Balances calculated from your records.'
                      : d.section === 'goals'
                        ? 'Put a little aside for the things that mean a lot.'
                        : d.section === 'subscriptions'
                          ? 'Keep an eye on the little things that add up.'
                          : 'A place for every detail. A little more peace of mind.'}
              </p>
            </div>
            <div className="heading-actions">
              <Form method="get" className="month-form">
                <input type="hidden" name="view" value={d.section} />
                <input
                  aria-label="Select month"
                  type="month"
                  name="month"
                  min="1900-01"
                  max="9998-12"
                  value={d.month}
                  onChange={(e) => e.currentTarget.form?.requestSubmit()}
                />
                <noscript>
                  <button>Apply</button>
                </noscript>
              </Form>
              <Button onClick={() => setModal({ type: 'entry' })} className="primary">
                <Plus size={16} />
                Add transaction
              </Button>
            </div>
          </div>
          {actionData && 'error' in actionData && actionData.error && (
            <div role="alert" className="notice error">
              {actionData.error}
            </div>
          )}
          {actionData && 'message' in actionData && actionData.message && (
            <div role="status" className="notice">
              {actionData.message}
            </div>
          )}
          {!d.wallets.length && (
            <div className="onboarding panel">
              <div>
                <Cat size={30} strokeWidth={1.5} aria-hidden="true" />
                <h2>Make yourself at home.</h2>
                <p className="muted">Create your first account, or explore with clearly labelled fictional demo data.</p>
              </div>
              <div className="flex-actions">
                <button className="primary" onClick={() => setModal({ type: 'wallet' })}>
                  Create account
                </button>
                <Form method="post">
                  <input type="hidden" name="intent" value="demo" />
                  <button className="secondary" disabled={pending}>
                    Load fictional demo
                  </button>
                </Form>
              </div>
            </div>
          )}
          {d.section === 'dashboard' && (
            <>
              <div className="section-heading">
                <h2>
                  <Wallet size={17} />
                  Your accounts <span className="count">{d.wallets.filter((w) => !w.archived).length}</span>
                </h2>
                <Link to={href('accounts')}>
                  Manage accounts <ArrowRight size={14} />
                </Link>
              </div>
              <div className="account-grid">
                <div className="account-card total-card">
                  <div className="card-label">
                    <span>Total account funds</span>
                    <span className="mini-symbol">∑</span>
                  </div>
                  <strong className="balance">{money(total)}</strong>
                  <p>
                    <span className="status-dot" />
                    All recorded balances · {d.profile.currency}
                  </p>
                </div>
                {d.wallets
                  .filter((w) => !w.archived)
                  .map((wallet, i) => (
                    <button key={wallet.id} className={`account-card account-${i % 3}`} onClick={() => setModal({ type: 'wallet', value: wallet })}>
                      <div className="card-label">
                        <span>{wallet.name}</span>
                        {i === 0 ? <Landmark size={18} /> : i === 1 ? <CreditCard size={18} /> : <Coins size={18} />}
                      </div>
                      <strong className="balance">{money(wallet.balance)}</strong>
                      <p>
                        Current balance <ArrowUpRight size={13} />
                      </p>
                    </button>
                  ))}
              </div>
              <div className="summary-strip">
                <div>
                  <span className="summary-icon income">
                    <ArrowDownLeft size={18} />
                  </span>
                  <span>
                    <small>Income this month</small>
                    <strong>{money(d.sum.income)}</strong>
                  </span>
                </div>
                <div>
                  <span className="summary-icon expense">
                    <ArrowUpRight size={18} />
                  </span>
                  <span>
                    <small>Expenses this month</small>
                    <strong>{money(d.sum.expense)}</strong>
                  </span>
                </div>
                <div>
                  <span className="summary-icon transfer">
                    <Coins size={18} />
                  </span>
                  <span>
                    <small>Net cash flow</small>
                    <strong className={d.sum.income - d.sum.expense >= 0 ? 'positive' : 'negative'}>{money(d.sum.income - d.sum.expense)}</strong>
                  </span>
                </div>
                <p>
                  {monthName}
                  <br />
                  <span>One month at a time.</span>
                </p>
              </div>
              <div className="dashboard-middle">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Where it went</h2>
                    <span className="small muted">{monthName}</span>
                  </div>
                  <DeferredSpendingChart data={d.spending} total={d.sum.expense} />
                  <div className="panel-footer">
                    <span className="muted small">Every little thing adds up.</span>
                    <Link to={href('reports')}>
                      Explore reports <ArrowRight size={13} />
                    </Link>
                  </div>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Room in your budget</h2>
                    <Link to={href('budgets')}>
                      View all <ArrowRight size={13} />
                    </Link>
                  </div>
                  <div className="budget-list">
                    {d.budgets.slice(0, 4).map((b) => (
                      <Budget key={b.id} budget={b} />
                    ))}
                    {!d.budgets.length && (
                      <div className="empty">
                        <Target size={25} />
                        <p>A plan for the month ahead.</p>
                        <button className="text-button" onClick={() => setModal({ type: 'budget' })}>
                          Set a category budget →
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="panel-footer">
                    <span className="muted small">A guide, with a little breathing room.</span>
                    <button className="text-button" onClick={() => setModal({ type: 'budget' })}>
                      <Plus size={13} />
                      Budget
                    </button>
                  </div>
                </section>
              </div>
              {[
                ['Recent expenses', d.recentExpenses, 'expenses'],
                ['Recent income', d.recentIncome, 'income'],
                ['Recent transfers', d.recentTransfers, 'transfers'],
              ].map(([label, rows, section]) => (
                <section key={String(label)} className="panel table-panel">
                  <div className="panel-heading">
                    <h2>{String(label)}</h2>
                    <Link to={href(String(section))}>
                      View all <ArrowRight size={13} />
                    </Link>
                  </div>
                  <TransactionTable rows={rows as Entry[]} onEdit={edit} transfers={section === 'transfers'} />
                </section>
              ))}
            </>
          )}
          {d.section === 'accounts' && (
            <>
              <div className="section-heading">
                <h2>
                  Account balances <span className="muted small">All time, including future-dated records</span>
                </h2>
                <button className="text-button" onClick={() => setModal({ type: 'wallet' })}>
                  <Plus size={15} />
                  New account
                </button>
              </div>
              <div className="account-grid standalone">
                {d.wallets.map((wallet, i) => (
                  <button className={`account-card account-${i % 3}`} key={wallet.id} onClick={() => setModal({ type: 'wallet', value: wallet })}>
                    <div className="card-label">
                      <span>{wallet.name}</span>
                      <Landmark size={18} />
                    </div>
                    <strong className="balance">{money(wallet.balance)}</strong>
                    <p>
                      Opening {money(wallet.opening)} {wallet.archived ? '· Archived' : ''}
                    </p>
                  </button>
                ))}
              </div>
              <p className="muted small">
                Total account funds: {money(total)}. Includes archived accounts. This is a balance-only summary; untracked assets and liabilities are excluded.
              </p>
            </>
          )}
          {['income', 'expenses'].includes(d.section) && (
            <div className="two-grid transaction-insights">
              <section className="panel">
                <div className="panel-heading">
                  <h2>{d.section === 'income' ? 'Where it came from' : 'Where it went'}</h2>
                  <span className="small muted">{monthName}</span>
                </div>
                <DeferredSpendingChart
                  data={d.section === 'income' ? d.incomeByCategory : d.spending}
                  total={d.section === 'income' ? d.sum.income : d.sum.expense}
                  income={d.section === 'income'}
                />
              </section>
              <section className="panel">
                <div className="panel-heading">
                  <h2>{isIncome ? 'Income' : 'Expenses'} over time</h2>
                  <span className="small muted">Six months to {monthName}</span>
                </div>
                <DeferredTrendChart data={d.trends} series={isIncome ? 'income' : 'expense'} />
              </section>
            </div>
          )}
          {['income', 'expenses', 'transfers'].includes(d.section) && (
            <section className="panel table-panel">
              <div className="panel-heading">
                <h2>
                  {title} <span className="count">{d.count}</span>
                </h2>
                <ExportLink className="text-button">
                  <Download size={14} />
                  Export all CSV
                </ExportLink>
              </div>
              <Form method="get" className="filters">
                <input type="hidden" name="view" value={d.section} />
                <input type="hidden" name="month" value={d.month} />
                <div className="search-field">
                  <Search size={15} />
                  <input name="q" defaultValue={d.q} placeholder="Search description or notes" aria-label="Search transactions" />
                </div>
                <select name="account" defaultValue={d.account} aria-label="Filter account">
                  <option value="">All accounts</option>
                  {d.wallets.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <select name="category" defaultValue={d.category} aria-label="Filter category">
                  <option value="">All categories</option>
                  {(d.section === 'income' ? incomeCategories : d.section === 'transfers' ? ['Transfer'] : expenseCategories).map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
                <select name="sort" defaultValue={d.sort} aria-label="Sort by">
                  <option value="date">Date</option>
                  <option value="amount">Amount</option>
                  <option value="description">Description</option>
                </select>
                <select name="dir" defaultValue={d.dir} aria-label="Sort direction">
                  <option value="desc">Descending</option>
                  <option value="asc">Ascending</option>
                </select>
                <button className="secondary">Apply</button>
              </Form>
              <TransactionTable rows={d.transactions} onEdit={edit} transfers={d.section === 'transfers'} />
              <div className="pagination">
                <span>{d.count ? `${(d.page - 1) * 20 + 1}–${Math.min(d.page * 20, d.count)} of ${d.count}` : '0 transactions'}</span>
                <div>
                  {d.page > 1 && (
                    <Link to={changePage(d.page - 1)}>
                      <ChevronLeft size={15} />
                      Previous
                    </Link>
                  )}
                  <span>Page {d.page}</span>
                  {d.page * 20 < d.count && (
                    <Link to={changePage(d.page + 1)}>
                      Next
                      <ChevronRight size={15} />
                    </Link>
                  )}
                </div>
              </div>
            </section>
          )}
          {d.section === 'budgets' && (
            <>
              <div className="section-heading">
                <h2>{monthName} budgets</h2>
                <button type="button" className="secondary" onClick={() => setModal({ type: 'budget' })}>
                  <Plus size={15} />
                  Set budget
                </button>
              </div>
              <div className="two-grid">
                {d.budgets.map((b) => (
                  <section className="panel budget-card" key={b.id}>
                    <Budget budget={b} />
                    <p className={b.spent > b.amount ? 'negative' : 'muted'}>
                      {b.spent > b.amount ? 'Over budget by ' : 'Remaining '}
                      {money(Math.abs(b.amount - b.spent))}
                    </p>
                    <div className="budget-actions">
                      <button type="button" className="secondary" onClick={() => setModal({ type: 'budget', value: b })}>
                        Edit limit
                      </button>
                      <DeleteForm intent="delete_budget" id={b.id} label="Remove limit" buttonClassName="secondary budget-remove" />
                    </div>
                  </section>
                ))}
              </div>
              {!d.budgets.length && <Empty text="No budgets yet. Give this month a little direction." />}
            </>
          )}
          {d.section === 'subscriptions' && (
            <>
              <div className="section-heading">
                <h2>Your recurring commitments</h2>
                <button className="text-button" onClick={() => setModal({ type: 'subscription' })}>
                  <Plus size={15} />
                  New subscription
                </button>
              </div>
              <p className="info-note">
                <CircleHelp size={16} />
                Active subscriptions automatically record expenses under their selected category in the selected account when you open the tracker. Missed
                billing dates are caught up. Paused, cancelled, and archived-account subscriptions are skipped.
              </p>
              <div className="three-grid">
                {d.subscriptions.map((s) => (
                  <button key={s.id} className="panel subscription-card" onClick={() => setModal({ type: 'subscription', value: s })}>
                    <div className="card-label">
                      <span className="summary-icon transfer">
                        <Repeat2 size={18} />
                      </span>
                      <span className={`tag ${s.status === 'active' ? 'positive' : ''}`}>{s.status}</span>
                    </div>
                    <h2>{s.name}</h2>
                    <strong className="balance">
                      {money(s.amount)}
                      <small> / {s.recurrence === 'weekly' ? 'week' : s.recurrence === 'monthly' ? 'month' : 'year'}</small>
                    </strong>
                    <p className="muted">
                      {s.category} · {s.account_name}
                    </p>
                    <div className="panel-footer">
                      Next due <strong>{s.next_due}</strong>
                    </div>
                  </button>
                ))}
              </div>
              {!d.subscriptions.length && <Empty text="No subscriptions yet. Add one to keep it in view." />}
            </>
          )}
          {d.section === 'goals' && (
            <>
              <div className="section-heading">
                <h2>Good things take a little planning</h2>
                <button className="text-button" onClick={() => setModal({ type: 'goal' })}>
                  <Plus size={15} />
                  New goal
                </button>
              </div>
              <p className="info-note">
                <CircleHelp size={16} />
                Goal contributions track allocations only. They do not move money between accounts or count as expenses. Progress is all time.
              </p>
              <div className="two-grid">
                {d.goals.map((g) => (
                  <section key={g.id} className="panel goal-card">
                    <div className="card-label">
                      <span className="summary-icon transfer">
                        <Flag size={20} />
                      </span>
                      <button className="text-button" onClick={() => setModal({ type: 'goal', value: g })}>
                        Edit goal
                      </button>
                    </div>
                    <h2>{g.name}</h2>
                    <strong className="balance">
                      {money(g.saved)}
                      <small> of {money(g.amount)}</small>
                    </strong>
                    <Progress value={(g.saved / g.amount) * 100} />
                    <div className="goal-details">
                      <span>Target {g.target_date}</span>
                      <strong>{Math.round((g.saved / g.amount) * 100)}%</strong>
                    </div>
                    <button className="secondary" onClick={() => setModal({ type: 'contribute', value: g })}>
                      <Plus size={14} />
                      Add allocation
                    </button>
                  </section>
                ))}
              </div>
              {!d.goals.length && <Empty text="A trip, a rainy day, a new beginning. What are you saving for?" />}
              {d.contributions.length > 0 && (
                <section className="panel table-panel">
                  <div className="panel-heading">
                    <h2>Recent goal allocations</h2>
                    <span className="small muted">Latest 100 · all time</span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Goal</th>
                          <th>Date</th>
                          <th>Amount</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {d.contributions.map((c) => (
                          <tr key={c.id}>
                            <td>{c.name}</td>
                            <td>{c.date}</td>
                            <td>{money(c.amount)}</td>
                            <td>
                              <DeleteForm intent="delete_contribution" id={c.id} label="Undo allocation" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </>
          )}
          {d.section === 'reports' && (
            <>
              <div className="report-stats">
                <Stat label="Monthly income" value={money(d.sum.income)} />
                <Stat label="Monthly expenses" value={money(d.sum.expense)} />
                <Stat label="Monthly net cash flow" value={money(d.sum.income - d.sum.expense)} />
              </div>
              <div className="two-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Income & expenses</h2>
                    <span className="small muted">6 months to {d.month}</span>
                  </div>
                  <DeferredTrendChart data={d.trends} />
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Spending by category</h2>
                  </div>
                  <DeferredSpendingChart data={d.spending} total={d.sum.expense} />
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Goal allocation trends</h2>
                  </div>
                  <DeferredTrendChart data={d.trends} savings />
                  <p className="chart-note">Amounts allocated to goals each month; not additional cash flow.</p>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>Account balances at month end</h2>
                  </div>
                  <div className="balance-list">
                    {d.monthBalances.map((w) => (
                      <div key={w.id}>
                        <span>
                          {w.name}
                          {w.archived ? ' · Archived' : ''}
                        </span>
                        <strong>{money(w.balance)}</strong>
                      </div>
                    ))}
                  </div>
                  <p className="chart-note">
                    Opening balances plus records through {d.month} month end. A balance-only summary, excluding untracked assets and liabilities. Transfers are
                    excluded from income and expenses.
                  </p>
                </section>
              </div>
            </>
          )}
          {d.section === 'import' && (
            <section className="panel import-panel">
              <h2>Bring your records together.</h2>
              <p className="muted">
                Preview and validate up to 1,000 rows (1 MB). Account names must match exactly. Dates use YYYY-MM-DD; amounts use positive {d.profile.currency}{' '}
                decimals, without currency symbols or thousands separators.
              </p>
              <code className="csv-example">
                date,kind,description,amount,account,destination,category,notes
                <br />
                2026-10-01,expense,Coffee,6.50,Everyday,,Food & dining,
              </code>
              <p className="small muted">
                Kinds: income, expense, transfer. Transfer category: Transfer. For transfers, supply a destination account. Other categories must match the
                categories available in the transaction form.
              </p>
              <Form method="post" encType="multipart/form-data" className="form-stack">
                <input type="hidden" name="intent" value="preview_import" />
                <label>
                  CSV file
                  <input type="file" name="file" accept=".csv,text/csv" />
                </label>
                <label>
                  Or paste CSV
                  <textarea name="csv" rows={6} placeholder="Paste CSV with the required header row" />
                </label>
                <button className="primary" disabled={pending}>
                  <Upload size={15} />
                  Preview import
                </button>
              </Form>
              {actionData && 'preview' in actionData && actionData.preview && (
                <div className="import-preview">
                  <h2>Review your import</h2>
                  <p>
                    {actionData.preview.length} rows · {actionData.preview.filter((r) => r.error).length} invalid ·{' '}
                    {actionData.preview.filter((r) => r.duplicate).length} duplicates
                  </p>
                  <div className="table-scroll preview-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Line</th>
                          <th>Description</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {actionData.preview.map((row) => (
                          <tr key={row.line}>
                            <td>{row.line}</td>
                            <td>{row.description}</td>
                            <td className={row.error ? 'negative' : row.duplicate ? 'muted' : 'positive'}>
                              {row.error || (row.duplicate ? 'Duplicate — will skip' : 'Ready')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <Form method="post" className="form-stack">
                    <input type="hidden" name="intent" value="commit_import" />
                    <input type="hidden" name="csv" value={actionData.csv} />
                    <label>
                      Duplicate handling
                      <select name="policy">
                        <option value="skip">Skip duplicate rows</option>
                        <option value="reject">Reject entire import if duplicates exist</option>
                      </select>
                    </label>
                    <button className="primary" disabled={pending || actionData.preview.some((r) => r.error)}>
                      Confirm import
                    </button>
                  </Form>
                  <p className="small muted">
                    Duplicates match date, type, amount, description (case insensitive), accounts, category, and notes. Matching rows are treated as duplicates,
                    even if intentional. The server validates the CSV again at confirmation; the entire import is atomic.
                  </p>
                </div>
              )}
              <div className="panel-footer">
                <span>Export all transaction history</span>
                <ExportLink className="secondary">
                  <Download size={15} />
                  Download CSV
                </ExportLink>
              </div>
              <p className="small muted">
                CSV exports exclude receipt files and are not a complete backup. Spreadsheet-formula prefixes are escaped for safe opening.
              </p>
            </section>
          )}
          <footer className="content-footer">
            <span>
              <span className="status-dot" />A little more clarity, every day.
            </span>
            <span>{d.profile.currency} · Asia/Singapore</span>
          </footer>
        </main>
      </div>
      {settingsOpen && (
        <UserSettings
          profile={d.profile}
          profiles={d.profiles}
          close={() => setSettingsOpen(false)}
          reset={() => {
            setSettingsOpen(false);
            setModal({ type: 'reset' });
          }}
        />
      )}
      {modal?.type === 'categories' && (
        <CategoryManager
          data={d}
          close={() => setModal(null)}
          edit={(value) => setModal({ type: 'category', value })}
          create={() => setModal({ type: 'category' })}
          pending={pending}
          error={actionData?.error}
        />
      )}
      {modal && modal.type !== 'categories' && (
        <Editor
          modal={modal}
          data={d}
          close={() => setModal(null)}
          pending={pending}
          error={actionData && 'error' in actionData ? actionData.error : undefined}
        />
      )}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty panel">
      <Cat size={30} strokeWidth={1.5} aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}
function Progress({ value }: { value: number }) {
  return (
    <div
      className={`progress ${value > 100 ? 'over' : ''}`}
      role="progressbar"
      aria-label="Progress"
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={Math.max(100, Math.round(value))}>
      <span style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
    </div>
  );
}
function Budget({ budget: b }: { budget: { category: string; spent: number; amount: number; all_months?: number } }) {
  const money = useMoney();
  return (
    <div className="budget">
      <div>
        <strong>
          {b.category}
          {b.all_months ? <small className="muted"> · All months</small> : null}
        </strong>
        <span className={b.spent > b.amount ? 'negative' : ''}>{Math.round((b.spent / b.amount) * 100)}%</span>
      </div>
      <Progress value={(b.spent / b.amount) * 100} />
      <p>
        <span>
          {money(b.spent)} <small>spent</small>
        </span>
        <span className="muted">of {money(b.amount)}</span>
      </p>
    </div>
  );
}
function DeleteForm({ intent, id, label, buttonClassName = 'text-button negative' }: { intent: string; id: string; label: string; buttonClassName?: string }) {
  return (
    <Form
      method="post"
      onSubmit={(e) => {
        if (!confirm(`${label}? This updates your records immediately.`)) {
          e.preventDefault();
        }
      }}>
      <input type="hidden" name="intent" value={intent} />
      <input type="hidden" name="id" value={id} />
      <button className={buttonClassName}>{label}</button>
    </Form>
  );
}
function Editor({ modal, data: d, close, pending, error }: { modal: Modal; data: DashboardData; close: () => void; pending: boolean; error?: string }) {
  const money = useMoney();
  const expenseCategories = d.categories.filter((c) => c.kind === 'expense').map((c) => c.name);
  const incomeCategories = d.categories.filter((c) => c.kind === 'income').map((c) => c.name);
  const dialog = useRef<HTMLDialogElement>(null);
  const v = modal.value || {};
  const [kind, setKind] = useState(v.kind || (d.section === 'income' ? 'income' : d.section === 'transfers' ? 'transfer' : 'expense'));
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const names = {
    entry: v.id ? 'Edit transaction' : 'A new transaction',
    wallet: v.id ? 'Edit account' : 'A new account',
    budget: 'A little plan for the month',
    subscription: v.id ? 'Edit subscription' : 'A new subscription',
    goal: v.id ? 'Edit savings goal' : 'Something to save for',
    contribute: 'A little closer to your goal',
    categories: 'Categories',
    category: v.id ? 'Edit category' : 'New category',
    reset: 'Reset workspace',
  };
  const field = (label: string, name: string, type = 'text', value: any = '', required = true) => (
    <label>
      {label}
      <input
        name={name}
        type={type}
        defaultValue={value}
        required={required}
        step={type === 'number' ? '0.01' : undefined}
        maxLength={name === 'notes' ? 2000 : 200}
      />
    </label>
  );
  const amount = (label = `Amount (${d.profile.currency})`, value = v.amount ? decimal(v.amount) : '') => field(label, 'amount', 'text', value);
  const accounts = (name = 'wallet_id', label = 'Account', value = v.wallet_id || '') => (
    <label>
      {label}
      <select name={name} defaultValue={value} required>
        <option value="" disabled>
          Select account
        </option>
        {d.wallets
          .filter((w) => !w.archived || w.id === value)
          .map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
              {w.archived ? ' (archived)' : ''}
            </option>
          ))}
      </select>
    </label>
  );
  const expenseCategory = (value = v.category || '') => (
    <label>
      Category
      <select name="category" defaultValue={value} required>
        <option value="" disabled>
          Select category
        </option>
        {expenseCategories.map((category) => (
          <option key={category} value={category}>
            {category}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <dialog
      ref={dialog}
      className="editor"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) {
          close();
        }
      }}>
      <div className="editor-inner">
        <div className="panel-heading">
          <h2>{names[modal.type]}</h2>
          <button type="button" className="icon-button" onClick={close} aria-label="Close editor">
            <X size={19} />
          </button>
        </div>
        <Form method="post" encType="multipart/form-data" className="form-stack">
          <input type="hidden" name="intent" value={modal.type === 'contribute' ? 'contribute' : modal.type} />
          {v.id && modal.type !== 'contribute' && <input type="hidden" name="id" value={v.id} />}
          {modal.type === 'reset' && (
            <>
              <p className="info-note">
                This permanently clears all accounts, transactions, receipts, budgets, subscriptions, savings goals, and the cover. Categories return to
                defaults. This cannot be undone.
              </p>
              <ExportLink className="text-button">Export transactions first (CSV excludes receipts)</ExportLink>
              {field('Type RESET to confirm', 'confirmation')}
            </>
          )}
          {modal.type === 'category' && (
            <>
              {field('Category name', 'name', 'text', v.name)}
              <label>
                Type
                <select name="kind" defaultValue={v.kind || 'expense'} disabled={!!v.id}>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </label>
              <p className="small muted">Renaming updates existing transactions and budgets.</p>
            </>
          )}
          {modal.type === 'entry' && (
            <>
              <label>
                Type
                <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="transfer">Transfer</option>
                </select>
              </label>
              {field('Description', 'description', 'text', v.description)}
              <div className="form-grid">
                {amount()}
                {field('Date (Singapore)', 'date', 'date', v.date || today())}
              </div>
              <div className="form-grid">
                {accounts('wallet_id', kind === 'transfer' ? 'From account' : 'Account')}
                {kind === 'transfer' ? (
                  accounts('destination_id', 'To account', v.destination_id || '')
                ) : (
                  <label>
                    Category
                    <select key={kind} name="category" defaultValue={v.kind === kind ? v.category : undefined} required>
                      {(kind === 'income' ? incomeCategories : expenseCategories).map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
              <label>
                Notes
                <textarea name="notes" rows={3} maxLength={2000} defaultValue={v.notes} />
              </label>
              <label>
                Receipt (optional · PDF, PNG, JPEG · 5 MB max)
                <input name="receipt" type="file" accept="application/pdf,image/png,image/jpeg" />
              </label>
              {v.id && (
                <label className="checkbox">
                  <input type="checkbox" name="remove_receipt" />
                  Remove existing receipt
                </label>
              )}
              {kind === 'transfer' && <p className="info-note">Transfers move money between accounts. They are excluded from income and spending.</p>}
            </>
          )}
          {modal.type === 'wallet' && (
            <>
              {field('Account name', 'name', 'text', v.name)}
              {field(`Opening balance (${d.profile.currency})`, 'opening', 'text', v.id ? decimal(v.opening) : '0.00')}
              <p className="small muted">The opening balance is added to every recorded transaction to calculate the current balance.</p>
              <label className="checkbox">
                <input type="checkbox" name="archived" defaultChecked={!!v.archived} />
                Archive account
              </label>
              <p className="small muted">Archived accounts remain in reports and total funds. Existing transactions can still be edited.</p>
              {v.id && <p className="info-note">Current balance: {money(v.balance)}. Balance adjustment and account deletion are available below.</p>}
            </>
          )}
          {modal.type === 'budget' && (
            <>
              <label>
                Category
                <select name="category" defaultValue={v.category}>
                  {expenseCategories.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              {field('Month', 'month', 'month', v.all_months ? d.month : v.month || d.month)}
              {amount(`Monthly limit (${d.profile.currency})`)}
              <label className="checkbox">
                <input type="checkbox" name="all_months" defaultChecked={Boolean(v.all_months)} />
                Apply to all months
              </label>
              <p className="small muted">
                Checked: replaces recurring limits from the selected month onward, keeping month-specific exceptions. Unchecked: overrides only the selected
                month.
              </p>
            </>
          )}
          {modal.type === 'subscription' && (
            <>
              {field('Subscription name', 'name', 'text', v.name)}
              <div className="form-grid">
                {amount()}
                {accounts()}
                {expenseCategory()}
              </div>
              <div className="form-grid">
                <label>
                  Recurrence
                  <select name="recurrence" defaultValue={v.recurrence || 'monthly'}>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                </label>
                {field('Next due', 'next_due', 'date', v.next_due || today())}
              </div>
              <label>
                Status
                <select name="status" defaultValue={v.status || 'active'}>
                  <option value="active">Active</option>
                  <option value="paused">Paused</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <p className="small muted">
                Active subscriptions deduct from the selected account on each due date. Past due dates create catch-up expenses when saved. Resuming a paused
                subscription also catches up missed dates; change Next due first to skip them.
              </p>
            </>
          )}
          {modal.type === 'goal' && (
            <>
              {field('Goal name', 'name', 'text', v.name)}
              {amount(`Target amount (${d.profile.currency})`)}
              {field('Target date', 'target_date', 'date', v.target_date || today())}
            </>
          )}
          {modal.type === 'contribute' && (
            <>
              <input type="hidden" name="goal_id" value={v.id} />
              <p>
                Allocate to <strong>{v.name}</strong>
              </p>
              {amount(`Allocation (${d.profile.currency})`, '')}
              {field('Date', 'date', 'date', today())}
              <p className="small muted">This allocation does not deduct from an account or create an expense. You can undo it from the allocation history.</p>
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="editor-actions">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            <button className="primary" disabled={pending}>
              {pending
                ? 'Saving…'
                : modal.type === 'reset'
                  ? 'Reset workspace'
                  : 'Save ' + (modal.type === 'entry' ? 'transaction' : modal.type === 'contribute' ? 'allocation' : modal.type)}
            </button>
          </div>
        </Form>
        {modal.type === 'wallet' && v.id && (
          <>
            <Form method="post" className="form-stack">
              <h3>Adjust wallet balance</h3>
              <input type="hidden" name="intent" value="adjust_wallet" />
              <input type="hidden" name="id" value={v.id} />
              {field(`Correct current balance (${d.profile.currency})`, 'balance', 'text', decimal(v.balance))}
              <p className="small muted">
                Updates the opening balance by the difference. Historical balances change; transactions, income, and spending stay the same. Includes future
                transactions.
              </p>
              <button className="secondary" disabled={pending}>
                Adjust balance
              </button>
            </Form>
            <br></br>
            <Form method="post" className="form-stack">
              <h3>Delete wallet</h3>
              <input type="hidden" name="intent" value="delete_wallet" />
              <input type="hidden" name="id" value={v.id} />
              <label>
                Transaction handling
                <select name="policy" defaultValue="keep">
                  <option value="keep">Keep transactions — archive wallet</option>
                  <option value="delete">Permanently delete wallet and linked records</option>
                </select>
              </label>
              <p className="small muted">
                Archiving keeps reports and total funds. Permanent deletion removes linked transactions, receipts, subscriptions, and both sides of transfers,
                changing other wallet balances. This cannot be undone.
              </p>
              {field('For permanent deletion, type DELETE', 'confirmation', 'text', '', false)}
              <button className="secondary negative" disabled={pending}>
                Apply wallet removal
              </button>
            </Form>
          </>
        )}
        {modal.type === 'entry' && v.id && (
          <div className="delete-area">
            <DeleteForm intent="delete_entry" id={v.id} label="Delete transaction" />
          </div>
        )}
      </div>
    </dialog>
  );
}

function CategoryManager({
  data,
  close,
  edit,
  create,
  pending,
}: {
  data: DashboardData;
  close: () => void;
  edit: (value: { id: string; name: string; kind: string }) => void;
  create: () => void;
  pending: boolean;
  error?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const fetcher = useFetcher<typeof action>();
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="editor"
      aria-label="Manage categories"
      onCancel={close}
      onClick={(e) => {
        if (e.target === dialog.current) {
          close();
        }
      }}>
      <div className="editor-inner">
        <div className="panel-heading">
          <h2>Categories</h2>
          <button className="icon-button" onClick={close} aria-label="Close categories">
            <X size={19} />
          </button>
        </div>
        <p className="small muted">
          Deleting moves transactions and budgets to Other. Overlapping budget limits are added together. Other is the fallback and cannot be changed.
        </p>
        <div className="category-list">
          {(['expense', 'income'] as const).map((kind) => (
            <section key={kind}>
              <h2>{kind === 'expense' ? 'Expenses' : 'Income'}</h2>
              {data.categories
                .filter((c) => c.kind === kind)
                .map((c) => (
                  <div className="category-row" key={c.id}>
                    <span>{c.name}</span>
                    {c.name !== 'Other' && (
                      <div className="category-actions">
                        <button className="text-button" disabled={pending || fetcher.state !== 'idle'} onClick={() => edit(c)}>
                          Edit
                        </button>
                        <fetcher.Form
                          method="post"
                          onSubmit={(e) => {
                            if (!confirm('Delete "' + c.name + '"? Its transactions and budgets will move to Other. Overlapping budgets will be combined.')) {
                              e.preventDefault();
                            }
                          }}>
                          <input type="hidden" name="intent" value="delete_category" />
                          <input type="hidden" name="id" value={c.id} />
                          <button className="text-button negative" disabled={fetcher.state !== 'idle'}>
                            Delete
                          </button>
                        </fetcher.Form>
                      </div>
                    )}
                  </div>
                ))}
            </section>
          ))}
        </div>
        {fetcher.data?.error && (
          <p className="error" role="alert">
            {fetcher.data.error}
          </p>
        )}
        {fetcher.data?.message && (
          <p className="small" role="status">
            {fetcher.data.message}
          </p>
        )}
        <div className="editor-actions">
          <button className="secondary" onClick={close}>
            Done
          </button>
          <button className="primary" onClick={create} disabled={fetcher.state !== 'idle'}>
            <Plus size={14} />
            New category
          </button>
        </div>
      </div>
    </dialog>
  );
}
