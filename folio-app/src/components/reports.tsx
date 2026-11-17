import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router';
import type { DashboardData } from '@/lib/types';
import { useMoney } from '@/lib/preferences';
import './reports.css';

const SpendingChart = lazy(() => import('./charts').then((module) => ({ default: module.SpendingChart })));
const TrendChart = lazy(() => import('./charts').then((module) => ({ default: module.TrendChart })));

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel stat">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

const id = 'reports';

export function ReportTabs() {
  const [params, setParams] = useSearchParams();
  const total = params.get('report') === 'total';
  const select = (value: 'monthly' | 'total') => {
    const next = new URLSearchParams(params);

    if (value === 'total') {
      next.set('report', value);
    } else {
      next.delete('report');
    }

    setParams(next, { preventScrollReset: true });
  };
  return (
      <div className="report-tabs" role="tablist" aria-label="Report period">
        {(['monthly', 'total'] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            id={`${id}-${value}`}
            aria-selected={total === (value === 'total')}
            aria-controls={`${id}-panel`}
            tabIndex={total === (value === 'total') ? 0 : -1}
            onClick={() => select(value)}
            onKeyDown={(event) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
                event.preventDefault();
                const next = event.key === 'Home' ? 'monthly' : event.key === 'End' ? 'total' : value === 'monthly' ? 'total' : 'monthly';
                document.getElementById(`${id}-${next}`)?.focus();
                select(next);
              }
            }}>
            {value === 'monthly' ? 'Monthly' : 'All time'}
          </button>
        ))}
      </div>
  );
}

export function Reports({ data: d }: { data: DashboardData }) {
  const [params] = useSearchParams();
  const total = params.get('report') === 'total';
  const all = d.allTime;
  const money = useMoney();
  const formatDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(d.profile.language, { day: 'numeric', month: 'short', year: 'numeric' });
  const sum = total && all ? all.sum : d.sum;
  const trends = total && all ? all.trends : d.trends;
  const balances = total ? d.accounts : d.monthBalances;
  const period = total ? 'all recorded years' : 'this six-month period';

  return (
    <>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${total ? 'total' : 'monthly'}`} tabIndex={0}>
        <div className="report-period">
          <h2>
            {total
              ? 'Your ledger, all together'
              : new Date(`${d.month}-01T12:00:00`).toLocaleDateString(d.profile.language, { month: 'long', year: 'numeric' })}
          </h2>
          <p className="muted small">
            {total
              ? all?.firstDate && all.lastDate
                ? `${formatDate(all.firstDate)} – ${formatDate(all.lastDate)} · All recorded dates, independent of the month picker.`
                : 'No transactions or goal allocations recorded yet.'
              : 'A snapshot of the selected month, with six-month trends.'}
          </p>
        </div>
        <div className="report-stats">
          <Stat label={total ? 'Total income' : 'Monthly income'} value={money(sum.income)} />
          <Stat label={total ? 'Total expenses' : 'Monthly expenses'} value={money(sum.expense)} />
          <Stat label={total ? 'Total net cash flow' : 'Monthly net cash flow'} value={money(sum.income - sum.expense)} />
        </div>
        {total && all && (
          <div className="report-stats">
            <Stat label="Total goal allocations" value={money(all.allocationTotal)} />
            <Stat label="Recorded transactions" value={all.transactionCount.toLocaleString(d.profile.language)} />
            <Stat
              label="Income retained"
              value={
                sum.income > 0 ? `${(((sum.income - sum.expense) / sum.income) * 100).toLocaleString(d.profile.language, { maximumFractionDigits: 1 })}%` : '—'
              }
            />
          </div>
        )}
        <Suspense
          fallback={
            <div className="chart-empty" role="status">
              Loading report charts…
            </div>
          }>
          <div className="two-grid">
            <section className="panel">
              <div className="panel-heading">
                <h2>Income & expenses</h2>
                <span className="small muted">{total ? 'Recorded years · all time' : `6 months to ${d.month}`}</span>
              </div>
              <TrendChart data={trends} periodLabel={period} appearanceKey={total ? 'All-time cash flow trend' : undefined} />
              {total && <p className="chart-note">Each column represents a year with recorded activity. Years without records are omitted.</p>}
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>Spending by category</h2>
              </div>
              <SpendingChart
                data={total && all ? all.spending : d.spending}
                total={sum.expense}
                periodLabel={total ? 'All time' : 'This month'}
                appearanceKey={total ? 'All-time spending donut' : undefined}
              />
            </section>
            {total && all && (
              <section className="panel">
                <div className="panel-heading">
                  <h2>Income by category</h2>
                </div>
                <SpendingChart data={all.incomeByCategory} total={sum.income} income periodLabel="All time" appearanceKey="All-time income donut" />
              </section>
            )}
            <section className="panel">
              <div className="panel-heading">
                <h2>Goal allocation trends</h2>
                {total && <span className="small muted">Recorded years · all time</span>}
              </div>
              <TrendChart data={trends} savings periodLabel={period} appearanceKey={total ? 'All-time allocation trend' : undefined} />
              <p className="chart-note">
                Amounts allocated to goals {total ? 'in each recorded year; years without records are omitted' : 'each month'}; not additional cash flow.
              </p>
            </section>
            <section className="panel">
              <div className="panel-heading">
                <h2>{total ? 'Account balances · all records' : 'Account balances at month end'}</h2>
              </div>
              <div className="balance-list">
                {balances.map((account) => (
                  <div key={account.id}>
                    <span>
                      {account.name}
                      {account.archived ? ' · Archived' : ''}
                    </span>
                    <strong>{money(account.balance)}</strong>
                  </div>
                ))}
              </div>
              {!balances.length && <p className="muted">No accounts yet.</p>}
              <p className="chart-note">
                Opening balances plus {total ? 'all recorded transactions' : `records through ${d.month} month end`}. A balance-only summary, excluding
                untracked assets and liabilities. Transfers are excluded from income and expenses.
              </p>
            </section>
            {total && (
              <section className="panel report-explanation">
                <div className="panel-heading">
                  <h2>About these totals</h2>
                </div>
                <p className="muted">
                  All-time statistics cover this ledger only, including any future-dated records. Transfers move money between accounts and do not count as
                  income or expenses.
                </p>
                <p className="chart-note">
                  Net cash flow is income minus expenses, excluding opening balances. Income retained is net cash flow as a percentage of income. Goal
                  allocations are tracked separately and are not deducted again.
                </p>
              </section>
            )}
          </div>
        </Suspense>
      </div>
    </>
  );
}
