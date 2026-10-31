import { createContext, useContext } from 'react';
import { money } from './money';

export const Preferences = createContext({ language: 'en-SG', currency: 'SGD' });
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
    'My workspace': '我的工作区',
    'User settings': '用户设置',
    'Change profile': '修改个人资料',
    'Change language': '更改语言',
    'Change currency': '更改货币',
    'Switch user': '切换用户',
    'Add user': '添加用户',
    'Reset workspace': '重置工作区',
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
    'My workspace': 'Ruang kerja saya',
    'User settings': 'Tetapan pengguna',
    'Change profile': 'Ubah profil',
    'Change language': 'Ubah bahasa',
    'Change currency': 'Ubah mata wang',
    'Switch user': 'Tukar pengguna',
    'Add user': 'Tambah pengguna',
    'Reset workspace': 'Tetapkan semula ruang kerja',
  },
};
export const translate = (language: string, text: string) => translations[language]?.[text] || text;
