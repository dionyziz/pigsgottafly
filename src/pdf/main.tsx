// Sheets as e-mailed (pdf.html, a second entry of the Vite build), drawn by the export pages' own
// components with the app's CSS from the content the pilot sent:
//   kind 'wbperf'  the W&B and performance sheets to the aircraft's operator
//                  (../features/exports/wb/WbExport.tsx, performance/PerformanceExport.tsx)
//   kind 'navlog'  the navigation log to the pilot (../features/exports/navlog/NavlogSheet.tsx)
// Opened only by the server's headless Chromium (api/_lib/sheetPdf.ts), which puts the snapshot in
// window.__PGF_SHEETS__ before the page loads, serves this build from disk (no network) and prints
// the page to PDF with the print CSS (A4, the sheets' @page) once the html element says
// data-pdf-ready="true" (fonts and images loaded, the navlog's text fitted).
import '../app/styles.css';
import '../ui/ui.css';
import '../features/exports/export.css';
import '../features/exports/form731/forms.css';
import './pdf.css';

import { createRoot } from 'react-dom/client';

import type { ShownSignature } from '../features/exports/form731/Form731';
import { fitSheets } from '../features/exports/navlog/fit';
import { NavlogStage } from '../features/exports/navlog/NavlogSheet';
import { PerfSheet } from '../features/exports/performance/PerformanceExport';
import { WbSheet } from '../features/exports/wb/WbExport';
import { type WbPerfContent, wbPerfContentOf } from '../shared/declarations';
import { type NavlogContent, navlogContentOf } from '../shared/navlogSheets';

/** What the server hands the page. */
type SheetsSnapshot =
  | { kind?: 'wbperf'; content: WbPerfContent; signature: ShownSignature | null }
  | { kind: 'navlog'; content: NavlogContent };

declare global {
  interface Window {
    __PGF_SHEETS__?: SheetsSnapshot;
  }
}

function Sheets({ content: c, signature }: { content: WbPerfContent; signature: ShownSignature | null }) {
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

/** The navlog's printed scale, 0.226 mm per sheet unit (navlog.css @media print), in CSS px: its
 *  text is fitted at the size it prints. */
const NAVLOG_PRINT_PX = (0.226 * 96) / 25.4;

function Navlog({ content }: { content: NavlogContent }) {
  return (
    <div className="page export-page">
      <div className="md42-doc print-sheet-page" data-testid="navlog-export">
        <NavlogStage sheets={content.sheets} fitPx={NAVLOG_PRINT_PX} />
      </div>
    </div>
  );
}

const snap = window.__PGF_SHEETS__;
const root = document.documentElement;
const frame = () => new Promise((r) => requestAnimationFrame(r));
/** Rendered, then every font and image loaded, then `settle`: ready to print. */
const whenDrawn = (settle: () => void = () => {}) =>
  void frame()
    .then(frame)
    .then(() => document.fonts.ready)
    .then(() => Promise.all([...document.images].map((img) => img.decode().catch(() => {}))))
    .then(settle)
    .then(() => {
      root.dataset.pdfReady = 'true';
    });
if (!snap) root.dataset.pdfReady = 'empty';
else if (snap.kind === 'navlog') {
  const content = navlogContentOf(snap.content);
  document.title = [content.sheets[0]?.header.date, 'navlog'].filter(Boolean).join('-');
  createRoot(document.getElementById('root')!).render(<Navlog content={content} />);
  // as the export page does once the fonts are in (NavlogExport.tsx)
  whenDrawn(() => fitSheets(document.querySelector<HTMLElement>('.md42-stage')));
} else {
  const content = wbPerfContentOf(snap.content);
  const s = snap.signature;
  const signature =
    s && typeof s.name === 'string' && Number.isFinite(s.signedAt) ? { name: s.name, signedAt: s.signedAt } : null;
  document.title = ['W&B and performance', content.registration, content.date].filter(Boolean).join(' ');
  createRoot(document.getElementById('root')!).render(<Sheets content={content} signature={signature} />);
  whenDrawn();
}
