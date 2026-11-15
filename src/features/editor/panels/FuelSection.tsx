// Fuel: required (allowance + trip + final reserve), reserve on top, fuel on board (default =
// required + reserve; editable), capacity and endurance.
import { Link } from 'react-router-dom';
import { useEditor } from '../state';
import { fmtDur, useFlightCalc } from './calc';
import { Chip, KV, NumberInput, Section } from './ui';

export function FuelSection() {
  const { doc, update, aircraft, pilot } = useEditor();
  const { fuel, navlog } = useFlightCalc();

  if (!aircraft || !fuel) {
    return (
      <Section id="fuel" title="Fuel" badge={<span className="muted">–</span>}>
        <p className="muted ep-note">Choose an aircraft to plan the fuel.</p>
      </Section>
    );
  }
  const burn = aircraft.fuel.burnLph;
  const tone = fuel.issues.some((i) => i.level === 'danger') || fuel.landingFuelL < 0 ? 'danger' : fuel.fobIsDefault && fuel.defaultOverCapacity ? 'warn' : undefined;
  const badge = (
    <>
      <span className="mono">{fuel.fobL} L</span>
      {tone === 'danger' && <Chip tone="danger">Check</Chip>}
      {tone === 'warn' && <Chip tone="warn">Capacity</Chip>}
    </>
  );
  const pct = aircraft.fuel.usableL > 0 ? Math.min(100, (fuel.fobL / aircraft.fuel.usableL) * 100) : 0;
  const reqPct = aircraft.fuel.usableL > 0 ? Math.min(100, (fuel.requiredL / aircraft.fuel.usableL) * 100) : 0;
  const reserveMin = pilot.settings.reserveMin;

  return (
    <Section id="fuel" title="Fuel" badge={badge}>
      <div className="ep-kvs" data-testid="fuel-plan">
        <KV k="Start-up, taxi, TO & landing" v={<span className="mono">{fuel.taxiL} L</span>} />
        <KV k="Trip" v={<span className="mono">{fuel.tripL} L</span>} sub={navlog ? <span className="mono">{fmtDur(navlog.flightMin)} at {burn} L/h</span> : undefined} />
        {fuel.finalReserveL > 0 && <KV k={`Final reserve (${pilot.settings.finalReserveMin} min)`} v={<span className="mono">{fuel.finalReserveL} L</span>} />}
        <KV k={<b>Required</b>} v={<b className="mono" data-testid="fuel-required">{fuel.requiredL} L</b>} />
        <KV k={reserveMin != null ? `Reserve (${reserveMin} min)` : 'Reserve'} v={<span className="mono">{fuel.reserveL} L</span>}
          sub={fuel.reserveUnset ? <Link to="/profile">set in your profile</Link> : undefined} tone={fuel.reserveUnset ? 'warn' : undefined} />
        <KV k="Required + reserve" v={<span className="mono">{fuel.defaultFobL} L</span>} tone={fuel.defaultOverCapacity ? 'warn' : undefined} />
      </div>
      <div className="ep-fob">
        <label className="field">Fuel on board at block-off (L)
          <span className="row">
            <NumberInput value={doc.fobL} min={0} max={2000} width={90} placeholder={String(fuel.defaultFobL)} testId="fob"
              onCommit={(v) => update((d) => ({ ...d, fobL: v }), { coalesce: 'fob' })} />
            {doc.fobL != null
              ? <button type="button" className="ghost" onClick={() => update((d) => ({ ...d, fobL: null }))}>Use required + reserve</button>
              : <span className="hint">Default: required + reserve</span>}
            {doc.fobL == null && aircraft.fuel.usableL > 0 && fuel.defaultOverCapacity && (
              <button type="button" className="ghost" onClick={() => update((d) => ({ ...d, fobL: aircraft.fuel.usableL }))}>Full tanks</button>
            )}
          </span>
        </label>
        {aircraft.fuel.usableL > 0 && (
          <div className="ep-gauge" title={`${fuel.fobL} of ${aircraft.fuel.usableL} L usable`}>
            <div className={'fill' + (fuel.overCapacity ? ' over' : fuel.belowRequired ? ' low' : '')} style={{ width: `${pct}%` }} />
            <div className="req" style={{ left: `${reqPct}%` }} title={`Required ${fuel.requiredL} L`} />
          </div>
        )}
        <div className="ep-gauge-legend muted">
          <span>0</span><span>Usable {aircraft.fuel.usableL} L ({aircraft.fuel.type})</span>
        </div>
      </div>
      <div className="ep-kvs">
        <KV k="Endurance at block-off" v={<span className="mono">{fmtDur(fuel.enduranceMin)}</span>} sub="FPL item 19 E/" />
        <KV k="Fuel at landing" tone={fuel.landingReserveShort ? 'danger' : undefined}
          v={<span className="mono">{fuel.landingFuelL} L</span>}
          sub={<span className="mono" data-testid="fuel-landing-endurance">{fmtDur(fuel.landingEnduranceMin)} · min {fmtDur(fuel.minLandingReserveMin)}</span>} />
      </div>
      {fuel.issues.filter((w) => !/reserve not set/i.test(w.text)).map((w) => (
        <p key={w.text} className={'ep-note ' + (w.level === 'danger' ? 'danger-text' : 'warn-text')}>{w.text}</p>
      ))}
    </Section>
  );
}
