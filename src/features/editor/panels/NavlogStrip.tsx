// Collapsible navlog strip under the map (screens agent). PLACEHOLDER: legs with TC/MC/distance and
// altitude. To build: live computeNavlog() results (wind, WCA, GS, ETE, fuel) and weather warnings.
import { useState } from 'react';
import { fmtHdg } from '../../../calc';
import { useEditor } from '../state';

export function NavlogStrip() {
  const { legs, altitudesFt } = useEditor();
  const [open, setOpen] = useState(true);
  return (
    <section className="card" style={{ borderRadius: 0, borderLeft: 0, borderRight: 0, maxHeight: open ? 240 : 40, overflow: 'auto' }} data-testid="navlog-strip">
      <div className="row" style={{ padding: '6px 12px' }}>
        <b>Navlog</b><span className="muted">{legs.length} legs</span><span className="spacer" />
        <button className="ghost" onClick={() => setOpen((o) => !o)}>{open ? 'Hide' : 'Show'}</button>
      </div>
      {open && legs.length > 0 && (
        <table className="list"><thead><tr><th>Leg</th><th>MC</th><th>Dist</th><th>Alt</th></tr></thead><tbody>
          {legs.map((l, i) => (
            <tr key={l.key}><td>{l.from.name} → {l.to.name}</td><td>{fmtHdg(l.mcMag)}°</td><td>{Math.round(l.distNm)} NM</td><td>{isFinite(altitudesFt[i]) ? altitudesFt[i] : '—'}</td></tr>
          ))}
        </tbody></table>
      )}
    </section>
  );
}
