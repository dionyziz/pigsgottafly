// The aircraft's photo or its placeholder picture (hangar cards, aircraft page header) and documents (POH/AFM and other PDFs,
// read in an in-app viewer). Content comes and goes in chunks (src/data/aircraftFiles.ts). Anyone
// with access sees them; owners and editors add, replace, rename and remove. The documents section
// and the PDF viewer also serve an operator's documents (operations manual): they take a FileScope.
import { useEffect, useState } from 'react';

import { aircraftScope, fileBlob, type FileScope, resizePhoto, saveBlob, uploadFile } from '../../data/aircraftFiles';
import { isoDay as fmtDate } from '../../shared/date';
import { errorMessage, fmtSize } from '../../shared/format';
import { type AircraftFile, DOCUMENT_MAX_BYTES, PHOTO_TYPES } from '../../shared/types';
import { FilePicker, Icon, Loading, PdfViewer, RowRemove } from '../../ui';
import { Section } from './fields';

/** A file's content while mounted (null while loading or on error). */
function useFileBlob(
  scope: FileScope,
  f: AircraftFile | null | undefined,
  onProgress?: (x: number) => void,
): { blob: Blob | null; error: string | null } {
  const [state, setState] = useState<{ blob: Blob | null; error: string | null }>({ blob: null, error: null });
  useEffect(() => {
    if (!f) {
      setState({ blob: null, error: null });
      return;
    }
    let live = true;
    setState({ blob: null, error: null });
    fileBlob(scope, f, onProgress).then(
      (blob) => {
        if (live) setState({ blob, error: null });
      },
      (e) => {
        if (live) setState({ blob: null, error: errorMessage(e) });
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.files, scope.id, f?.id]);
  return state;
}

/** Object URL of a file's content while mounted (null while loading or on error). */
function useFileUrl(scope: FileScope, f: AircraftFile | null | undefined): string | null {
  const { blob } = useFileBlob(scope, f);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

/** The picture shown without a photo: public/aircraft/placeholder-N.webp (N stored with the aircraft, 1–3). */
export const placeholderUrl = (n: number | undefined) =>
  `/aircraft/placeholder-${n && n >= 1 && n <= 3 ? Math.round(n) : 1}.webp`;

/** The aircraft's photo (or its placeholder picture), cover-cropped in its box: className 'card-top' (hangar card) or 'head'. */
export function AircraftPhoto({
  aircraftId,
  photo,
  placeholder,
  className = '',
  alt,
}: {
  aircraftId: string;
  photo: AircraftFile | null | undefined;
  placeholder?: number;
  className?: string;
  alt: string;
}) {
  const url = useFileUrl(aircraftScope(aircraftId), photo);
  return (
    <div className={'ac-photo ' + className} data-testid="aircraft-photo">
      {photo && url ? (
        <img src={url} alt={alt} />
      ) : photo ? null : (
        <img src={placeholderUrl(placeholder)} alt="" className="ph" data-testid="aircraft-placeholder" />
      )}
    </div>
  );
}

/** Header photo; owners and editors add or change it from an overlay on hover, and remove it. */
export function PhotoControl({
  aircraftId,
  registration,
  photo,
  placeholder,
  canEdit,
  onChange,
}: {
  aircraftId: string;
  registration: string;
  photo: AircraftFile | null | undefined;
  placeholder?: number;
  canEdit: boolean;
  onChange: (p: AircraftFile | null) => void;
}) {
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (file: File) => {
    setErr(null);
    if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) {
      setErr('Choose a JPEG, PNG or WebP picture.');
      return;
    }
    setBusy(0);
    try {
      const small = await resizePhoto(file);
      onChange(
        await uploadFile(
          aircraftScope(aircraftId),
          small,
          { kind: 'photo', name: file.name.replace(/\.\w+$/, '') + '.jpg' },
          setBusy,
        ),
      );
    } catch (e) {
      setErr(`Upload failed: ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!photo) return;
    setErr(null);
    try {
      await aircraftScope(aircraftId).files.remove(aircraftId, photo.id);
      onChange(null);
    } catch (e) {
      setErr(errorMessage(e));
    }
  };
  return (
    <div className={'ac-head-photo' + (canEdit ? ' editable' : '') + (busy !== null ? ' busy' : '')}>
      <AircraftPhoto
        aircraftId={aircraftId}
        photo={photo}
        placeholder={placeholder}
        className="head"
        alt={registration}
      />
      {canEdit && (
        <>
          <FilePicker
            accept={PHOTO_TYPES.join(',')}
            onPick={(f) => void pick(f)}
            disabled={busy !== null}
            className="ac-photo-overlay"
            testId="photo-pick"
            inputTestId="photo-file"
          >
            {busy !== null ? (
              `${Math.round(busy * 100)}%`
            ) : (
              <>
                <Icon name="upload" size={14} />
                {photo ? 'Change photo' : 'Add photo'}
              </>
            )}
          </FilePicker>
          {photo && busy === null && (
            <button
              type="button"
              className="icon ac-photo-remove"
              onClick={() => void remove()}
              aria-label="Remove photo"
              title="Remove photo"
              data-testid="photo-remove"
            >
              <Icon name="trash" size={13} />
            </button>
          )}
        </>
      )}
      {err && (
        <span className="issue error ac-photo-err" role="alert">
          {err}
        </span>
      )}
    </div>
  );
}

/** A document in the full-screen PDF viewer (src/ui PdfViewer), with download. */
function DocumentViewer({ scope, file, onClose }: { scope: FileScope; file: AircraftFile; onClose: () => void }) {
  const [progress, setProgress] = useState(0);
  const { blob, error } = useFileBlob(scope, file, setProgress);
  return (
    <PdfViewer
      src={blob}
      title={file.title || file.name}
      detail={fmtSize(file.size)}
      progress={progress}
      error={error}
      onClose={onClose}
      onDownload={() => {
        if (blob) saveBlob(blob, file.name);
      }}
    />
  );
}

const AIRCRAFT_DOCS = {
  title: 'Documents',
  empty: 'No documents.',
  placeholder: 'Title, e.g. POH',
};

/** Documents section: the PDFs of an aircraft (or, with `text`, of an operator), each with a title; open in the viewer, download. */
export function DocumentsSection({
  scope,
  canEdit,
  text = AIRCRAFT_DOCS,
}: {
  scope: FileScope;
  canEdit: boolean;
  text?: typeof AIRCRAFT_DOCS;
}) {
  const [docs, setDocs] = useState<AircraftFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AircraftFile | null>(null);
  const [title, setTitle] = useState('');
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null);
  useEffect(() => {
    let live = true;
    scope.files.list(scope.id).then(
      (f) => {
        if (live) setDocs((f as { documents: AircraftFile[] }).documents);
      },
      (e) => {
        if (live) setError(errorMessage(e));
      },
    );
    return () => {
      live = false;
    };
  }, [scope.files, scope.id]);

  const pick = async (file: File) => {
    setError(null);
    if (file.type !== 'application/pdf') {
      setError('Choose a PDF file.');
      return;
    }
    if (file.size > DOCUMENT_MAX_BYTES) {
      setError(`The file is ${fmtSize(file.size)}; the limit is ${fmtSize(DOCUMENT_MAX_BYTES)}.`);
      return;
    }
    setUpload({ name: file.name, progress: 0 });
    try {
      const f = await uploadFile(
        scope,
        file,
        { kind: 'document', name: file.name, title: title.trim() || file.name.replace(/\.pdf$/i, '') },
        (p) => setUpload({ name: file.name, progress: p }),
      );
      setDocs((d) => [...(d ?? []), f]);
      setTitle('');
    } catch (e) {
      setError(`Upload failed: ${errorMessage(e)}`);
    } finally {
      setUpload(null);
    }
  };
  const rename = async (f: AircraftFile, t: string) => {
    const v = t.trim();
    if (!v || v === f.title) return;
    try {
      const n = await scope.files.rename(scope.id, f.id, v);
      setDocs((d) => (d ?? []).map((x) => (x.id === n.id ? n : x)));
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const remove = async (f: AircraftFile) => {
    try {
      await scope.files.remove(scope.id, f.id);
      setDocs((d) => (d ?? []).filter((x) => x.id !== f.id));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Section id="documents" title={text.title}>
      {docs === null && !error && <Loading variant="sm" />}
      {docs && docs.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          {text.empty}
        </p>
      )}
      {docs && docs.length > 0 && (
        <ul className="doc-list" data-testid="documents">
          {docs.map((f) => (
            <li key={f.id}>
              <svg viewBox="0 0 20 24" className="doc-ico" aria-hidden="true">
                <path
                  d="M3 1h10l5 5v16a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.4"
                />
                <text x="10" y="18" textAnchor="middle" fontSize="6" fill="currentColor">
                  PDF
                </text>
              </svg>
              <div className="doc-main">
                {canEdit ? (
                  <input
                    className="doc-title"
                    defaultValue={f.title}
                    aria-label="Document title"
                    onBlur={(e) => void rename(f, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  <b className="doc-title">{f.title}</b>
                )}
                <span className="muted">
                  {f.name} · {fmtSize(f.size)} · {fmtDate(f.uploaded)}
                </span>
              </div>
              <button type="button" className="sm" onClick={() => setOpen(f)} data-testid="doc-open">
                Open
              </button>
              <button
                type="button"
                className="ghost sm"
                onClick={() =>
                  void fileBlob(scope, f).then(
                    (b) => saveBlob(b, f.name),
                    (e) => setError(errorMessage(e)),
                  )
                }
              >
                Download
              </button>
              {canEdit && <RowRemove label={`Remove ${f.title}`} onClick={() => void remove(f)} />}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="row wrap doc-add">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={text.placeholder}
            aria-label="New document title"
            maxLength={120}
            disabled={!!upload}
          />
          <FilePicker
            accept="application/pdf"
            onPick={(f) => void pick(f)}
            disabled={!!upload}
            className=""
            testId="doc-pick"
            inputTestId="doc-file"
          >
            Add PDF
          </FilePicker>
          <span className="hint">Up to {fmtSize(DOCUMENT_MAX_BYTES)}</span>
        </div>
      )}
      {upload && (
        <div className="doc-upload">
          <span className="muted">
            Uploading {upload.name}: {Math.round(upload.progress * 100)}%
          </span>
          <div className="file-progress">
            <div style={{ width: `${upload.progress * 100}%` }} />
          </div>
        </div>
      )}
      {error && (
        <span className="issue error" role="alert">
          {error}
        </span>
      )}
      {open && <DocumentViewer scope={scope} file={open} onClose={() => setOpen(null)} />}
    </Section>
  );
}
