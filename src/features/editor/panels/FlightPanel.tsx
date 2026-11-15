// Left panel (screens agent owns src/features/editor/panels/**). PLACEHOLDER with the date/time and
// aircraft fields. To build: When (date, block-off UTC + local, taxi out/in, computed TO/landing/
// block-on), Aircraft, Manifest (type-ahead + create), Fuel (required/FOB, capacity warning),
// ATC list (edit/reorder/regenerate), Exports.
import { Link } from 'react-router-dom';
import { EXPORT_KINDS, EXPORT_LABEL } from '../../../shared';
import { useEditor } from '../state';

export function FlightPanel() {
  const { doc, update, hangar, flight } = useEditor();
  return (
    <div className="stack" style={{ padding: 16 }} data-testid="flight-panel">
      <h3>When</h3>
      <div className="row">
        <label className="field">Date<input type="date" value={doc.date} onChange={(e) => update((d) => ({ ...d, date: e.target.value }), { coalesce: 'date' })} /></label>
        <label className="field">Block-off (UTC)<input value={doc.blockOff} placeholder="HH:MM" onChange={(e) => update((d) => ({ ...d, blockOff: e.target.value }), { coalesce: 'blockOff' })} style={{ width: 90 }} /></label>
      </div>
      <h3>Aircraft</h3>
      <select value={doc.aircraftId ?? ''} onChange={(e) => update((d) => ({ ...d, aircraftId: e.target.value || null }))}>
        <option value="">—</option>
        {hangar.map((a) => <option key={a.id} value={a.id}>{a.registration}</option>)}
      </select>
      <h3>Route</h3>
      <p className="muted" style={{ margin: 0 }}>{doc.route.map((p) => p.name).join(' → ') || 'No route yet.'}</p>
      <h3>Exports</h3>
      <div className="stack" style={{ gap: 4 }}>
        {EXPORT_KINDS.map((k) => <Link key={k} to={`/flights/${flight.id}/export/${k}`} target="_blank">{EXPORT_LABEL[k]}</Link>)}
      </div>
    </div>
  );
}
