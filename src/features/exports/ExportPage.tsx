// /flights/:id/export/:kind: print-ready A4 pages, one route per document.
//   navlog (MD 4.2 sheet), form731 (HCAA Form 731), gendec (MD 4.7 General Declaration),
//   fpl (ICAO 2012 message + form view), wbperf (MD 4.3 loading sheet + envelope, then MD 4.4
//   performance; the old /wb and /performance links redirect here), briefing (NOTAMs relevant to the flight).
// Each export component loads what it needs (aircraft, weather) itself; the forms get it from here.
//
// The flight is loaded after the editor's pending edits are sent (so the export never shows the
// manifest from before the last edit), and again when the window regains focus or a flight changes
// here or in another tab. The aircraft and passengers come from the shared entity cache.
import './export.css';

import { Link, Navigate, useParams } from 'react-router';

import { api } from '../../data/api';
import { flightStore } from '../../data/flightStore';
import { useAsync } from '../../data/useAsync';
import { EXPORT_KINDS, EXPORT_LABEL, EXPORT_REDIRECTS, type ExportKind, type Flight } from '../../shared';
import { EmptyState, Loading } from '../../ui';
import { type ItemState, paperwork, PAPERWORK_KIND } from '../editor/panels/readiness';
import { BriefingExport } from './briefing';
import { Form731 } from './form731';
import { shownSignatures, SignaturesPanel, useFormsState } from './form731/SignaturesPanel';
import { FplExport } from './fpl';
import { GenDec } from './gendec';
import { GenDecSendPanel } from './gendec/SendPanel';
import { NavlogExport } from './navlog';
import { useFlightAircraft, useFlightPilot, usePassengers } from './useExportData';
import { WbPerfExport } from './wbperf';

/** How long the export waits for the editor's unsent edits before loading the flight anyway. */
const FLUSH_WAIT_MS = 4000;
const FLUSH_POLL_MS = 150;

/** Sends the editor's pending edits and waits (a while) until they are saved. */
async function flushFlightEdits(): Promise<void> {
  const until = Date.now() + FLUSH_WAIT_MS;
  await flightStore.flushNow().catch(() => {});
  // a flush already running returns at once: wait for it to finish
  while (flightStore.status === 'saving' && Date.now() < until) {
    await new Promise((r) => setTimeout(r, FLUSH_POLL_MS));
    await flightStore.flushNow().catch(() => {});
  }
}

function FormExport({ flight, kind }: { flight: Flight; kind: 'form731' | 'gendec' }) {
  const pilot = useFlightPilot(flight);
  const ac = useFlightAircraft(flight);
  const pax = usePassengers();
  // signatures (Form 731) and the e-mail to HCAA (both forms)
  const forms = useFormsState(flight.id);
  if (ac.loading || pax.loading) return <Loading />;
  const props = { flight, aircraft: ac.aircraft, pilot, passengers: pax.passengers };
  return kind === 'form731' ? (
    <Form731
      {...props}
      signatures={shownSignatures(forms.st)}
      panel={<SignaturesPanel flightId={flight.id} forms={forms} />}
    />
  ) : (
    <GenDec
      {...props}
      signature={forms.st?.gendec.picSignature ?? null}
      panel={<GenDecSendPanel flightId={flight.id} forms={forms} />}
    />
  );
}

function Body({ flight, kind }: { flight: Flight; kind: ExportKind }) {
  switch (kind) {
    case 'navlog':
      return <NavlogExport flight={flight} />;
    case 'form731':
      return <FormExport flight={flight} kind="form731" />;
    case 'gendec':
      return <FormExport flight={flight} kind="gendec" />;
    case 'fpl':
      return <FplExport flight={flight} />;
    case 'wbperf':
      return <WbPerfExport flight={flight} />;
    case 'briefing':
      return <BriefingExport flight={flight} />;
  }
}

/** Each form's state, as the editor's "Ready to fly" sees it (readiness.ts paperwork): a dot on its tab. */
function useFormStates(id: string): Partial<Record<ExportKind, ItemState>> {
  const opts = (cache: string) => ({ cache, refetchOnFocus: true, invalidatedBy: 'flights' as const });
  const filing = useAsync(() => api.filing.get(id), [id], opts(`filing:${id}`));
  const forms = useAsync(() => api.forms.get(id), [id], opts(`forms:${id}`));
  const declarations = useAsync(() => api.declarations.get(id), [id], {
    ...opts(`declarations:${id}`),
    invalidatedBy: ['operators', 'aircraft', 'flights'],
  });
  const out: Partial<Record<ExportKind, ItemState>> = {};
  for (const it of paperwork({
    filing: filing.data ?? null,
    forms: forms.data ?? null,
    declarations: declarations.data ?? null,
  }))
    out[PAPERWORK_KIND[it.id]] = it.state;
  return out;
}

export function ExportPage() {
  const { id = '', kind = '' } = useParams();
  const { data: flight, error } = useAsync(
    async () => {
      await flushFlightEdits();
      return api.flights.get(id);
    },
    [id],
    { refetchOnFocus: true, invalidatedBy: 'flights', cache: `flight:${id}` },
  );
  const formStates = useFormStates(id);
  if (Object.hasOwn(EXPORT_REDIRECTS, kind))
    return <Navigate replace to={`/flights/${id}/export/${EXPORT_REDIRECTS[kind]}`} />;
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) {
    return (
      <div className="page">
        <EmptyState title={`No document “${kind}”`} action={<Link to={`/flights/${id}`}>Back to the flight</Link>} />
      </div>
    );
  }
  if (error && !flight)
    return (
      <div className="page">
        <EmptyState title="Flight not found" action={<Link to="/">Back to flights</Link>} />
      </div>
    );
  if (!flight) return <Loading variant="screen" />;
  const k = kind as ExportKind;
  return (
    <div className="page export-page" data-testid="export-page" data-kind={kind}>
      <div className="no-print export-bar">
        <Link to={`/flights/${flight.id}`} className="export-back">
          ← {flight.summary.title || 'Flight'}
        </Link>
        <nav className="export-tabs" aria-label="Exports" role="tablist">
          {EXPORT_KINDS.map((x) => (
            <Link
              key={x}
              to={`/flights/${flight.id}/export/${x}`}
              role="tab"
              aria-selected={x === k}
              aria-current={x === k ? 'page' : undefined}
              className={x === k ? 'active' : undefined}
              data-testid={`export-tab-${x}`}
              data-state={formStates[x]}
            >
              {formStates[x] && <span className={'rd-dot is-' + formStates[x]} aria-hidden />}
              {EXPORT_LABEL[x]}
            </Link>
          ))}
        </nav>
        <button className="primary" onClick={() => window.print()} data-testid="export-print">
          Print
        </button>
      </div>
      <Body flight={flight} kind={k} />
    </div>
  );
}
