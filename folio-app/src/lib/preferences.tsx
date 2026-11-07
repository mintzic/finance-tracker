import { createContext, useContext } from 'react';
import { money } from './money';

export const Preferences = createContext({ language: 'en-SG', currency: 'USD' });
export function useMoney() {
  const { language, currency } = useContext(Preferences);
  return (value: number) => money(value, language, currency);
}
const translations: Record<string, Record<string, string>> = {
  'zh-SG': {
    Overview: '总览',
    Accounts: '账户',
    Income: '收入',
    Expenses: '支出',
    Transfers: '转账',
    Budgets: '预算',
    Subscriptions: '订阅',
    'Savings goals': '储蓄目标',
    Reports: '报告',
    Categories: '分类',
    'Import & export': '导入与导出',
    'My ledger': '我的账本',
    'User settings': '用户设置',
    'Change profile': '修改个人资料',
    'Change language': '更改语言',
    'Reset ledger': '重置账本',
  },
  'ms-MY': {
    Overview: 'Gambaran keseluruhan',
    Accounts: 'Akaun',
    Income: 'Pendapatan',
    Expenses: 'Perbelanjaan',
    Transfers: 'Pindahan',
    Budgets: 'Belanjawan',
    Subscriptions: 'Langganan',
    'Savings goals': 'Matlamat simpanan',
    Reports: 'Laporan',
    Categories: 'Kategori',
    'Import & export': 'Import & eksport',
    'My ledger': 'Lejar saya',
    'User settings': 'Tetapan pengguna',
    'Change profile': 'Ubah profil',
    'Change language': 'Ubah bahasa',
    'Reset ledger': 'Tetapkan semula lejar',
  },
};
export const translate = (language: string, text: string) => translations[language]?.[text] || text;
