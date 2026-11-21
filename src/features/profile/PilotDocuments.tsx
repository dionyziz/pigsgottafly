// Stored as the aircraft documents are (chunked: src/data/aircraftFiles.ts, /api/pilots/:id/files).
import '../hangar/hangar.css';
import './profile.css';

import { useEffect, useState } from 'react';

import { usePilot } from '../../app/session';
import { fileBlob, pilotScope, saveBlob, uploadFile } from '../../data/aircraftFiles';
import { isoDay as fmtDate } from '../../shared/date';
import { errorMessage, fmtSize } from '../../shared/format';
import { type AircraftFile, DOCUMENT_MAX_BYTES, type PilotFileKind, type PilotFiles } from '../../shared/types';
import { CardSection, FilePicker, Loading, RowRemove } from '../../ui';
import { DocumentViewer, PdfIcon } from '../hangar/AircraftFiles';

const KINDS: { kind: PilotFileKind; label: string }[] = [
  { kind: 'licence', label: 'Licence' },
  { kind: 'medical', label: 'Medical certificate' },
];

export function PilotDocuments() {
  const pilot = usePilot();
  const scope = pilotScope(pilot.id);
  const [files, setFiles] = useState<PilotFiles | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<AircraftFile | null>(null);
  const [upload, setUpload] = useState<{ kind: PilotFileKind; progress: number } | null>(null);

  useEffect(() => {
    let live = true;
    pilotScope(pilot.id)
      .files.list(pilot.id)
      .then(
        (f) => {
          if (live) setFiles(f as PilotFiles);
        },
        (e) => {
          if (live) setError(errorMessage(e));
        },
      );
    return () => {
      live = false;
    };
  }, [pilot.id]);

  const pick = async (kind: PilotFileKind, file: File) => {
    setError(null);
    if (file.type !== 'application/pdf') {
      setError('Choose a PDF file.');
      return;
    }
    if (file.size > DOCUMENT_MAX_BYTES) {
      setError(`The file is ${fmtSize(file.size)}; the limit is ${fmtSize(DOCUMENT_MAX_BYTES)}.`);
      return;
    }
    setUpload({ kind, progress: 0 });
    try {
      const f = await uploadFile(scope, file, { kind, name: file.name }, (p) => setUpload({ kind, progress: p }));
      setFiles((x) => ({ licence: null, medical: null, ...x, [kind]: f }));
    } catch (e) {
      setError(`Upload failed: ${errorMessage(e)}`);
    } finally {
      setUpload(null);
    }
  };
  const remove = async (kind: PilotFileKind, f: AircraftFile) => {
    setError(null);
    try {
      await scope.files.remove(scope.id, f.id);
      setFiles((x) => (x ? { ...x, [kind]: null } : x));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="card account-card" data-testid="pilot-documents">
      <CardSection id="licence-medical" title="Licence and medical" plain>
        {files === null && !error && <Loading variant="sm" />}
        {files && (
          <ul className="doc-list">
            {KINDS.map(({ kind, label }) => {
              const f = files[kind];
              const busy = upload?.kind === kind;
              return (
                <li key={kind} data-testid={`pilot-doc-${kind}`}>
                  <PdfIcon />
                  <div className="doc-main">
                    <b>{label}</b>
                    {busy ? (
                      <div className="file-progress">
                        <div style={{ width: `${upload.progress * 100}%` }} />
                      </div>
                    ) : (
                      f && (
                        <span className="muted" data-testid="pilot-doc-name">
                          {f.name} · {fmtSize(f.size)} · {fmtDate(f.uploaded)}
                        </span>
                      )
                    )}
                  </div>
                  {f && (
                    <>
                      <button type="button" className="sm" onClick={() => setOpen(f)} data-testid="pilot-doc-open">
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
                    </>
                  )}
                  <FilePicker
                    accept="application/pdf"
                    onPick={(file) => void pick(kind, file)}
                    disabled={!!upload}
                    className={f ? 'ghost sm' : 'sm'}
                    testId={`${kind}-pick`}
                    inputTestId={`${kind}-file`}
                  >
                    {busy ? `${Math.round(upload.progress * 100)}%` : f ? 'Replace' : 'Add PDF'}
                  </FilePicker>
                  {f && <RowRemove label={`Remove ${label.toLowerCase()}`} onClick={() => void remove(kind, f)} />}
                </li>
              );
            })}
          </ul>
        )}
        {error && (
          <span className="issue error" role="alert">
            {error}
          </span>
        )}
      </CardSection>
      {open && <DocumentViewer scope={scope} file={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
