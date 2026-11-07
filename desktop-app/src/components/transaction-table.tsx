import { useContext } from 'react';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Paperclip, Pencil, Cat } from 'lucide-react';
import { Preferences, useMoney } from '@/lib/preferences';
import type { Transaction } from '@/lib/types';
import { ReceiptLink } from './native-assets';

import { AppearanceToolbar, Choice, Toggle, tableDefaults, useComponentAppearance } from './component-appearance';

// Filtering, sorting, and pagination are handled by the dashboard loader.
export function TransactionTable({
  rows,
  onEdit,
  transfers = false,
  appearanceKey,
}: {
  rows: Transaction[];
  onEdit: (transaction: Transaction) => void;
  transfers?: boolean;
  appearanceKey?: string;
}) {
  const scope = appearanceKey ?? (transfers ? 'Transfers table' : 'Transactions table');
  const { settings, update, status } = useComponentAppearance(scope, tableDefaults);
  const money = useMoney();
  const { language } = useContext(Preferences);
  return (
    <div className="component-appearance transaction-appearance">
      <AppearanceToolbar title={scope} scope={scope} status={status} onReset={() => update(tableDefaults)}>
        <Choice
          label="Density"
          value={settings.density}
          options={[
            ['comfortable', 'Comfortable'],
            ['compact', 'Compact'],
          ]}
          onChange={(density) => update({ ...settings, density })}
        />
        <Choice
          label="Font size"
          value={settings.fontSize}
          options={[
            ['10', 'Small (10px)'],
            ['12', 'Medium (12px)'],
            ['14', 'Large (14px)'],
          ]}
          onChange={(fontSize) => update({ ...settings, fontSize })}
        />
        {(['striped', 'dividers', 'icons', 'account', 'category', 'date'] as const).map((key) => (
          <Toggle
            key={key}
            label={
              {
                striped: 'Striped rows',
                dividers: 'Row dividers',
                icons: 'Transaction icons',
                account: transfers ? 'From account column' : 'Account column',
                category: transfers ? 'To account column' : 'Category column',
                date: 'Date column',
              }[key]
            }
            checked={settings[key]}
            onChange={(value) => update({ ...settings, [key]: value })}
          />
        ))}
      </AppearanceToolbar>
      <div
        className={`table-scroll appearance-table ${settings.density} ${settings.striped ? 'striped' : ''} ${settings.dividers ? '' : 'no-dividers'}`}
        style={{ '--table-font-size': `${settings.fontSize}px` } as import('react').CSSProperties}>
        <table>
          <thead>
            <tr>
              <th>Transaction</th>
              {settings.account && <th>{transfers ? 'From Account' : 'Account'}</th>}
              {settings.category && <th>{transfers ? 'To Account' : 'Category'}</th>}
              {settings.date && <th>Date</th>}
              <th>Amount</th>
              <th aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((transaction) => (
              <tr key={transaction.id}>
                <td>
                  <div className="transaction-name">
                    {settings.icons && (
                      <span className={`transaction-icon ${transaction.kind}`}>
                        {transaction.kind === 'expense' ? (
                          <ArrowUpRight size={15} />
                        ) : transaction.kind === 'income' ? (
                          <ArrowDownLeft size={15} />
                        ) : (
                          <ArrowLeftRight size={15} />
                        )}
                      </span>
                    )}
                    <div>
                      <strong>{transaction.description}</strong>
                    </div>
                  </div>
                </td>
                {settings.account && (
                  <td>
                    <span>
                      {transaction.account_name}
                      {!transfers && transaction.destination_name && ` → ${transaction.destination_name}`}
                    </span>
                  </td>
                )}
                {settings.category && (
                  <td>{transfers ? <span>{transaction.destination_name ?? '—'}</span> : <span className="tag">{transaction.category}</span>}</td>
                )}
                {settings.date && (
                  <td>
                    <span className="muted nowrap">
                      {new Date(transaction.date + 'T00:00:00').toLocaleDateString(language, { day: 'numeric', month: 'short' })}
                    </span>
                  </td>
                )}
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
            {!rows.length && (
              <tr>
                <td colSpan={3 + Number(settings.account) + Number(settings.category) + Number(settings.date)}>
                  <div className="empty small">
                    <Cat size={26} strokeWidth={1.5} aria-hidden="true" />
                    <p>All quiet here. No transactions for this selection.</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
