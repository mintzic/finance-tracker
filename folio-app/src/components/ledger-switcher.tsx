import { useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { BookOpen, Check, ChevronDown, Settings2, Plus, Pencil, Trash2, X } from 'lucide-react';
import type { ActionResult, Ledger } from '@/lib/types';
import { currencyOptions } from '@/lib/currency';

export function LedgerSwitcher({ ledger, ledgers, manage }: { ledger: Ledger; ledgers: Ledger[]; manage: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const fetcher = useFetcher<ActionResult>();
  useEffect(() => {
    if (!open) {
      return;
    }

    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open]);
  return (
    <div
      className="ledger-switcher"
      ref={root}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          setOpen(false);
          trigger.current?.focus();
        }
      }}>
      <button
        ref={trigger}
        type="button"
        className="ledger-switcher-trigger"
        aria-expanded={open}
        aria-controls="ledger-options"
        onClick={() => setOpen(!open)}>
        <BookOpen size={16} />
        <span>
          {ledger.name} <span className="muted">· {ledger.currency}</span>
        </span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div id="ledger-options" className="ledger-dropdown">
          <p className="eyebrow">YOUR LEDGERS</p>
          <div className="ledger-options">
            {ledgers.map((item) => (
              <button
                type="button"
                key={item.id}
                disabled={fetcher.state !== 'idle'}
                className={item.id === ledger.id ? 'selected' : ''}
                onClick={() => {
                  if (item.id !== ledger.id) {
                    fetcher.submit({ intent: 'switch_ledger', id: item.id }, { method: 'post', action: '/settings' });
                  }

                  setOpen(false);
                }}>
                <BookOpen size={16} />
                <span>
                  {item.name}
                  <small>{item.currency}</small>
                </span>
                {item.id === ledger.id && <Check size={16} />}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="ledger-manage-link"
            onClick={() => {
              setOpen(false);
              manage();
            }}>
            <Settings2 size={16} />
            Manage ledgers
          </button>
        </div>
      )}
      {fetcher.data?.error && (
        <span className="error" role="alert">
          {fetcher.data.error}
        </span>
      )}
    </div>
  );
}

export function LedgerManager({ ledger, ledgers }: { ledger: Ledger; ledgers: Ledger[] }) {
  const [editor, setEditor] = useState<{ mode: 'create' | 'edit' | 'delete'; ledger?: Ledger } | null>(null);
  const fetcher = useFetcher<ActionResult>();
  const dialog = useRef<HTMLDialogElement>(null);
  const pending = fetcher.state !== 'idle';
  useEffect(() => {
    if (editor) {
      dialog.current?.showModal();
    }
  }, [editor]);
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.message && !fetcher.data.error) {
      setEditor(null);
    }
  }, [fetcher.state, fetcher.data]);
  return (
    <>
      <div className="section-heading">
        <h2>
          Your ledgers <span className="count">{ledgers.length}</span>
        </h2>
        <button
          className="primary"
          onClick={() => {
            fetcher.reset();
            setEditor({ mode: 'create' });
          }}>
          <Plus size={16} />
          Add ledger
        </button>
      </div>
      <p className="muted">Separate spaces for your finances. Each ledger has its own accounts, records, and currency.</p>
      {fetcher.data?.message && (
        <p role="status" className="notice">
          {fetcher.data.message}
        </p>
      )}
      {fetcher.data?.warning && <p role="alert">{fetcher.data.warning}</p>}
      {!editor && fetcher.data?.error && (
        <p className="error" role="alert">
          {fetcher.data.error}
        </p>
      )}
      <div className="account-grid standalone ledger-grid">
        {ledgers.map((item) => (
          <section className={`account-card ledger-card ${item.id === ledger.id ? 'ledger-active' : ''}`} key={item.id}>
            <div className="card-label">
              <BookOpen size={19} />
              <span>{item.id === ledger.id ? 'Current ledger' : 'Ledger'}</span>
              {item.id === ledger.id && <Check size={16} />}
            </div>
            <h2>{item.name}</h2>
            <p className="muted">{item.currency}</p>
            <div className="ledger-card-actions">
              <button
                className="text-button"
                onClick={() => {
                  fetcher.reset();
                  setEditor({ mode: 'edit', ledger: item });
                }}>
                <Pencil size={14} />
                Edit
              </button>
              <button
                className="text-button negative"
                disabled={ledgers.length === 1}
                title={ledgers.length === 1 ? 'You must keep at least one ledger.' : undefined}
                onClick={() => {
                  fetcher.reset();
                  setEditor({ mode: 'delete', ledger: item });
                }}>
                <Trash2 size={14} />
                Delete
              </button>
            </div>
          </section>
        ))}
      </div>
      {editor && (
        <dialog
          ref={dialog}
          className="editor ledger-editor"
          aria-labelledby="ledger-editor-title"
          onCancel={(event) => {
            event.preventDefault();

            if (!pending) {
              setEditor(null);
            }
          }}>
          <div className="editor-inner">
            <div className="panel-heading">
              <h2 id="ledger-editor-title">{editor.mode === 'create' ? 'Add ledger' : editor.mode === 'edit' ? 'Edit ledger' : 'Delete ledger'}</h2>
              <button className="icon-button" aria-label="Close ledger editor" disabled={pending} onClick={() => setEditor(null)}>
                <X size={20} />
              </button>
            </div>
            <fetcher.Form method="post" action="/settings" className="form-stack">
              <input
                type="hidden"
                name="intent"
                value={editor.mode === 'create' ? 'create_ledger' : editor.mode === 'edit' ? 'update_ledger' : 'delete_ledger'}
              />
              {editor.ledger && <input type="hidden" name="id" value={editor.ledger.id} />}
              {editor.mode === 'delete' ? (
                <>
                  <p>
                    Deleting <strong>{editor.ledger?.name}</strong> permanently removes its financial records. Other ledgers are unaffected. Back up your
                    records first.
                  </p>
                  <label>
                    Type DELETE to confirm
                    <input name="confirmation" required pattern="DELETE" autoComplete="off" />
                  </label>
                </>
              ) : (
                <>
                  <label>
                    Ledger name
                    <input name="name" defaultValue={editor.ledger?.name} required maxLength={80} autoFocus />
                  </label>
                  {editor.mode === 'create' ? (
                    <label>
                      Currency
                      <select name="currency" defaultValue={ledger.currency}>
                        {currencyOptions(ledger.currency).map((currency) => (
                          <option key={currency}>{currency}</option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <p className="muted small">Currency: {editor.ledger?.currency}. Currency cannot be changed.</p>
                  )}
                  <p className="muted small">Amounts are not converted between ledgers.</p>
                </>
              )}
              {fetcher.data?.error && (
                <p className="error" role="alert">
                  {fetcher.data.error}
                </p>
              )}
              <div className="ledger-card-actions">
                <button type="button" className="secondary" disabled={pending} onClick={() => setEditor(null)}>
                  Cancel
                </button>
                <button className={editor.mode === 'delete' ? 'secondary negative' : 'primary'} disabled={pending}>
                  {pending ? 'Saving…' : editor.mode === 'create' ? 'Create ledger' : editor.mode === 'edit' ? 'Save changes' : 'Delete ledger'}
                </button>
              </div>
            </fetcher.Form>
          </div>
        </dialog>
      )}
    </>
  );
}
