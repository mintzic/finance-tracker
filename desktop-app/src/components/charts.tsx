import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, Legend, LineChart, Line } from 'recharts';
import { Cat } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useMoney } from '@/lib/preferences';

import { chartDefaults, useComponentAppearance } from './component-appearance';
import { ChartAppearance, palettes } from './chart-appearance';
const tooltipStyle = { background: 'var(--theme-surface)', color: 'var(--theme-text)', border: '1px solid var(--theme-border)', borderRadius: 8 };

function DonutAmount({ value }: { value: string }) {
  const container = useRef<HTMLElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const fit = () => {
      if (!container.current || !text.current) {
        return;
      }

      const available = container.current.clientWidth;
      const natural = text.current.scrollWidth;
      text.current.style.transform = `scale(${natural ? Math.min(1, available / natural) : 1})`;
    };
    fit();
    const observer = new ResizeObserver(fit);

    if (container.current) {
      observer.observe(container.current);
    }

    if (text.current) {
      observer.observe(text.current);
    }

    return () => observer.disconnect();
  }, [value]);
  return (
    <strong ref={container} className="donut-amount" title={value}>
      <span ref={text} className="donut-amount-text">
        {value}
      </span>
    </strong>
  );
}

export function SpendingChart({
  data,
  total,
  income = false,
  appearanceKey,
}: {
  data: { category: string; amount: number }[];
  total: number;
  income?: boolean;
  appearanceKey?: string;
}) {
  const scope = appearanceKey ?? (income ? 'Income donut' : 'Spending donut');
  const { settings, update, status } = useComponentAppearance(scope, chartDefaults);
  const palette = palettes[settings.palette];
  const height = settings.height === 'default' ? 215 : Number(settings.height);
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
    <div className="component-appearance spending-appearance">
      <ChartAppearance settings={settings} update={update} status={status} scope={scope} donut />
      <div className={`spending-content ${settings.legend ? '' : 'without-legend'}`}>
        <div
          className="donut"
          style={{ height }}
          onPointerMove={(event) => positionTooltip(event.currentTarget, event.clientX, event.clientY)}
          onFocusCapture={(event) => positionTooltip(event.currentTarget)}>
          {hasSpending ? (
            <ResponsiveContainer width="100%" height={height} minWidth={0} initialDimension={{ width: 240, height: 215 }}>
              <PieChart>
                <Pie
                  data={data}
                  dataKey="amount"
                  nameKey="category"
                  innerRadius={94 - Number(settings.thickness)}
                  outerRadius={94}
                  paddingAngle={data.length > 1 ? 4 : 0}
                  stroke="none"
                  isAnimationActive={settings.animation}>
                  {data.map((row, i) => (
                    <Cell key={row.category} fill={palette[i % palette.length]} />
                  ))}
                </Pie>
                {settings.tooltips && (
                  <Tooltip
                    portal={tooltipPortal}
                    formatter={(value) => money(Number(value))}
                    contentStyle={{ ...tooltipStyle, color: 'var(--theme-text)', overflowWrap: 'anywhere' }}
                    wrapperStyle={{ position: 'fixed', ...tooltipPosition, zIndex: 1000, pointerEvents: 'none' }}
                  />
                )}
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="donut-empty-ring" style={{ borderWidth: Number(settings.thickness), marginTop: (height - 188) / 2 }} aria-hidden="true" />
          )}
          <div className="donut-label" style={{ width: (94 - Number(settings.thickness)) * 2 - 16, maxWidth: 'calc(100% - 24px)', margin: 'auto' }}>
            <small>THIS MONTH</small>
            <DonutAmount value={money(total)} />
            <span>{income ? 'total income' : 'total spending'}</span>
          </div>
        </div>
        {settings.legend && (
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
        )}
      </div>
    </div>
  );
}

export function TrendChart({
  data,
  savings = false,
  series,
  appearanceKey,
}: {
  data: { month: string; income: number; expense: number; savings: number }[];
  savings?: boolean;
  series?: 'income' | 'expense';
  appearanceKey?: string;
}) {
  const scope = appearanceKey ?? (savings ? 'Savings trend' : series ? `${series === 'income' ? 'Income' : 'Expense'} trend` : 'Combined cash flow trend');
  const { settings, update, status } = useComponentAppearance(scope, chartDefaults);
  const height = settings.height === 'default' ? 260 : Number(settings.height);
  const toolbar = <ChartAppearance settings={settings} update={update} status={status} scope={scope} savings={savings} series={series} />;
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
      <div className="component-appearance">
        {toolbar}
        <div className="trend-chart chart-empty" style={{ minHeight: height }} role="status">
          <Cat size={30} strokeWidth={1.5} aria-hidden="true" />
          <strong>
            {savings ? 'No goal allocations yet' : series ? `No ${series === 'income' ? 'income' : 'expenses'} yet` : 'No income or expenses yet'}
          </strong>
          <p>
            {savings
              ? 'Add a contribution to a savings goal to see its trend over these six months.'
              : series
                ? `Record ${series === 'income' ? 'income' : 'an expense'} in this six-month period to see the trend.`
                : 'Record income or an expense in this six-month period to see your cash flow.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="component-appearance">
      {toolbar}
      <div className="trend-chart" style={{ minHeight: height }}>
        <ResponsiveContainer width="100%" height={height} minWidth={0} initialDimension={{ width: 320, height: 260 }}>
          {savings ? (
            <LineChart data={data}>
              {settings.grid && <CartesianGrid stroke="var(--theme-border)" vertical={false} />}
              <XAxis dataKey="month" stroke="var(--theme-muted)" fontSize={11} />
              <YAxis stroke="var(--theme-muted)" fontSize={11} tickFormatter={(value) => money(value)} />
              {settings.tooltips && <Tooltip formatter={(value) => money(Number(value))} contentStyle={tooltipStyle} />}
              {settings.legend && <Legend />}
              <Line
                type="monotone"
                dataKey="savings"
                name="Goal allocations"
                stroke={settings.savingsColor || 'var(--theme-accent)'}
                strokeWidth={3}
                isAnimationActive={settings.animation}
              />
            </LineChart>
          ) : (
            <BarChart data={data}>
              {settings.grid && <CartesianGrid stroke="var(--theme-border)" vertical={false} />}
              <XAxis dataKey="month" stroke="var(--theme-muted)" fontSize={11} />
              <YAxis stroke="var(--theme-muted)" fontSize={11} tickFormatter={(value) => money(value)} />
              {settings.tooltips && <Tooltip formatter={(value) => money(Number(value))} contentStyle={tooltipStyle} />}
              {settings.legend && <Legend />}
              {series !== 'expense' && (
                <Bar
                  dataKey="income"
                  name="Income"
                  fill={settings.incomeColor || 'var(--theme-positive)'}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={settings.animation}
                />
              )}
              {series !== 'income' && (
                <Bar
                  dataKey="expense"
                  name="Expenses"
                  fill={settings.expenseColor || 'var(--theme-accent)'}
                  radius={[4, 4, 0, 0]}
                  isAnimationActive={settings.animation}
                />
              )}
            </BarChart>
          )}
        </ResponsiveContainer>
        {!savings && !series && (!hasIncome || !hasExpenses) && (
          <p className="chart-series-note">No {hasIncome ? 'expenses' : 'income'} recorded in this six-month period.</p>
        )}
      </div>
    </div>
  );
}
