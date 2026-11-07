export type Profile = { id: string; username: string; language: string; currency: string; legacy: number };
export type ProfilesData = { profile: Profile | null; profiles: Profile[] };
export type Entry = {
  id: string; kind: string; date: string; description: string; amount: number;
  wallet_id: string; destination_id: string | null; category: string; notes: string;
  fingerprint: string | null; account_name?: string; destination_name?: string; receipt_id?: string;
};
export type Wallet = { id: string; name: string; opening: number; balance: number; archived: number; currency: string };
export type ImportRow = { line: number; description: string; error?: string; duplicate: boolean; value?: Record<string, unknown> };
export type ActionResult = { error?: string; message?: string; preview?: ImportRow[]; csv?: string };
export type DashboardData = {
  profile: Profile; profiles: Profile[]; month: string; section: string;
  categories: { id: string; kind: string; name: string }[];
  cover: { version: string; position: number } | null;
  sum: { income: number; expense: number };
  spending: { category: string; amount: number }[];
  incomeByCategory: { category: string; amount: number }[];
  budgets: { id: string; category: string; amount: number; spent: number; month: string; all_months: number }[];
  wallets: Wallet[]; monthBalances: Wallet[];
  goals: { id: string; name: string; amount: number; target_date: string; saved: number }[];
  subscriptions: { id: string; name: string; amount: number; category: string; wallet_id: string; account_name: string; recurrence: string; next_due: string; status: string }[];
  contributions: { id: string; goal_id: string; name: string; amount: number; date: string }[];
  trends: { month: string; income: number; expense: number; savings: number }[];
  transactions: Entry[]; recentExpenses: Entry[]; recentIncome: Entry[]; recentTransfers: Entry[];
  count: number; page: number; q: string; account: string; category: string; sort: string; dir: string; edit?: Entry | null;
};
export type NativeAsset = { bytes: number[]; mime: string; filename: string };
export type SerializedFile = { name: string; mime: string; bytes: number[] };
export type SerializedForm = Record<string, string | SerializedFile>;
