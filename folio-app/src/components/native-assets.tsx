import { useEffect, useRef, useState, type AnchorHTMLAttributes } from 'react';
import { bridge, errorMessage } from '@/lib/bridge';

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.replace(/[\\/\u0000-\u001f]/g, '_');
  document.body.append(link);
  link.click();
  link.remove();
  // Keep the URL alive until the webview has consumed the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function useCoverUrl(version: string | undefined, ledgerId: string) {
  const [asset, setAsset] = useState<{ key: string; url: string }>();
  const [error, setError] = useState('');
  const key = `${ledgerId}:${version}`;
  useEffect(() => {
    let active = true;
    let url: string | undefined;
    setError('');

    if (version) {
      bridge
        .asset('cover', version)
        .then((asset) => {
          if (!active) {
            return;
          }

          url = URL.createObjectURL(new Blob([new Uint8Array(asset.bytes)], { type: asset.mime }));
          setAsset({ key, url });
        })
        .catch((reason) => {
          if (active) {
            setError(errorMessage(reason));
          }
        });
    }

    return () => {
      active = false;

      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [version, ledgerId, key]);
  return { url: asset?.key === key ? asset.url : undefined, error };
}

function ReceiptPreview({ id, close }: { id: string; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<{ url: string; pdf: boolean }>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    let url: string | undefined;
    bridge
      .receiptPreview(id)
      .then((bytes) => {
        if (!active) {
          return;
        }

        const pdf = new TextDecoder().decode(new Uint8Array(bytes).subarray(0, 5)) === '%PDF-';
        const png = new Uint8Array(bytes)[0] === 137;
        url = URL.createObjectURL(new Blob([bytes], { type: pdf ? 'application/pdf' : png ? 'image/png' : 'image/jpeg' }));
        setPreview({ url, pdf });
      })
      .catch((reason) => {
        if (active) {
          setError(errorMessage(reason));
        }
      });
    return () => {
      active = false;

      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [id]);
  return (
    <dialog
      ref={dialog}
      className="receipt-preview"
      aria-label="Receipt preview"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) {
          close();
        }
      }}>
      <header className="receipt-preview-toolbar">
        <h2>Receipt preview</h2>
        <button type="button" className="icon-button" aria-label="Close receipt preview" onClick={close}>
          ✕
        </button>
      </header>
      <div className="receipt-preview-stage">
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!preview && !error && <p role="status">Loading receipt…</p>}
        {preview &&
          (preview.pdf ? (
            <object className="receipt-preview-document" data={preview.url} type="application/pdf" aria-label="Receipt PDF">
              <p>PDF preview is unavailable in this viewer. Use Download original to view the receipt.</p>
            </object>
          ) : (
            <img className="receipt-preview-image" src={preview.url} alt="Receipt" />
          ))}
      </div>
      <footer className="receipt-preview-toolbar receipt-preview-footer">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const asset = await bridge.asset('receipt', id);
              download(new Blob([new Uint8Array(asset.bytes)], { type: asset.mime }), asset.filename);
            } catch (reason) {
              setError(errorMessage(reason));
            } finally {
              setBusy(false);
            }
          }}>
          {busy ? 'Downloading…' : 'Download original'}
        </button>
      </footer>
    </dialog>
  );
}

export function ReceiptLink({ id, children }: { id: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="icon-button" aria-label="Preview receipt" onClick={() => setOpen(true)}>
        {children}
      </button>
      {open && <ReceiptPreview key={id} id={id} close={() => setOpen(false)} />}
    </>
  );
}

export function ExportLink({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <a
        {...props}
        href="#export"
        aria-disabled={busy}
        onClick={async (event) => {
          event.preventDefault();

          if (busy) {
            return;
          }

          setBusy(true);
          setError('');
          try {
            download(new Blob([await bridge.exportCsv()], { type: 'text/csv;charset=utf-8' }), 'folio-transactions.csv');
          } catch (reason) {
            setError(errorMessage(reason));
          } finally {
            setBusy(false);
          }
        }}>
        {children}
      </a>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </>
  );
}
