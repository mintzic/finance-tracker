import { useEffect, useState, type AnchorHTMLAttributes } from 'react';
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

export function ReceiptLink({ id, children }: { id: string; children: React.ReactNode }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button
        type="button"
        className="icon-button"
        aria-label="Download receipt"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError('');
          try {
            const asset = await bridge.asset('receipt', id);
            download(new Blob([new Uint8Array(asset.bytes)], { type: asset.mime }), asset.filename);
          } catch (reason) {
            setError(errorMessage(reason));
          } finally {
            setBusy(false);
          }
        }}>
        {children}
      </button>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
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
