import { useMemo, useContext } from 'react';
import { useTable, tableFeatures, flexRender, type ColumnDef } from '@tanstack/react-table';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Paperclip, Pencil, Cat } from 'lucide-react';
import { Preferences, useMoney } from '../lib/preferences';
import type { Entry } from '../lib/ledger.server';

// Filtering, sorting, and pagination are handled by the server loader.
const features = tableFeatures({});
type TransactionColumn = ColumnDef<typeof features, Entry>;

export function TransactionTable({ rows, onEdit, compact = false }: { rows: Entry[]; onEdit: (entry: Entry) => void; compact?: boolean }) {
  const money = useMoney();
  const { language } = useContext(Preferences);
  const columns = useMemo<TransactionColumn[]>(
    () => [
      {
        accessorKey: 'description',
        header: 'Transaction',
        cell: ({ row }) => (
          <div className="transaction-name">
            <span className={`transaction-icon ${row.original.kind}`}>
              {row.original.kind === 'expense' ? (
                <ArrowUpRight size={15} />
              ) : row.original.kind === 'income' ? (
                <ArrowDownLeft size={15} />
              ) : (
                <ArrowLeftRight size={15} />
              )}
            </span>
            <div>
              <strong>{row.original.description}</strong>
              {compact && <small>{row.original.account_name}</small>}
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'category',
        header: 'Category',
        cell: ({ getValue }) => <span className="tag">{String(getValue())}</span>,
      },
      ...(!compact
        ? [
            {
              accessorKey: 'account_name',
              header: 'Account',
              cell: ({ row }) => (
                <span>
                  {row.original.account_name}
                  {row.original.destination_name && ` → ${row.original.destination_name}`}
                </span>
              ),
            } satisfies TransactionColumn,
          ]
        : []),
      {
        accessorKey: 'date',
        header: 'Date',
        cell: ({ getValue }) => (
          <span className="muted nowrap">{new Date(String(getValue()) + 'T00:00:00').toLocaleDateString(language, { day: 'numeric', month: 'short' })}</span>
        ),
      },
      {
        accessorKey: 'amount',
        header: 'Amount',
        cell: ({ row }) => (
          <span className={`amount ${row.original.kind === 'income' ? 'positive' : ''}`}>
            {row.original.kind === 'expense' ? '−' : row.original.kind === 'income' ? '+' : ''}
            {money(row.original.amount)}
          </span>
        ),
      },
      {
        id: 'edit',
        header: '',
        cell: ({ row }) => (
          <div className="row-actions">
            {row.original.receipt_id && (
              <a href={`/receipts/${row.original.receipt_id}`} aria-label="Download receipt">
                <Paperclip size={14} />
              </a>
            )}
            <button type="button" className="icon-button" aria-label={`Edit ${row.original.description}`} onClick={() => onEdit(row.original)}>
              <Pencil size={14} />
            </button>
          </div>
        ),
      },
    ],
    [compact, onEdit, language, money]
  );
  const table = useTable({
    features,
    data: rows,
    columns,
    getRowId: (entry) => entry.id,
  });
  return (
    <div className="table-scroll">
      <table>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header) => (
                <th key={header.id}>{header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.original.id}>
              {row.getAllCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
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
