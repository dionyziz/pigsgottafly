// /flights/:id/export/:kind: print-ready A4 pages, one route per document.
//   navlog (MD 4.2 sheet), form731 (HCAA Form 731), gendec (MD 4.7 General Declaration),
//   fpl (ICAO 2012 message + form view), wb (MD 4.3 loading sheet + envelope), performance (MD 4.4).
// Each export component loads what it needs (aircraft, weather) itself; the forms get it from here.
import { Link, useParams } from 'react-router-dom';
import { api } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import { usePilot } from '../../app/session';
import { EXPORT_KINDS, EXPORT_LABEL, type Aircraft, type ExportKind, type Flight, type Passenger } from '../../shared';
import { NavlogExport } from './navlog';
import { Form731 } from './form731';
import { GenDec } from './gendec';
import { FplExport } from './fpl';
import { WbExport } from './wb';
import { PerformanceExport } from './performance';
import './export.css';

function FormExport({ flight, kind }: { flight: Flight; kind: 'form731' | 'gendec' }) {
  const pilot = usePilot();
  const ac = useAsync<Aircraft | null>(
    () => (flight.aircraftId ? api.aircraft.get(flight.aircraftId).catch(() => null) : Promise.resolve(null)),
    [flight.aircraftId],
  );
  const pax = useAsync<Passenger[]>(() => api.passengers.list().catch(() => []), []);
  if (ac.loading || pax.loading) return <div className="loading-screen">Loading…</div>;
  const props = { flight, aircraft: ac.data ?? null, pilot, passengers: pax.data ?? [] };
  return kind === 'form731' ? <Form731 {...props} /> : <GenDec {...props} />;
}

function Body({ flight, kind }: { flight: Flight; kind: ExportKind }) {
  switch (kind) {
    case 'navlog': return <NavlogExport flight={flight} />;
    case 'form731': return <FormExport flight={flight} kind="form731" />;
    case 'gendec': return <FormExport flight={flight} kind="gendec" />;
    case 'fpl': return <FplExport flight={flight} />;
    case 'wb': return <WbExport flight={flight} />;
    case 'performance': return <PerformanceExport flight={flight} />;
  }
}

export function ExportPage() {
  const { id = '', kind = '' } = useParams();
  const { data: flight, error } = useAsync(() => api.flights.get(id), [id]);
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return <div className="loading-screen">Unknown export “{kind}”.</div>;
  if (error) return <div className="loading-screen">Flight not found. <Link to="/">Back to flights</Link></div>;
  if (!flight) return <div className="loading-screen">Loading…</div>;
  const k = kind as ExportKind;
  return (
    <div className="page export-page" data-testid="export-page" data-kind={kind}>
      <div className="row no-print export-bar">
        <Link to={`/flights/${flight.id}`} className="export-back">← {flight.summary.title || 'Flight'}</Link>
        <h2>{EXPORT_LABEL[k]}</h2>
        <span className="spacer" />
        <nav className="export-tabs" aria-label="Other exports">
          {EXPORT_KINDS.filter((x) => x !== k).map((x) => (
            <Link key={x} to={`/flights/${flight.id}/export/${x}`}>{EXPORT_LABEL[x]}</Link>
          ))}
        </nav>
        <button className="primary" onClick={() => window.print()} data-testid="export-print">Print</button>
      </div>
      <Body flight={flight} kind={k} />
    </div>
  );
}
