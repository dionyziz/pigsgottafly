// The aircraft's photo (hangar cards, aircraft page header) and documents (POH/AFM and other PDFs,
// read in an in-app viewer). Content comes and goes in chunks (src/data/aircraftFiles.ts). Anyone
// with access sees them; owners and editors add, replace, rename and remove.
import { useEffect, useRef, useState } from 'react';
import { api } from '../../data/api';
import { aircraftFileBlob, resizePhoto, saveBlob, uploadAircraftFile } from '../../data/aircraftFiles';
import { DOCUMENT_MAX_BYTES, PHOTO_TYPES, type AircraftFile } from '../../shared/types';
import { Section } from './fields';

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Object URL of a file's content while mounted (null while loading or on error). */
function useFileUrl(aircraftId: string, f: AircraftFile | null | undefined, onProgress?: (x: number) => void): { url: string | null; error: string | null } {
  const [state, setState] = useState<{ url: string | null; error: string | null }>({ url: null, error: null });
  useEffect(() => {
    if (!f) { setState({ url: null, error: null }); return; }
    let url: string | null = null;
    let live = true;
    setState({ url: null, error: null });
    aircraftFileBlob(aircraftId, f, onProgress).then((b) => {
      if (!live) return;
      url = URL.createObjectURL(b);
      setState({ url, error: null });
    }, (e) => { if (live) setState({ url: null, error: String((e as Error).message || e) }); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aircraftId, f?.id]);
  return state;
}

/** Neutral placeholder: a light-aircraft outline. */
function PhotoPlaceholder() {
  return (
    <svg viewBox="0 0 64 40" aria-hidden="true" className="ac-photo-ph">
      <path d="M6 22h22l6-12h4l-2 12h14l4-6h3l-1 8 1 8h-3l-4-6H36l2 12h-4l-6-12H6c-2 0-3-1-3-2s1-2 3-2z" fill="currentColor" />
    </svg>
  );
}

/** The aircraft's photo (or the placeholder), filling its box. */
export function AircraftPhoto({ aircraftId, photo, className = '', alt }: { aircraftId: string; photo: AircraftFile | null | undefined; className?: string; alt: string }) {
  const { url } = useFileUrl(aircraftId, photo);
  return (
    <div className={'ac-photo ' + className} data-testid="aircraft-photo">
      {photo && url ? <img src={url} alt={alt} /> : <PhotoPlaceholder />}
    </div>
  );
}

/** Header photo with add / change / remove for owners and editors. */
export function PhotoControl({ aircraftId, registration, photo, canEdit, onChange }: {
  aircraftId: string; registration: string; photo: AircraftFile | null | undefined; canEdit: boolean; onChange: (p: AircraftFile | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setErr(null);
    if (!(PHOTO_TYPES as readonly string[]).includes(file.type)) { setErr('Choose a JPEG, PNG or WebP picture.'); return; }
    setBusy(0);
    try {
      const small = await resizePhoto(file);
      onChange(await uploadAircraftFile(aircraftId, small, { kind: 'photo', name: file.name.replace(/\.\w+$/, '') + '.jpg' }, setBusy));
    } catch (e) {
      setErr(`Upload failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    if (!photo) return;
    setErr(null);
    try { await api.files.remove(aircraftId, photo.id); onChange(null); } catch (e) { setErr(String((e as Error).message || e)); }
  };
  return (
    <div className="ac-head-photo">
      <AircraftPhoto aircraftId={aircraftId} photo={photo} className="head" alt={`${registration}`} />
      {canEdit && (
        <div className="ac-photo-tools">
          <button type="button" className="ghost sm" onClick={() => input.current?.click()} disabled={busy !== null} data-testid="photo-pick">
            {busy !== null ? `Uploading ${Math.round(busy * 100)}%` : photo ? 'Change photo' : 'Add photo'}
          </button>
          {photo && busy === null && <button type="button" className="ghost sm danger" onClick={() => void remove()}>Remove</button>}
          <input ref={input} type="file" hidden accept={PHOTO_TYPES.join(',')} onChange={(e) => void pick(e.target.files?.[0])} data-testid="photo-file" />
        </div>
      )}
      {err && <span className="issue error" role="alert">{err}</span>}
    </div>
  );
}

/** Full-screen PDF viewer (the browser's own PDF rendering of a blob URL), with download. */
export function PdfViewer({ aircraftId, file, onClose }: { aircraftId: string; file: AircraftFile; onClose: () => void }) {
  const [progress, setProgress] = useState(0);
  const { url, error } = useFileUrl(aircraftId, file, setProgress);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="pdf-viewer" role="dialog" aria-modal="true" aria-label={file.title || file.name} data-testid="pdf-viewer">
      <div className="pdf-bar">
        <b>{file.title || file.name}</b>
        <span className="muted">{fmtSize(file.size)}</span>
        <span className="spacer" />
        <button type="button" className="ghost sm" disabled={!url} onClick={() => void aircraftFileBlob(aircraftId, file).then((b) => saveBlob(b, file.name))}>Download</button>
        <button type="button" className="sm" onClick={onClose} autoFocus>Close</button>
      </div>
      <div className="pdf-body">
        {url ? <iframe src={url} title={file.title || file.name} data-testid="pdf-frame" />
          : error ? <p className="issue error">{error}</p>
          : (
            <div className="pdf-loading">
              <span className="muted">Loading {Math.round(progress * 100)}%</span>
              <div className="file-progress"><div style={{ width: `${progress * 100}%` }} /></div>
            </div>
          )}
      </div>
    </div>
  );
}

/** Documents section: the aircraft's PDFs, each with a title; open in the viewer, download. */
export function DocumentsSection({ aircraftId, canEdit }: { aircraftId: string; canEdit: boolean }) {
  const [docs, setDocs] = useState<AircraftFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AircraftFile | null>(null);
  const [title, setTitle] = useState('');
  const [upload, setUpload] = useState<{ name: string; progress: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    api.files.list(aircraftId).then((f) => { if (live) setDocs(f.documents); }, (e) => { if (live) setError(String((e as Error).message || e)); });
    return () => { live = false; };
  }, [aircraftId]);

  const pick = async (file: File | undefined) => {
    if (input.current) input.current.value = '';
    if (!file) return;
    setError(null);
    if (file.type !== 'application/pdf') { setError('Choose a PDF file.'); return; }
    if (file.size > DOCUMENT_MAX_BYTES) { setError(`The file is ${fmtSize(file.size)}; the limit is ${fmtSize(DOCUMENT_MAX_BYTES)}.`); return; }
    setUpload({ name: file.name, progress: 0 });
    try {
      const f = await uploadAircraftFile(aircraftId, file, { kind: 'document', name: file.name, title: title.trim() || file.name.replace(/\.pdf$/i, '') },
        (p) => setUpload({ name: file.name, progress: p }));
      setDocs((d) => [...(d ?? []), f]);
      setTitle('');
    } catch (e) {
      setError(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUpload(null);
    }
  };
  const rename = async (f: AircraftFile, t: string) => {
    const v = t.trim();
    if (!v || v === f.title) return;
    try {
      const n = await api.files.rename(aircraftId, f.id, v);
      setDocs((d) => (d ?? []).map((x) => (x.id === n.id ? n : x)));
    } catch (e) { setError(String((e as Error).message || e)); }
  };
  const remove = async (f: AircraftFile) => {
    try {
      await api.files.remove(aircraftId, f.id);
      setDocs((d) => (d ?? []).filter((x) => x.id !== f.id));
    } catch (e) { setError(String((e as Error).message || e)); }
  };

  return (
    <Section id="documents" title="Documents" intro="The flight manual (POH/AFM), weighing report and other PDFs of this aircraft, to read here. Everyone the aircraft is shared with can read them.">
      {docs === null && !error && <p className="muted" style={{ margin: 0 }}>Loading…</p>}
      {docs && docs.length === 0 && <p className="muted" style={{ margin: 0 }}>No documents{canEdit ? ': add the POH as a PDF below.' : '.'}</p>}
      {docs && docs.length > 0 && (
        <ul className="doc-list" data-testid="documents">
          {docs.map((f) => (
            <li key={f.id}>
              <svg viewBox="0 0 20 24" className="doc-ico" aria-hidden="true"><path d="M3 1h10l5 5v16a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" strokeWidth="1.4" /><text x="10" y="18" textAnchor="middle" fontSize="6" fill="currentColor">PDF</text></svg>
              <div className="doc-main">
                {canEdit
                  ? <input className="doc-title" defaultValue={f.title} aria-label="Document title" onBlur={(e) => void rename(f, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                  : <b className="doc-title">{f.title}</b>}
                <span className="muted">{f.name} · {fmtSize(f.size)} · {fmtDate(f.uploaded)}</span>
              </div>
              <button type="button" className="sm" onClick={() => setOpen(f)} data-testid="doc-open">Open</button>
              <button type="button" className="ghost sm" onClick={() => void aircraftFileBlob(aircraftId, f).then((b) => saveBlob(b, f.name), (e) => setError(String(e.message || e)))}>Download</button>
              {canEdit && <button type="button" className="icon sm danger" aria-label={`Remove ${f.title}`} title="Remove" onClick={() => void remove(f)}>×</button>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="row wrap doc-add">
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title, e.g. POH" aria-label="New document title" maxLength={120} disabled={!!upload} />
          <button type="button" onClick={() => input.current?.click()} disabled={!!upload} data-testid="doc-pick">Add PDF</button>
          <span className="hint">Up to {fmtSize(DOCUMENT_MAX_BYTES)}</span>
          <input ref={input} type="file" hidden accept="application/pdf" onChange={(e) => void pick(e.target.files?.[0])} data-testid="doc-file" />
        </div>
      )}
      {upload && (
        <div className="doc-upload">
          <span className="muted">Uploading {upload.name}: {Math.round(upload.progress * 100)}%</span>
          <div className="file-progress"><div style={{ width: `${upload.progress * 100}%` }} /></div>
        </div>
      )}
      {error && <span className="issue error" role="alert">{error}</span>}
      {open && <PdfViewer aircraftId={aircraftId} file={open} onClose={() => setOpen(null)} />}
    </Section>
  );
}
