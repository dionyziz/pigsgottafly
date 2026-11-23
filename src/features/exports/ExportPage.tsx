// The flight is loaded after the editor's pending edits are sent (so the export never shows the
// manifest from before the last edit), and again when the window regains focus or a flight changes
// here or in another tab.
import './export.css';

import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router';

import { flightTitle, usePageTitle } from '../../app/title';
import { api } from '../../data/api';
import { flightStore } from '../../data/flightStore';
import { useAsync } from '../../data/useAsync';
import {
  EXPORT_KINDS,
  EXPORT_LABEL,
  EXPORT_REDIRECTS,
  type ExportKind,
  type Flight,
  isLocalFlight,
} from '../../shared';
import { form731Needed } from '../../shared/forms';
import { EmptyState, Icon, Loading } from '../../ui';
import { paperwork, PAPERWORK_KIND, type ReadyItem } from '../editor/panels/readiness';
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
function useFormStates(id: string): Partial<Record<ExportKind, ReadyItem>> {
  const opts = (cache: string) => ({ cache, refetchOnFocus: true, invalidatedBy: 'flights' as const });
  const filing = useAsync(() => api.filing.get(id), [id], opts(`filing:${id}`));
  const forms = useAsync(() => api.forms.get(id), [id], opts(`forms:${id}`));
  const declarations = useAsync(() => api.declarations.get(id), [id], {
    ...opts(`declarations:${id}`),
    invalidatedBy: ['operators', 'aircraft', 'flights'],
  });
  const out: Partial<Record<ExportKind, ReadyItem>> = {};
  for (const it of paperwork({
    filing: filing.data ?? null,
    forms: forms.data ?? null,
    declarations: declarations.data ?? null,
  }))
    out[PAPERWORK_KIND[it.id]] = it;
  return out;
}

/** A form's name in the browser tab where pilots call it something shorter than its label. */
const TAB_TITLE: Record<string, string> = { navlog: 'Navlog' };

function printFileName(date: string | null | undefined, kind: string): string {
  return [date || '', kind].filter(Boolean).join('-');
}

/** The documents of a flight: a local flight has no legs, so no navlog; a PIC alone, no Form 731. */
const exportKinds = (flight: Pick<Flight, 'route' | 'crew'>): readonly ExportKind[] =>
  EXPORT_KINDS.filter(
    (k) => !(k === 'navlog' && isLocalFlight(flight.route)) && !(k === 'form731' && !form731Needed(flight.crew)),
  );

function FormStatus({
  flightId,
  kind,
  kinds,
  states,
}: {
  flightId: string;
  kind: ExportKind;
  kinds: readonly ExportKind[];
  states: Partial<Record<ExportKind, ReadyItem>>;
}) {
  const it = states[kind];
  const next = kinds.find((x) => x !== kind && states[x] && states[x].state !== 'ok');
  if (!it && !next) return null;
  return (
    <div className="no-print xp-status-row">
      {it && (
        <div className={'xp-status is-' + it.state} data-testid="form-status" data-state={it.state}>
          <Icon name={it.state === 'ok' ? 'check' : 'warn'} size={14} />
          <b>{it.state === 'ok' ? 'Done' : 'Needs your attention'}</b>
          {it.text && <span>{it.text}</span>}
        </div>
      )}
      {next && (
        <Link className="xp-status-next" to={`/flights/${flightId}/export/${next}`} data-testid="form-status-next">
          Next: {EXPORT_LABEL[next]} →
        </Link>
      )}
    </div>
  );
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
  usePageTitle(
    flight && (TAB_TITLE[kind] ?? (EXPORT_LABEL as Record<string, string>)[kind]),
    flight && flightTitle(flight),
  );
  const printName = flight ? printFileName(flight.date, kind) : null;
  useEffect(() => {
    if (!printName) return;
    let shown = '';
    const before = () => {
      shown = document.title;
      document.title = printName;
    };
    const after = () => {
      if (shown) document.title = shown;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, [printName]);
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
  const kinds = exportKinds(flight);
  if (!kinds.includes(k)) return <Navigate replace to={`/flights/${id}/export/fpl`} />;
  return (
    <div className="page export-page" data-testid="export-page" data-kind={kind}>
      <div className="no-print export-bar">
        <Link to={`/flights/${flight.id}`} className="export-back">
          ← {flight.summary.title || 'Flight'}
        </Link>
        <nav className="export-tabs" aria-label="Exports" role="tablist">
          {kinds.map((x) => (
            <Link
              key={x}
              to={`/flights/${flight.id}/export/${x}`}
              role="tab"
              aria-selected={x === k}
              aria-current={x === k ? 'page' : undefined}
              className={x === k ? 'active' : undefined}
              data-testid={`export-tab-${x}`}
              data-state={formStates[x]?.state}
              title={formStates[x] ? `${formStates[x].label}: ${formStates[x].text ?? 'done.'}` : undefined}
            >
              {formStates[x] &&
                (formStates[x].state === 'ok' ? (
                  <Icon name="check" size={13} className="xp-tab-ok" />
                ) : (
                  <span className={'rd-dot is-' + formStates[x].state} aria-hidden />
                ))}
              {EXPORT_LABEL[x]}
            </Link>
          ))}
        </nav>
        <button className="primary" onClick={() => window.print()} data-testid="export-print">
          Print
        </button>
      </div>
      <FormStatus flightId={flight.id} kind={k} kinds={kinds} states={formStates} />
      <Body flight={flight} kind={k} />
    </div>
  );
}
