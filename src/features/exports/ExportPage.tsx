// /flights/:id/export/:kind — print-ready A4 pages (exports agent owns src/features/exports/**).
// PLACEHOLDER: loads the flight and shows which document would print. To build one component per
// kind: navlog (MD4.2 sheet), form731, gendec (MD 4.7), fpl (ICAO 2012 message + form view),
// wb (MD 4.3 table + SVG envelope), performance (MD 4.4).
import { useParams } from 'react-router-dom';
import { api } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import { EXPORT_KINDS, EXPORT_LABEL, type ExportKind } from '../../shared';

export function ExportPage() {
  const { id = '', kind = '' } = useParams();
  const { data: flight, error } = useAsync(() => api.flights.get(id), [id]);
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) return <div className="loading-screen">Unknown export “{kind}”.</div>;
  if (error) return <div className="loading-screen">Flight not found.</div>;
  if (!flight) return <div className="loading-screen">Loading…</div>;
  return (
    <div className="page" data-testid="export-page" data-kind={kind}>
      <div className="row no-print" style={{ marginBottom: 16 }}>
        <h2>{EXPORT_LABEL[kind as ExportKind]}</h2><span className="spacer" /><button className="primary" onClick={() => window.print()}>Print</button>
      </div>
      <div className="card" style={{ padding: 24 }}>
        <h3>{flight.summary.title || 'Untitled flight'}</h3>
        <p className="muted">{flight.date} · {flight.route.map((p) => p.name).join(' → ')}</p>
        <p className="muted">This export is not built yet.</p>
      </div>
    </div>
  );
}
