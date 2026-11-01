export const balancesSQL = `SELECT w.*, w.opening+COALESCE((SELECT SUM(CASE WHEN e.kind='income' THEN e.amount ELSE -e.amount END) FROM entries e WHERE e.wallet_id=w.id AND e.date<=?),0)+COALESCE((SELECT SUM(e.amount) FROM entries e WHERE e.destination_id=w.id AND e.date<=?),0) AS balance FROM wallets w ORDER BY w.archived,w.name`;
export const monthlySummarySQL = `SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount ELSE 0 END),0) income, COALESCE(SUM(CASE WHEN kind='expense' THEN amount ELSE 0 END),0) expense FROM entries WHERE date>=? AND date<?`;

export const monthlyBudgetsSQL = `SELECT b.*,COALESCE((SELECT SUM(e.amount) FROM entries e WHERE e.category=b.category AND e.kind='expense' AND e.date>=@start AND e.date<@end),0) spent FROM budgets b
WHERE (b.month=@month OR (b.all_months=1 AND b.month<=@month))
AND NOT EXISTS (SELECT 1 FROM budgets newer WHERE newer.category=b.category AND newer.month>b.month
  AND (newer.month=@month OR (newer.all_months=1 AND newer.month<=@month))) ORDER BY b.category`;
