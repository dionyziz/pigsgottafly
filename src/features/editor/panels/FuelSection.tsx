// Fuel: required (allowance + trip + final reserve), reserve on top, fuel on board (default =
// required + reserve; editable), capacity and endurance. An aircraft with more than one approved
// fuel gets one input per type (mixed tanks allowed): FOB is their sum, the W&B weighs each type.
import { Link } from 'react-router';

import { type FlightDoc, fuelByType, fuelLoad, type FuelType, primaryFuel } from '../../../shared';
import { fmtDuration } from '../../../shared/format';
import { Chip, NumberField } from '../../../ui';
import { useEditor } from '../state';
import { useFlightCalc } from './calc';
import { KV, Section } from './ui';

const fmtDur = (min: number | null | undefined) => fmtDuration(min, { fallback: '–' });

export function FuelSection() {
  const { doc, update, aircraft } = useEditor();
  const { fuel, navlog } = useFlightCalc();

  if (!aircraft || !fuel) {
    return (
      <Section id="fuel" title="Fuel" badge={<span className="muted">–</span>}>
        <p className="muted ep-note">No aircraft.</p>
      </Section>
    );
  }
  const burn = aircraft.fuel.burnLph;
  const tone =
    fuel.issues.some((i) => i.level === 'danger') || fuel.landingFuelL < 0
      ? 'danger'
      : fuel.fobIsDefault && fuel.defaultOverCapacity
        ? 'warn'
        : undefined;
  const badge = (
    <>
      <span className="tnum">{fuel.fobL} L</span>
      {tone === 'danger' && <Chip tone="danger">Check</Chip>}
      {tone === 'warn' && <Chip tone="warn">Capacity</Chip>}
    </>
  );
  const pct = aircraft.fuel.usableL > 0 ? Math.min(100, (fuel.fobL / aircraft.fuel.usableL) * 100) : 0;
  const reqPct = aircraft.fuel.usableL > 0 ? Math.min(100, (fuel.requiredL / aircraft.fuel.usableL) * 100) : 0;
  /** Litres as flight time at the planning burn, shown pale beside every amount. */
  const time = (l: number) =>
    burn > 0 && Number.isFinite(l) ? <span className="tnum">{fmtDur((l / burn) * 60)}</span> : undefined;
  const types = aircraft.fuel.types.map((g) => g.type);
  const primary = primaryFuel(aircraft.fuel).type;
  const multi = types.length > 1;
  const split = fuelByType(doc.options.fuelL);
  /** Litres typed per type: the split, else all of a typed FOB in the first fuel. */
  const typed = (t: FuelType): number | null => (split ? (split[t] ?? null) : t === primary ? doc.fobL : null);
  const setType = (t: FuelType, v: number | null) =>
    update(
      (d) => {
        const cur = fuelByType(d.options.fuelL) ?? (d.fobL != null ? { [primary]: d.fobL } : {});
        const next: Partial<Record<FuelType, number>> = { ...cur };
        if (v == null) delete next[t];
        else next[t] = v;
        const keys = Object.keys(next) as FuelType[];
        if (!keys.length) return withFuel(d, null, null); // nothing typed: back to the default
        const total = keys.reduce((a, k) => a + (next[k] ?? 0), 0);
        // only the first fuel: a plain total, as for a single-fuel aircraft
        return withFuel(d, total, keys.every((k) => k === primary) ? null : next);
      },
      { coalesce: 'fob-' + t },
    );
  const load = fuelLoad(aircraft.fuel, fuel.fobL, doc.options.fuelL);

  return (
    <Section id="fuel" title="Fuel" badge={badge}>
      <div className="ep-kvs" data-testid="fuel-plan">
        <KV k="Start-up, taxi, TO & landing" v={<span className="tnum">{fuel.taxiL} L</span>} sub={time(fuel.taxiL)} />
        <KV
          k="Trip"
          v={<span className="tnum">{fuel.tripL} L</span>}
          sub={navlog ? <span className="tnum">{fmtDur(navlog.flightMin)}</span> : time(fuel.tripL)}
        />
        {fuel.finalReserveL > 0 && (
          <KV
            k="Final reserve"
            v={<span className="tnum">{fuel.finalReserveL} L</span>}
            sub={time(fuel.finalReserveL)}
          />
        )}
        <KV
          k={<b>Required</b>}
          v={
            <b className="tnum" data-testid="fuel-required">
              {fuel.requiredL} L
            </b>
          }
          sub={time(fuel.requiredL)}
        />
        <KV
          k="Reserve"
          v={<span className="tnum">{fuel.reserveL} L</span>}
          sub={fuel.reserveUnset ? <Link to="/profile">set in your profile</Link> : time(fuel.reserveL)}
          tone={fuel.reserveUnset ? 'warn' : undefined}
        />
        <KV
          k="Required + reserve"
          v={<span className="tnum">{fuel.defaultFobL} L</span>}
          sub={time(fuel.defaultFobL)}
          tone={fuel.defaultOverCapacity ? 'warn' : undefined}
        />
      </div>
      <div className="ep-fob" data-focus="fob">
        {multi ? (
          <div className="field">
            Fuel on board at block-off (L)
            <span className="row ep-fob-types">
              {types.map((t) => (
                <label key={t} className="ep-fob-type">
                  <span className="muted">{t}</span>
                  <NumberField
                    value={typed(t)}
                    min={0}
                    max={2000}
                    width={80}
                    ariaLabel={`${t} on board, litres`}
                    className="ep-num"
                    placeholder={t === primary && doc.fobL == null && !split ? String(fuel.defaultFobL) : '0'}
                    testId={t === primary ? 'fob' : `fob-${t}`}
                    onChange={(v) => setType(t, v)}
                  />
                </label>
              ))}
              <span className="tnum ep-fob-total" data-testid="fob-total">
                = {fuel.fobL} L · <span data-testid="fob-kg">{Math.round(load.kg * 10) / 10} kg</span>
              </span>
            </span>
            <span className="row">
              {doc.fobL != null ? (
                <button type="button" className="ghost" onClick={() => update((d) => withFuel(d, null, null))}>
                  Use required + reserve
                </button>
              ) : null}
              {doc.fobL == null && aircraft.fuel.usableL > 0 && fuel.defaultOverCapacity && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => update((d) => withFuel(d, aircraft.fuel.usableL, null))}
                >
                  Full tanks
                </button>
              )}
            </span>
          </div>
        ) : (
          <label className="field">
            Fuel on board at block-off (L)
            <span className="row">
              <NumberField
                value={doc.fobL}
                min={0}
                max={2000}
                width={90}
                placeholder={String(fuel.defaultFobL)}
                testId="fob"
                className="ep-num"
                onChange={(v) => update((d) => withFuel(d, v, null), { coalesce: 'fob' })}
              />
              {doc.fobL != null ? (
                <button type="button" className="ghost" onClick={() => update((d) => withFuel(d, null, null))}>
                  Use required + reserve
                </button>
              ) : null}
              {doc.fobL == null && aircraft.fuel.usableL > 0 && fuel.defaultOverCapacity && (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => update((d) => withFuel(d, aircraft.fuel.usableL, null))}
                >
                  Full tanks
                </button>
              )}
            </span>
          </label>
        )}
        {load.unapproved.length > 0 && (
          <p className="ep-note danger-text">
            {load.unapproved.join(' and ')} {load.unapproved.length > 1 ? 'are' : 'is'} not an approved fuel of{' '}
            {aircraft.registration}.
          </p>
        )}
        {aircraft.fuel.usableL > 0 && (
          <div className="ep-gauge" title={`${fuel.fobL} of ${aircraft.fuel.usableL} L`}>
            <div
              className={'fill' + (fuel.overCapacity ? ' over' : fuel.belowRequired ? ' low' : '')}
              style={{ width: `${pct}%` }}
            />
            <div className="req" style={{ left: `${reqPct}%` }} title={`Required ${fuel.requiredL} L`} />
          </div>
        )}
        <div className="ep-gauge-legend muted">
          <span>0</span>
          <span>Capacity {aircraft.fuel.usableL} L</span>
        </div>
      </div>
      <div className="ep-kvs">
        <KV k="Endurance at block-off" v={<span className="tnum">{fmtDur(fuel.enduranceMin)}</span>} />
        <KV
          k="Fuel at landing"
          tone={fuel.landingReserveShort ? 'danger' : undefined}
          v={<span className="tnum">{fuel.landingFuelL} L</span>}
          sub={
            <span className="tnum" data-testid="fuel-landing-endurance">
              {fmtDur(fuel.landingEnduranceMin)}
            </span>
          }
        />
      </div>
      {fuel.issues
        .filter((w) => !/reserve not set/i.test(w.text))
        .map((w) => (
          <p key={w.text} className={'ep-note ' + (w.level === 'danger' ? 'danger-text' : 'warn-text')}>
            {w.text}
          </p>
        ))}
    </Section>
  );
}

/** The flight with fuel on board `fobL` (null = default) and the split by type (null = all the first fuel). */
function withFuel(d: FlightDoc, fobL: number | null, byType: Partial<Record<FuelType, number>> | null): FlightDoc {
  return { ...d, fobL, options: { ...d.options, fuelL: byType } };
}
