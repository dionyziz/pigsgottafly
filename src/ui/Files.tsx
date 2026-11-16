// Choosing a file (a button over a hidden file input), and a full-screen PDF viewer (the browser's
// own PDF rendering) for a Blob or a URL.
import { type ReactNode, useEffect, useRef, useState } from 'react';

export function FilePicker({
  accept,
  onPick,
  children,
  disabled,
  className = 'sm',
  testId,
  inputTestId,
}: {
  /** e.g. 'application/pdf' or a list joined by commas. */
  accept?: string;
  onPick: (file: File) => void;
  /** The button's content. */
  children: ReactNode;
  disabled?: boolean;
  /** Classes of the button (default 'sm'). */
  className?: string;
  testId?: string;
  /** data-testid of the hidden <input type=file>. */
  inputTestId?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => input.current?.click()}
        disabled={disabled}
        data-testid={testId}
      >
        {children}
      </button>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        data-testid={inputTestId}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = ''; // the same file can be picked again
          if (f) onPick(f);
        }}
      />
    </>
  );
}

/** Object URL of a Blob while mounted (a string passes through). */
export function useObjectUrl(src: Blob | string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(typeof src === 'string' ? src : null);
  useEffect(() => {
    if (!src) {
      setUrl(null);
      return;
    }
    if (typeof src === 'string') {
      setUrl(src);
      return;
    }
    const u = URL.createObjectURL(src);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [src]);
  return url;
}

export function PdfViewer({
  src,
  title,
  detail,
  onClose,
  onDownload,
  progress,
  error,
  testId = 'pdf-viewer',
}: {
  /** The PDF: a Blob, a URL, or null while it loads. */
  src: Blob | string | null;
  title: string;
  /** Next to the title (size, date). */
  detail?: ReactNode;
  onClose: () => void;
  onDownload?: () => void;
  /** Loading progress 0–1, while src is null. */
  progress?: number;
  error?: string | null;
  testId?: string;
}) {
  const url = useObjectUrl(src);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="pdf-viewer" role="dialog" aria-modal="true" aria-label={title} data-testid={testId}>
      <div className="pdf-bar">
        <b className="ellipsis">{title}</b>
        {detail && <span className="muted">{detail}</span>}
        <span className="spacer" />
        {onDownload && (
          <button type="button" className="ghost sm" disabled={!url} onClick={onDownload}>
            Download
          </button>
        )}
        <button type="button" className="sm" onClick={onClose} autoFocus>
          Close
        </button>
      </div>
      <div className="pdf-body">
        {url ? (
          <iframe src={url} title={title} data-testid="pdf-frame" />
        ) : error ? (
          <p className="issue error">{error}</p>
        ) : (
          <div className="pdf-loading">
            <span className="muted">Loading{progress != null ? ` ${Math.round(progress * 100)}%` : '…'}</span>
            {progress != null && (
              <div className="file-progress">
                <div style={{ width: `${progress * 100}%` }} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
