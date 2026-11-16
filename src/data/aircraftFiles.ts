// Aircraft photo and documents, and an operator's documents: chunked upload and download
// (api.files / api.operatorFiles, api/_lib/routes/files.ts),
// the photo's resize in the browser, and a per-session cache of downloaded content (a file id's
// content never changes: a replaced photo or document gets a new id).
import { api, type FilesApi } from './api';
import { AIRCRAFT_FILE_CHUNK_BYTES, PHOTO_MAX_PX, type AircraftFile, type AircraftFileKind } from '../shared/types';

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(data: string): Uint8Array {
  const bin = atob(data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Whose files: the aircraft's (api.files) or an operator's (api.operatorFiles), by id. */
export interface FileScope { files: FilesApi; id: string }
export const aircraftScope = (aircraftId: string): FileScope => ({ files: api.files, id: aircraftId });
export const operatorScope = (operatorId: string): FileScope => ({ files: api.operatorFiles, id: operatorId });

/**
 * Uploads `blob` as the aircraft's photo or a document, chunk by chunk; `onProgress` gets 0…1.
 * Returns the stored file (a new photo replaces the old one when it completes).
 */
export async function uploadFile(scope: FileScope, blob: Blob, meta: { kind: AircraftFileKind; name: string; title?: string },
  onProgress?: (f: number) => void): Promise<AircraftFile> {
  const { files, id } = scope;
  const f = await files.start(id, { kind: meta.kind, name: meta.name, title: meta.title ?? '', mime: blob.type, size: blob.size });
  for (let seq = 0; seq < f.chunks; seq++) {
    const part = new Uint8Array(await blob.slice(seq * AIRCRAFT_FILE_CHUNK_BYTES, (seq + 1) * AIRCRAFT_FILE_CHUNK_BYTES).arrayBuffer());
    await files.putChunk(id, f.id, seq, toBase64(part));
    onProgress?.((seq + 1) / f.chunks);
  }
  const done = await files.complete(id, f.id);
  cache.set(done.id, Promise.resolve(blob.type === done.mime ? blob : new Blob([blob], { type: done.mime })));
  return done;
}

const cache = new Map<string, Promise<Blob>>();

/** The content of a file as a Blob (downloaded chunk by chunk once per session). */
export function fileBlob(scope: FileScope, f: AircraftFile, onProgress?: (x: number) => void): Promise<Blob> {
  const hit = cache.get(f.id);
  if (hit) return hit;
  const p = (async () => {
    const parts: Uint8Array[] = [];
    for (let seq = 0; seq < f.chunks; seq++) {
      parts.push(fromBase64((await scope.files.chunk(scope.id, f.id, seq)).data));
      onProgress?.((seq + 1) / f.chunks);
    }
    return new Blob(parts as BlobPart[], { type: f.mime });
  })();
  cache.set(f.id, p);
  p.catch(() => cache.delete(f.id));
  return p;
}

/** Saves a blob under a file name (download link). */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/**
 * A photo resized so that its longest side is at most PHOTO_MAX_PX, as JPEG (quality 0.85).
 * A smaller JPEG is kept as it is.
 */
export async function resizePhoto(file: Blob, maxPx = PHOTO_MAX_PX): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  try {
    const k = Math.min(1, maxPx / Math.max(bmp.width, bmp.height));
    if (k === 1 && file.type === 'image/jpeg') return file;
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff'; // transparent PNG areas become white, not black
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('could not encode the photo'))), 'image/jpeg', 0.85));
  } finally {
    bmp.close();
  }
}
