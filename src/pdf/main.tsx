// Sheets as e-mailed (pdf.html, a second entry of the Vite build), drawn by the export pages' own
// components with the app's CSS from the content the pilot sent:
//   kind 'wbperf'  the W&B and performance sheets to the aircraft's operator
//                  (../features/exports/wb/WbExport.tsx, performance/PerformanceExport.tsx)
//   kind 'navlog'  the navigation log to the pilot (../features/exports/navlog/NavlogSheet.tsx)
//   kind 'fplfax'  a flight plan (or its DLA / CNL) faxed to an ATS reporting office: a cover page and
//                  the ICAO form (../features/exports/fpl/FaxSheets.tsx)
//   kind 'briefing' the NOTAM briefing (../features/exports/briefing/BriefingExport.tsx BriefingSheet)
//   kind 'fplform' the ICAO flight plan form as the FPL page shows it (../features/exports/fpl/FplForm.tsx)
// Opened by the server's headless Chromium (api/_lib/sheetPdf.ts) and by the iPhone app's off-screen
// WKWebView (native/ios/.../Services/SheetRenderer.swift, this page inlined into one file by
// tools/build_native_pdf.ts). Both put the snapshot in window.__PGF_SHEETS__ before the page loads,
// load nothing from the network and print the page with the print CSS (A4, the sheets' @page) once
// the html element says data-pdf-ready="true" (fonts and images loaded, the navlog's text fitted).
import '../app/styles.css';
import '../ui/ui.css';
import '../features/exports/export.css';
import '../features/exports/form731/forms.css';
import './pdf.css';

import { createRoot } from 'react-dom/client';

import { BriefingSheet } from '../features/exports/briefing/BriefingExport';
import type { BriefingModel } from '../features/exports/briefing/model';
import type { ShownSignature } from '../features/exports/form731/Form731';
import { FaxSheets } from '../features/exports/fpl/FaxSheets';
import type { FplResult } from '../features/exports/fpl/fpl';
import { FplForm } from '../features/exports/fpl/FplForm';
import { parseFplMessage } from '../features/exports/fpl/parseFpl';
import { fitSheets } from '../features/exports/navlog/fit';
import { NavlogStage } from '../features/exports/navlog/NavlogSheet';
import { PerfSheet } from '../features/exports/performance/PerformanceExport';
import { WbSheet } from '../features/exports/wb/WbExport';
import { type WbPerfContent, wbPerfContentOf } from '../shared/declarations';
import { type FplFaxContent, fplFaxContentOf } from '../shared/fax';
import { type NavlogContent, navlogContentOf } from '../shared/navlogSheets';

/** What the server hands the page. */
type SheetsSnapshot =
  | { kind?: 'wbperf'; content: WbPerfContent; signature: ShownSignature | null }
  | { kind: 'navlog'; content: NavlogContent }
  | { kind: 'fplfax'; content: FplFaxContent }
  // the app's own models (PGF.briefingModel, PGF.fplMessage), never content from someone else
  | { kind: 'briefing'; content: BriefingModel }
  | { kind: 'fplform'; content: FplFormContent };

/** The FPL page's form: `fpl` as PGF.fplMessage builds it (its fields keep the missing '?'), or the
 *  message alone (its fields read back from the text, as a faxed plan's). */
interface FplFormContent {
  fpl: FplResult | string;
  addresses?: string[];
  signature?: ShownSignature | null;
}

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

function Briefing({ m }: { m: BriefingModel }) {
  return (
    <div className="page export-page">
      <div className="xp-doc print-sheet-page" data-testid="briefing-export">
        <div className="xp-stage">
          <BriefingSheet m={m} />
        </div>
      </div>
    </div>
  );
}

function fplResultOf(fpl: FplResult | string): FplResult {
  if (typeof fpl !== 'string') return fpl;
  return {
    fields: parseFplMessage(fpl),
    message: fpl,
    lines: fpl.split('\n'),
    complete: true,
    warnings: [],
    fixes: {},
  };
}

function FplFormPage({ c }: { c: FplFormContent }) {
  return (
    <div className="page export-page">
      <div className="fpl-export print-sheet-page" data-testid="fpl-export">
        <FplForm fpl={fplResultOf(c.fpl)} addressees={c.addresses ?? []} signature={c.signature ?? null} />
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
} else if (snap.kind === 'fplfax') {
  const content = fplFaxContentOf(snap.content);
  document.title = 'Flight plan fax';
  createRoot(document.getElementById('root')!).render(<FaxSheets c={content} />);
  whenDrawn();
} else if (snap.kind === 'briefing') {
  const m = { ...snap.content, relevant: snap.content.relevant ?? [] };
  document.title = ['NOTAM briefing', m.date].filter(Boolean).join(' ');
  createRoot(document.getElementById('root')!).render(<Briefing m={m} />);
  whenDrawn();
} else if (snap.kind === 'fplform') {
  document.title = 'Flight plan';
  createRoot(document.getElementById('root')!).render(<FplFormPage c={snap.content} />);
  whenDrawn();
} else {
  const content = wbPerfContentOf(snap.content);
  const s = snap.signature;
  const signature =
    s && typeof s.name === 'string' && Number.isFinite(s.signedAt) ? { name: s.name, signedAt: s.signedAt } : null;
  document.title = ['W&B and performance', content.registration, content.date].filter(Boolean).join(' ');
  createRoot(document.getElementById('root')!).render(<Sheets content={content} signature={signature} />);
  whenDrawn();
}
