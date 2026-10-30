import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Legend, LineChart, Line,
} from 'recharts';
import { Cat } from 'lucide-react';
import { useMoney } from '../lib/preferences';

const palette = ['#b99aff', '#73d9ae', '#f2c779', '#7dbff1', '#f28fb1', '#b4dc78', '#929dff', '#f3a574', '#9eaac2'];
const tooltipStyle = { background: '#211d30', border: '1px solid #444', borderRadius: 8 };

export function SpendingChart({ data, total }: {
  data: { category: string; amount: number }[];
  total: number;
}) {
  const hasSpending = data.some(row => row.amount > 0);
  const money = useMoney();
  return (
    <div className="spending-content">
      <div className="donut">
        {hasSpending ? (
          <ResponsiveContainer width="100%" height={215} minWidth={0} initialDimension={{ width: 240, height: 215 }}>
            <PieChart>
              <Pie data={data} dataKey="amount" nameKey="category" innerRadius={71} outerRadius={94}
                paddingAngle={data.length > 1 ? 4 : 0} stroke="none" isAnimationActive={false}>
                {data.map((row, i) => <Cell key={row.category} fill={palette[i % palette.length]} />)}
              </Pie>
              <Tooltip formatter={value => money(Number(value))} contentStyle={tooltipStyle} />
            </PieChart>
          </ResponsiveContainer>
        ) : <div className="donut-empty-ring" aria-hidden="true" />}
        <div className="donut-label">
          <small>THIS MONTH</small>
          <strong>{money(total)}</strong>
          <span>total spending</span>
        </div>
      </div>
      <div className="legend">
        {hasSpending ? data.map((row, i) => (
          <div key={row.category}>
            <span><i style={{ background: palette[i % palette.length] }} />{row.category}</span>
            <strong>{money(row.amount)}</strong>
          </div>
        )) : <p className="muted">No expenses recorded this month. Your spending breakdown will appear after you add one.</p>}
      </div>
    </div>
  );
}

export function TrendChart({ data, savings = false }: {
  data: { month: string; income: number; expense: number; savings: number }[];
  savings?: boolean;
}) {
  const hasIncome = data.some(row => row.income > 0);
  const money = useMoney();
  const hasExpenses = data.some(row => row.expense > 0);
  const hasData = savings ? data.some(row => row.savings > 0) : hasIncome || hasExpenses;
  if (!hasData) {
    return (
      <div className="trend-chart chart-empty" role="status">
        <Cat size={30} strokeWidth={1.5} aria-hidden="true" />
        <strong>{savings ? 'No goal allocations yet' : 'No income or expenses yet'}</strong>
        <p>{savings
          ? 'Add a contribution to a savings goal to see its trend over these six months.'
          : 'Record income or an expense in this six-month period to see your cash flow.'}</p>
      </div>
    );
  }
  return (
    <div className="trend-chart">
      <ResponsiveContainer width="100%" height={260} minWidth={0} initialDimension={{ width: 320, height: 260 }}>
        {savings ? (
          <LineChart data={data}>
            <CartesianGrid stroke="#303035" vertical={false} />
            <XAxis dataKey="month" stroke="#999" fontSize={11} />
            <YAxis stroke="#999" fontSize={11} tickFormatter={value => money(value)} />
            <Tooltip formatter={value => money(Number(value))} contentStyle={tooltipStyle} />
            <Line type="monotone" dataKey="savings" name="Goal allocations" stroke="#b99aff" strokeWidth={3} isAnimationActive={false} />
          </LineChart>
        ) : (
          <BarChart data={data}>
            <CartesianGrid stroke="#303035" vertical={false} />
            <XAxis dataKey="month" stroke="#999" fontSize={11} />
            <YAxis stroke="#999" fontSize={11} tickFormatter={value => money(value)} />
            <Tooltip formatter={value => money(Number(value))} contentStyle={tooltipStyle} />
            <Legend />
            <Bar dataKey="income" name="Income" fill="#73d9ae" radius={[4, 4, 0, 0]} isAnimationActive={false} />
            <Bar dataKey="expense" name="Expenses" fill="#b99aff" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        )}
      </ResponsiveContainer>
      {!savings && (!hasIncome || !hasExpenses) && (
        <p className="chart-series-note">No {hasIncome ? 'expenses' : 'income'} recorded in this six-month period.</p>
      )}
    </div>
  );
}
