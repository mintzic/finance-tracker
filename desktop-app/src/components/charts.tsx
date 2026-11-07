import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, LineChart, Line } from 'recharts';
import { Cat } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { useMoney } from '@/lib/preferences';

const palette = ['var(--theme-accent)', '#73d9ae', '#f2c779', '#7dbff1', '#f28fb1', '#b4dc78', '#929dff', '#f3a574', '#9eaac2'];
const tooltipStyle = { background: 'var(--theme-surface)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 8 };

export function SpendingChart({ data, total, income = false }: { data: { category: string; amount: number }[]; total: number; income?: boolean }) {
  const hasSpending = data.some((row) => row.amount > 0);
  const money = useMoney();
  const [tooltipPortal, setTooltipPortal] = useState<HTMLElement | null>(null);
  const [tooltipPosition, setTooltipPosition] = useState<CSSProperties>({ left: 0, top: 0 });
  useEffect(() => setTooltipPortal(document.body), []);
  const positionTooltip = (element: HTMLElement, clientX?: number, clientY?: number) => {
    const bounds = element.getBoundingClientRect();
    const x = clientX ?? bounds.right;
    const y = clientY ?? bounds.top;
    const onRight = x >= bounds.left + bounds.width / 2;
    setTooltipPosition({
      left: onRight ? x + 14 : undefined,
      right: onRight ? undefined : window.innerWidth - x + 14,
      top: Math.max(8, Math.min(y + 14, window.innerHeight - 70)),
      maxWidth: Math.max(0, (onRight ? window.innerWidth - x : x) - 22),
    });
  };
  return (
    <div className="spending-content">
      <div
        className="donut"
        onPointerMove={(event) => positionTooltip(event.currentTarget, event.clientX, event.clientY)}
        onFocusCapture={(event) => positionTooltip(event.currentTarget)}>
        {hasSpending ? (
          <ResponsiveContainer width="100%" height={215} minWidth={0} initialDimension={{ width: 240, height: 215 }}>
            <PieChart>
              <Pie
                data={data}
                dataKey="amount"
                nameKey="category"
                innerRadius={71}
                outerRadius={94}
                paddingAngle={data.length > 1 ? 4 : 0}
                stroke="none"
                isAnimationActive={true}>
                {data.map((row, i) => (
                  <Cell key={row.category} fill={palette[i % palette.length]} />
                ))}
              </Pie>
              <Tooltip
                portal={tooltipPortal}
                formatter={(value) => money(Number(value))}
                contentStyle={{ ...tooltipStyle, color: 'var(--theme-text)', overflowWrap: 'anywhere' }}
                wrapperStyle={{ position: 'fixed', ...tooltipPosition, zIndex: 1000, pointerEvents: 'none' }}
              />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="donut-empty-ring" aria-hidden="true" />
        )}
        <div className="donut-label">
          <small>THIS MONTH</small>
          <strong>{money(total)}</strong>
          <span>{income ? 'total income' : 'total spending'}</span>
        </div>
      </div>
      <div className="legend">
        {hasSpending ? (
          data.map((row, i) => (
            <div key={row.category}>
              <span>
                <i style={{ background: palette[i % palette.length] }} />
                {row.category}
              </span>
              <strong>{money(row.amount)}</strong>
            </div>
          ))
        ) : (
          <p className="muted">
            {income
              ? 'No income recorded this month. Your income breakdown will appear after you add one.'
              : 'No expenses recorded this month. Your spending breakdown will appear after you add one.'}
          </p>
        )}
      </div>
    </div>
  );
}

export function TrendChart({
  data,
  savings = false,
  series,
}: {
  data: { month: string; income: number; expense: number; savings: number }[];
  savings?: boolean;
  series?: 'income' | 'expense';
}) {
  const hasIncome = data.some((row) => row.income > 0);
  const money = useMoney();
  const hasExpenses = data.some((row) => row.expense > 0);
  const hasData = savings
    ? data.some((row) => row.savings > 0)
    : series === 'income'
      ? hasIncome
      : series === 'expense'
        ? hasExpenses
        : hasIncome || hasExpenses;

  if (!hasData) {
    return (
      <div className="trend-chart chart-empty" role="status">
        <Cat size={30} strokeWidth={1.5} aria-hidden="true" />
        <strong>{savings ? 'No goal allocations yet' : series ? `No ${series === 'income' ? 'income' : 'expenses'} yet` : 'No income or expenses yet'}</strong>
        <p>
          {savings
            ? 'Add a contribution to a savings goal to see its trend over these six months.'
            : series
              ? `Record ${series === 'income' ? 'income' : 'an expense'} in this six-month period to see the trend.`
              : 'Record income or an expense in this six-month period to see your cash flow.'}
        </p>
      </div>
    );
  }

  return (
    <div className="trend-chart">
      <ResponsiveContainer width="100%" height={260} minWidth={0} initialDimension={{ width: 320, height: 260 }}>
        {savings ? (
          <LineChart data={data}>
            <CartesianGrid stroke="var(--theme-border)" vertical={false} />
            <XAxis dataKey="month" stroke="var(--theme-muted)" fontSize={11} />
            <YAxis stroke="var(--theme-muted)" fontSize={11} tickFormatter={(value) => money(value)} />
            <Tooltip formatter={(value) => money(Number(value))} contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="savings" name="Goal allocations" stroke="var(--theme-accent)" strokeWidth={3} isAnimationActive={true} />
          </LineChart>
        ) : (
          <BarChart data={data}>
            <CartesianGrid stroke="var(--theme-border)" vertical={false} />
            <XAxis dataKey="month" stroke="var(--theme-muted)" fontSize={11} />
            <YAxis stroke="var(--theme-muted)" fontSize={11} tickFormatter={(value) => money(value)} />
            <Tooltip formatter={(value) => money(Number(value))} contentStyle={tooltipStyle} />
            <Legend />
            {series !== 'expense' && <Bar dataKey="income" name="Income" fill="var(--theme-positive)" radius={[4, 4, 0, 0]} isAnimationActive={true} />}
            {series !== 'income' && <Bar dataKey="expense" name="Expenses" fill="var(--theme-accent)" radius={[4, 4, 0, 0]} isAnimationActive={true} />}
          </BarChart>
        )}
      </ResponsiveContainer>
      {!savings && !series && (!hasIncome || !hasExpenses) && (
        <p className="chart-series-note">No {hasIncome ? 'expenses' : 'income'} recorded in this six-month period.</p>
      )}
    </div>
  );
}
