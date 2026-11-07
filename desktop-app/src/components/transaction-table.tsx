import { useContext } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Paperclip, Pencil, Cat } from 'lucide-react';
import { Preferences, useMoney } from '@/lib/preferences';
import type { Entry } from '@/lib/types';
import { ReceiptLink } from './native-assets';

// Filtering, sorting, and pagination are handled by the dashboard loader.
export function TransactionTable({ rows, onEdit, transfers = false }: { rows: Entry[]; onEdit: (entry: Entry) => void; transfers?: boolean }) {
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
          {rows.map((entry) => (
            <tr key={entry.id}>
              <td>
                <div className="transaction-name">
                  <span className={`transaction-icon ${entry.kind}`}>
                    {entry.kind === 'expense' ? (
                      <ArrowUpRight size={15} />
                    ) : entry.kind === 'income' ? (
                      <ArrowDownLeft size={15} />
                    ) : (
                      <ArrowLeftRight size={15} />
                    )}
                  </span>
                  <div>
                    <strong>{entry.description}</strong>
                  </div>
                </div>
              </td>
              <td>
                <span>
                  {entry.account_name}
                  {!transfers && entry.destination_name && ` → ${entry.destination_name}`}
                </span>
              </td>
              <td>{transfers ? <span>{entry.destination_name ?? '—'}</span> : <span className="tag">{entry.category}</span>}</td>
              <td>
                <span className="muted nowrap">{new Date(entry.date + 'T00:00:00').toLocaleDateString(language, { day: 'numeric', month: 'short' })}</span>
              </td>
              <td>
                <span className={`amount ${entry.kind === 'income' ? 'positive' : ''}`}>
                  {entry.kind === 'expense' ? '−' : entry.kind === 'income' ? '+' : ''}
                  {money(entry.amount)}
                </span>
              </td>
              <td>
                <div className="row-actions">
                  {entry.receipt_id && (
                    <ReceiptLink id={entry.receipt_id}>
                      <Paperclip size={14} />
                    </ReceiptLink>
                  )}
                  <button type="button" className="icon-button" aria-label={`Edit ${entry.description}`} onClick={() => onEdit(entry)}>
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
