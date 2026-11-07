import { useContext } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Paperclip, Pencil, Cat } from 'lucide-react';
import { Preferences, useMoney } from '@/lib/preferences';
import type { Transaction } from '@/lib/types';
import { ReceiptLink } from './native-assets';

// Filtering, sorting, and pagination are handled by the dashboard loader.
export function TransactionTable({ rows, onEdit, transfers = false }: { rows: Transaction[]; onEdit: (transaction: Transaction) => void; transfers?: boolean }) {
  const money = useMoney();
  const { language } = useContext(Preferences);
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Transaction</th>
            <th>{transfers ? 'From Account' : 'Account'}</th>
            <th>{transfers ? 'To Account' : 'Category'}</th>
            <th>Date</th>
            <th>Amount</th>
            <th aria-label="Actions" />
          </tr>
        </thead>
        <tbody>
          {rows.map((transaction) => (
            <tr key={transaction.id}>
              <td>
                <div className="transaction-name">
                  <span className={`transaction-icon ${transaction.kind}`}>
                    {transaction.kind === 'expense' ? (
                      <ArrowUpRight size={15} />
                    ) : transaction.kind === 'income' ? (
                      <ArrowDownLeft size={15} />
                    ) : (
                      <ArrowLeftRight size={15} />
                    )}
                  </span>
                  <div>
                    <strong>{transaction.description}</strong>
                  </div>
                </div>
              </td>
              <td>
                <span>
                  {transaction.account_name}
                  {!transfers && transaction.destination_name && ` → ${transaction.destination_name}`}
                </span>
              </td>
              <td>{transfers ? <span>{transaction.destination_name ?? '—'}</span> : <span className="tag">{transaction.category}</span>}</td>
              <td>
                <span className="muted nowrap">{new Date(transaction.date + 'T00:00:00').toLocaleDateString(language, { day: 'numeric', month: 'short' })}</span>
              </td>
              <td>
                <span className={`amount ${transaction.kind === 'income' ? 'positive' : ''}`}>
                  {transaction.kind === 'expense' ? '−' : transaction.kind === 'income' ? '+' : ''}
                  {money(transaction.amount)}
                </span>
              </td>
              <td>
                <div className="row-actions">
                  {transaction.receipt_id && (
                    <ReceiptLink id={transaction.receipt_id}>
                      <Paperclip size={14} />
                    </ReceiptLink>
                  )}
                  <button type="button" className="icon-button" aria-label={`Edit ${transaction.description}`} onClick={() => onEdit(transaction)}>
                    <Pencil size={14} />
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && (
        <div className="empty small">
          <Cat size={26} strokeWidth={1.5} aria-hidden="true" />
          <p>All quiet here. No transactions for this selection.</p>
        </div>
      )}
    </div>
  );
}
