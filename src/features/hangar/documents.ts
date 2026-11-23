// The documents section's rules apart from React (an aircraft's or an operator's PDFs): what may be
// uploaded, the title a new one gets, how a row reads. The iPhone app's core wraps these
// (src/native/core/operators.ts documents), so both accept and show the same.
import { isoDay as fmtDate } from '../../shared/date';
import { fmtSize } from '../../shared/format';
import { AIRCRAFT_FILE_CHUNK_BYTES, type AircraftFile, DOCUMENT_MAX_BYTES } from '../../shared/types';

/** Why a picked file cannot be uploaded as a document (null: it can). */
export function documentPickError(file: { type: string; size: number }): string | null {
  if (file.type !== 'application/pdf') return 'Choose a PDF file.';
  if (file.size > DOCUMENT_MAX_BYTES)
    return `The file is ${fmtSize(file.size)}; the limit is ${fmtSize(DOCUMENT_MAX_BYTES)}.`;
  return null;
}

/** A new document's title: the one typed, else the file's name without .pdf. */
export function documentTitle(typed: string, fileName: string): string {
  return typed.trim() || fileName.replace(/\.pdf$/i, '');
}

/** The new title to save after an edit, or null when there is nothing to save. */
export function documentRename(f: Pick<AircraftFile, 'title'>, typed: string): string | null {
  const v = typed.trim();
  return !v || v === f.title ? null : v;
}

/** "POH.pdf · 12.3 MB · 2026-11-15" under a document's title. */
export function documentDetail(f: Pick<AircraftFile, 'name' | 'size' | 'uploaded'>): string {
  return `${f.name} · ${fmtSize(f.size)} · ${fmtDate(f.uploaded)}`;
}

/** "Up to 80.0 MB" beside Add PDF. */
export const DOCUMENT_LIMIT_HINT = `Up to ${fmtSize(DOCUMENT_MAX_BYTES)}`;

export { AIRCRAFT_FILE_CHUNK_BYTES, DOCUMENT_MAX_BYTES };
