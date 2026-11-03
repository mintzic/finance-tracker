import { useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import { ImagePlus, Move, Trash2, X } from 'lucide-react';
import type { action } from '@/routes/home';

export function WorkspaceCover({ cover }: { cover: { version: string; position: number } | null }) {
  const fetcher = useFetcher<typeof action>();
  const [uploading, setUploading] = useState(false);
  const [repositioning, setRepositioning] = useState(false);
  const [position, setPosition] = useState(cover?.position ?? 50);
  const drag = useRef<{ y: number; position: number } | null>(null);
  const busy = fetcher.state !== 'idle';

  useEffect(() => {
    setPosition(cover?.position ?? 50);
    setRepositioning(false);
  }, [cover?.version, cover?.position]);
  useEffect(() => {
    if (fetcher.state === 'idle' && fetcher.data?.message) {
      setUploading(false);
      setRepositioning(false);
    }
  }, [fetcher.state, fetcher.data]);

  return (
    <section
      className={`workspace-cover ${cover ? 'has-cover' : ''} ${uploading || repositioning || busy ? 'cover-editing' : ''}`}
      aria-label="Workspace cover">
      {cover && (
        <img
          src={`/cover?v=${cover.version}`}
          alt="Custom workspace cover"
          draggable={false}
          className={repositioning ? 'cover-repositioning' : ''}
          style={{ objectPosition: `center ${position}%` }}
          onPointerDown={(e) => {
            if (!repositioning || busy) {
              return;
            }

            drag.current = { y: e.clientY, position };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) {
              return;
            }

            const el = e.currentTarget;
            const overflow = el.naturalHeight * Math.max(el.clientWidth / el.naturalWidth, el.clientHeight / el.naturalHeight) - el.clientHeight;

            if (overflow > 0) {
              setPosition(Math.max(0, Math.min(100, drag.current.position - ((e.clientY - drag.current.y) / overflow) * 100)));
            }
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onPointerCancel={() => {
            drag.current = null;
          }}
        />
      )}
      <div className="cover-controls">
        {!repositioning && (
          <>
            <button className="cover-button" onClick={() => setUploading(!uploading)} disabled={busy}>
              <ImagePlus size={14} />
              {cover ? 'Change cover' : 'Add cover'}
            </button>
            {cover && (
              <>
                <button
                  className="cover-button"
                  onClick={() => {
                    setUploading(false);
                    setRepositioning(true);
                  }}
                  disabled={busy}>
                  <Move size={14} />
                  Reposition
                </button>
                <fetcher.Form method="post">
                  <input type="hidden" name="intent" value="remove_cover" />
                  <button className="cover-button" disabled={busy}>
                    <Trash2 size={14} />
                    Remove
                  </button>
                </fetcher.Form>
              </>
            )}
          </>
        )}
        {repositioning && cover && (
          <fetcher.Form method="post" className="cover-position-form">
            <input type="hidden" name="intent" value="position_cover" />
            <input type="hidden" name="version" value={cover.version} />
            <label>
              Drag image or adjust position
              <input
                aria-label="Cover vertical position"
                type="range"
                name="position"
                min="0"
                max="100"
                step="0.1"
                value={position}
                disabled={busy}
                onChange={(e) => setPosition(Number(e.target.value))}
              />
            </label>
            <button className="cover-button" disabled={busy}>
              {busy ? 'Saving…' : 'Save position'}
            </button>
            <button
              type="button"
              className="cover-button"
              disabled={busy}
              onClick={() => {
                setPosition(cover.position);
                setRepositioning(false);
              }}>
              Cancel
            </button>
          </fetcher.Form>
        )}
      </div>
      {uploading && (
        <fetcher.Form method="post" encType="multipart/form-data" className="cover-upload">
          <input type="hidden" name="intent" value="upload_cover" />
          <div className="cover-upload-heading">
            <strong>Upload a cover</strong>
            <button type="button" className="icon-button" aria-label="Close upload" disabled={busy} onClick={() => setUploading(false)}>
              <X size={16} />
            </button>
          </div>
          <label>
            Choose image
            <input type="file" name="cover" accept="image/png,image/jpeg,image/webp" required disabled={busy} />
          </label>
          <p>PNG, JPEG or WebP · Up to 5 MB</p>
          <button className="primary" disabled={busy}>
            {busy ? 'Uploading…' : 'Upload image'}
          </button>
        </fetcher.Form>
      )}
      {fetcher.data?.error && (
        <p className="cover-error error" role="alert">
          {fetcher.data.error}
        </p>
      )}
    </section>
  );
}
