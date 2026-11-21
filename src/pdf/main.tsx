// The W&B and performance sheets as e-mailed to the aircraft's operator (pdf.html, a second entry of
// the Vite build): the export page's own sheets (../features/exports/wb/WbExport.tsx,
// performance/PerformanceExport.tsx) with the app's CSS, drawn from the WbPerfContent the pilot
// sent. Opened only by the server's headless Chromium (api/_lib/sheetPdf.ts), which puts
// { content, signature } in window.__PGF_SHEETS__ before the page loads, serves this build from
// disk (no network) and prints the page to PDF with the print CSS (A4, the sheets' @page) once the
// html element says data-pdf-ready="true" (fonts and images loaded).
import '../app/styles.css';
import '../ui/ui.css';
import '../features/exports/export.css';
import '../features/exports/form731/forms.css';
import './pdf.css';

import { createRoot } from 'react-dom/client';

import type { ShownSignature } from '../features/exports/form731/Form731';
import { PerfSheet } from '../features/exports/performance/PerformanceExport';
import { WbSheet } from '../features/exports/wb/WbExport';
import { type WbPerfContent, wbPerfContentOf } from '../shared/declarations';

/** What the server hands the page. */
interface SheetsSnapshot {
  content: WbPerfContent;
  signature: ShownSignature | null;
}

declare global {
  interface Window {
    __PGF_SHEETS__?: SheetsSnapshot;
  }
}

function Sheets({ content: c, signature }: SheetsSnapshot) {
  return (
    <div className="page export-page">
      <div className="xp-doc print-sheet-page" data-testid="wbperf-export">
        <div className="xp-stage">
          <WbSheet c={c} signature={signature} />
          {c.perf.pages.map((_, i) => (
            <PerfSheet key={i} c={c} pageNo={i + 1} signature={signature} />
          ))}
        </div>
      </div>
    </div>
  );
}

const snap = window.__PGF_SHEETS__;
const root = document.documentElement;
if (!snap) root.dataset.pdfReady = 'empty';
else {
  const content = wbPerfContentOf(snap.content);
  const s = snap.signature;
  const signature =
    s && typeof s.name === 'string' && Number.isFinite(s.signedAt) ? { name: s.name, signedAt: s.signedAt } : null;
  document.title = ['W&B and performance', content.registration, content.date].filter(Boolean).join(' ');
  createRoot(document.getElementById('root')!).render(<Sheets content={content} signature={signature} />);
  // rendered, then every font and image loaded: ready to print
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  void frame()
    .then(frame)
    .then(() => document.fonts.ready)
    .then(() => Promise.all([...document.images].map((img) => img.decode().catch(() => {}))))
    .then(() => {
      root.dataset.pdfReady = 'true';
    });
}
