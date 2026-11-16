// Manifest and loading: PIC (me, from the profile) and PAX from the passenger list (type-ahead,
// or created on the spot), each in a seat of the aircraft; body weights for this flight; baggage per
// baggage area; W&B category; take-off/landing mass and CG against the envelope.
import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';

import {
  FALLBACK_SEATS,
  type FlightCrew,
  type Passenger,
  type PersonDetails,
  type Pilot,
  seatLayout,
} from '../../../shared';
import { Chip, Icon, NumberField, PersonPicker } from '../../../ui';
import { PassengerDialog, PilotDetailsDialog } from '../../passengers/PassengerDialog';
import { useEditor } from '../state';
import { useFlightCalc } from './calc';
import { EnvelopeChart } from './EnvelopeChart';
import { addPicToCrew, applyPerson, editCrewField, followPerson, resetCrew } from './manifest';
import { KV, Section } from './ui';

export function personOf(p: Pilot | Passenger): PersonDetails {
  return {
    fullName: p.fullName,
    phone: p.phone,
    dateOfBirth: p.dateOfBirth,
    weightKg: p.weightKg,
    idNumber: p.idNumber,
    idType: p.idType,
    nationality: p.nationality,
    relation: p.relation,
  };
}

const FALLBACK_LABELS: Record<string, string> = {
  'front-left': 'Front left',
  'front-right': 'Front right',
  'rear-left': 'Rear left',
  'rear-right': 'Rear right',
};

/**
 * Keeps the manifest's linked people in step with the passenger list and the profile: an edit there
 * (here, on another page or in another tab) updates the snapshot, except the fields edited on this
 * flight; a passenger deleted from the list is unlinked (the snapshot stays on the manifest).
 */
function useCrewSync() {
  const { doc, update, passengers, passengersLoaded, pilot } = useEditor();
  const seen = useRef<Map<string, PersonDetails> | null>(null);
  const sync = useEffectEvent(() => {
    if (!passengersLoaded) return;
    const now = new Map<string, PersonDetails>(passengers.map((p) => [p.id, personOf(p)]));
    now.set('PIC', personOf(pilot));
    const before = seen.current;
    seen.current = now;
    const crew = doc.crew;
    const keyOf = (c: FlightCrew) => (c.role === 'PIC' ? 'PIC' : c.passengerId);
    const next = crew.map((c) => {
      const k = keyOf(c);
      if (!k) return c;
      const after = now.get(k);
      if (!after) return c.role === 'PAX' ? { ...c, passengerId: null } : c;
      const was = before?.get(k);
      if (!was) return c;
      const snapshot = followPerson(c.snapshot, was, after, c.overrides);
      return snapshot === c.snapshot ? c : { ...c, snapshot };
    });
    if (next.some((c, i) => c !== crew[i]))
      update((d) => ({ ...d, crew: d.crew.map((c, i) => (crew[i] === c ? next[i] : c)) }), { coalesce: 'crew-sync' });
  });
  useEffect(() => sync(), [passengers, pilot, passengersLoaded]);
}

export function ManifestSection() {
  const { doc, update, aircraft, passengers, pilot, reloadLists } = useEditor();
  const { wb, wbOk, wbMissingWeights, crewErrors, fuel, stops } = useFlightCalc();
  const stopsOut = stops.some((x) => x.wbOk === false);
  const stopName = (x: (typeof stops)[number]) => x.aerodrome?.icao || x.point.name;
  const [creating, setCreating] = useState<string | null>(null);
  const [editingMe, setEditingMe] = useState(false);
  const [editingPax, setEditingPax] = useState<Passenger | null>(null);
  useCrewSync();

  const seats = useMemo(() => {
    if (aircraft) return seatLayout(aircraft.massBalance.stations).map((s) => ({ id: s.id, label: s.label }));
    return FALLBACK_SEATS.map((id) => ({ id, label: FALLBACK_LABELS[id] ?? id }));
  }, [aircraft]);
  const seatLabel = (id: string) => seats.find((s) => s.id === id)?.label ?? id;
  const used = new Set(doc.crew.map((c) => c.seat));
  const full = doc.crew.length >= seats.length;
  const hasPic = doc.crew.some((c) => c.role === 'PIC');

  const onBoard = useMemo(
    () => new Set(doc.crew.map((c) => c.passengerId).filter((x): x is string => !!x)),
    [doc.crew],
  );

  const addPassenger = (p: Passenger) => {
    update((d) => {
      if (d.crew.some((c) => c.passengerId === p.id)) return d;
      const taken = new Set(d.crew.map((c) => c.seat));
      const seat = seats.find((s) => !taken.has(s.id))?.id;
      if (!seat) return d;
      return { ...d, crew: [...d.crew, { role: 'PAX', passengerId: p.id, seat, snapshot: personOf(p) }] };
    });
  };

  const setCrew = (i: number, fn: (c: FlightCrew) => FlightCrew, coalesce?: string) =>
    update((d) => ({ ...d, crew: d.crew.map((c, j) => (j === i ? fn(c) : c)) }), coalesce ? { coalesce } : undefined);
  const changeSeat = (i: number, seat: string) =>
    update((d) => {
      const other = d.crew.findIndex((c, j) => j !== i && c.seat === seat);
      const mine = d.crew[i].seat;
      // swap with whoever sits there
      return { ...d, crew: d.crew.map((c, j) => (j === i ? { ...c, seat } : j === other ? { ...c, seat: mine } : c)) };
    });
  const refresh = (i: number) => {
    const c = doc.crew[i];
    const src = c.role === 'PIC' ? pilot : passengers.find((p) => p.id === c.passengerId);
    if (src) setCrew(i, (x) => resetCrew(x, personOf(src)));
  };
  // The PIC goes back to front left; whoever sits there moves to a free seat.
  const seatIds = seats.map((s) => s.id);
  const picFits = addPicToCrew(doc.crew, seatIds, personOf(pilot)) !== null;
  const [picNote, setPicNote] = useState<string | null>(null);
  const addPic = () => {
    const r = addPicToCrew(doc.crew, seatIds, personOf(pilot));
    if (!r) return;
    update((d) => ({ ...d, crew: addPicToCrew(d.crew, seatIds, personOf(pilot))?.crew ?? d.crew }));
    setPicNote(
      r.moved
        ? `${r.moved.snapshot.fullName || 'The passenger'} moved to ${seatLabel(r.moved.seat).toLowerCase()} to free the PIC seat.`
        : null,
    );
    if (r.moved) setTimeout(() => setPicNote(null), 8000);
  };

  const stations = aircraft?.massBalance.stations ?? [];
  const bags = stations.filter((s) => s.kind === 'baggage');
  const hasUtility = !!aircraft?.massBalance.envelopes.utility;
  const total = doc.crew.reduce((s, c) => s + (c.snapshot.weightKg ?? 0), 0);
  const badge = (
    <>
      <span className="muted">{doc.crew.length} POB</span>
      {crewErrors.length > 0 && <Chip tone="danger">Check</Chip>}
      {wbOk &&
        (!(wbOk.takeoff && wbOk.landing && wbOk.loading) || stopsOut ? (
          <Chip tone="danger">W&amp;B out</Chip>
        ) : wbMissingWeights.length ? (
          <Chip tone="warn">W&amp;B incomplete</Chip>
        ) : (
          <Chip tone="ok">W&amp;B ok</Chip>
        ))}
    </>
  );

  return (
    <Section id="manifest" title="Manifest & loading" badge={badge}>
      <ul className="ep-crew" data-testid="manifest" data-focus="manifest">
        {doc.crew.map((c, i) => {
          const pax = c.role === 'PAX' ? (passengers.find((p) => p.id === c.passengerId) ?? null) : null;
          const linked = c.role === 'PIC' || !!pax;
          return (
            <li
              key={`${c.role}-${c.passengerId ?? i}`}
              className="ep-crew-row"
              data-testid={`crew-${c.role.toLowerCase()}`}
            >
              <span className={'ep-role ' + c.role.toLowerCase()}>{c.role}</span>
              <div className="ep-crew-main">
                <div className="ep-crew-name" title={c.snapshot.fullName}>
                  {c.snapshot.fullName || (
                    <span className="warn-text">{c.role === 'PIC' ? 'Your name is not set' : 'No name'}</span>
                  )}
                </div>
                <div className="ep-crew-sub">
                  <select
                    value={c.seat}
                    aria-label={`Seat of ${c.snapshot.fullName}`}
                    onChange={(e) => changeSeat(i, e.target.value)}
                    data-testid="crew-seat"
                  >
                    {!seats.some((s) => s.id === c.seat) && (
                      <option value={c.seat}>{c.seat} (not on this aircraft)</option>
                    )}
                    {seats.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                        {used.has(s.id) && s.id !== c.seat ? ' (swap)' : ''}
                      </option>
                    ))}
                  </select>
                  <NumberField
                    value={c.snapshot.weightKg}
                    min={1}
                    max={300}
                    width={84}
                    unit="kg"
                    ariaLabel={`Weight of ${c.snapshot.fullName}`}
                    testId="crew-weight"
                    className="ep-num"
                    invalid={c.snapshot.weightKg == null}
                    onChange={(v) => setCrew(i, (x) => editCrewField(x, 'weightKg', v), `w-${i}`)}
                  />
                </div>
              </div>
              <div className="ep-row-actions">
                {c.role === 'PIC' && (
                  <button
                    type="button"
                    className="icon"
                    title="Edit my details"
                    aria-label="Edit my details"
                    data-testid="pic-edit"
                    onClick={() => setEditingMe(true)}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                )}
                {pax && (
                  <button
                    type="button"
                    className="icon"
                    title={`Edit ${pax.fullName}`}
                    aria-label={`Edit ${pax.fullName}`}
                    data-testid="pax-edit"
                    onClick={() => setEditingPax(pax)}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                )}
                {linked && (
                  <button
                    type="button"
                    className="icon"
                    title={c.role === 'PIC' ? 'Reset from my profile' : 'Reset from the passenger list'}
                    aria-label="Reset from the saved details"
                    onClick={() => refresh(i)}
                  >
                    <Icon name="refresh" />
                  </button>
                )}
                {c.role === 'PAX' && (
                  <button
                    type="button"
                    className="icon"
                    title="Remove from the manifest"
                    aria-label={`Remove ${c.snapshot.fullName}`}
                    data-testid="crew-remove"
                    onClick={() => update((d) => ({ ...d, crew: d.crew.filter((_, j) => j !== i) }))}
                  >
                    <Icon name="x" />
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!hasPic && (
        <button
          type="button"
          onClick={addPic}
          disabled={!picFits}
          data-testid="add-pic"
          title={picFits ? 'Front left' : 'Every seat is taken'}
        >
          <Icon name="plus" /> Add me as PIC
        </button>
      )}
      {!hasPic && !picFits && <p className="ep-note">Every seat is taken.</p>}
      {hasPic && picNote && (
        <p className="ep-note" data-testid="pic-note">
          {picNote}
        </p>
      )}

      <PersonPicker
        people={passengers}
        exclude={onBoard}
        onPick={addPassenger}
        onCreate={(name) => setCreating(name)}
        disabled={full}
        placeholder={full ? `All ${seats.length} seats taken` : 'Add passenger…'}
        testId="pax-search"
      />
      {crewErrors.map((e) => (
        <p key={e} className="ep-note danger-text">
          {e}
        </p>
      ))}

      {aircraft && (
        <>
          {bags.length > 0 && (
            <div className="ep-bags" data-focus="baggage">
              {bags.map((s) => (
                <label key={s.id} className="field">
                  {s.name}
                  <span className="ep-weight">
                    {/* The placard limit is not the input's max: an over-limit load is kept as typed and
                        flagged by the W&B (station breach), never cut to fit. 500 kg is a typo guard. */}
                    <NumberField
                      value={doc.baggageKg[s.id] ?? null}
                      min={0}
                      max={500}
                      width={70}
                      placeholder="0"
                      testId={`bag-${s.id}`}
                      className="ep-num"
                      onChange={(v) =>
                        update(
                          (d) => {
                            const baggageKg = { ...d.baggageKg };
                            if (v == null || v === 0) delete baggageKg[s.id];
                            else baggageKg[s.id] = v;
                            return { ...d, baggageKg };
                          },
                          { coalesce: `bag-${s.id}` },
                        )
                      }
                    />
                    <span
                      className={s.maxKg != null && (doc.baggageKg[s.id] ?? 0) > s.maxKg ? 'danger-text' : 'muted'}
                      data-testid={`bag-${s.id}-limit`}
                    >
                      kg{s.maxKg ? ` (max ${s.maxKg})` : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {wb &&
            wb.limitBreaches
              .filter((b) => b.kind === 'station' || b.kind === 'combined')
              .map((b) => (
                <p key={b.text} className="ep-note danger-text" data-testid="wb-load-breach">
                  {b.text}
                </p>
              ))}
          {hasUtility && (
            <div className="ep-seg" role="radiogroup" aria-label="Category">
              {(['normal', 'utility'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={doc.options.category === k}
                  className={doc.options.category === k ? 'on' : ''}
                  onClick={() => update((d) => ({ ...d, options: { ...d.options, category: k } }))}
                >
                  {k === 'normal' ? 'Normal' : 'Utility'}
                </button>
              ))}
            </div>
          )}
          {wb && (
            <div className="ep-wb" data-testid="wb-summary">
              <div className="ep-kvs">
                <KV
                  k="People"
                  v={<span className="tnum">{total.toFixed(0)} kg</span>}
                  tone={wbMissingWeights.length ? 'warn' : undefined}
                  sub={
                    wbMissingWeights.length ? (
                      <span data-testid="wb-missing">weight missing: {wbMissingWeights.join(', ')}</span>
                    ) : undefined
                  }
                />
                <KV k="Fuel at take-off" v={<span className="tnum">{fuel ? `${fuel.fobL} L` : '–'}</span>} />
                <KV
                  k="Take-off"
                  tone={wbOk && !wbOk.takeoff ? 'danger' : undefined}
                  v={<span className="tnum">{wb.takeoff.massKg.toFixed(1)} kg</span>}
                  sub={<span className="tnum">CG {wb.takeoff.armM.toFixed(3)} m</span>}
                />
                {stops
                  .filter((x) => x.wb)
                  .map((x) => (
                    <KV
                      key={x.point.uid}
                      k={`Stop ${stopName(x)}`}
                      testId="wb-stop"
                      tone={x.wbOk === false ? 'danger' : undefined}
                      v={<span className="tnum">{x.wb!.massKg.toFixed(1)} kg</span>}
                      sub={
                        <span className="tnum">
                          CG {x.wb!.armM.toFixed(3)} m{x.fuelL != null ? ` · ${x.fuelL} L` : ''}
                        </span>
                      }
                    />
                  ))}
                <KV
                  k="Landing"
                  tone={wbOk && !wbOk.landing ? 'danger' : undefined}
                  v={<span className="tnum">{wb.landing.massKg.toFixed(1)} kg</span>}
                  sub={<span className="tnum">CG {wb.landing.armM.toFixed(3)} m</span>}
                />
                <KV
                  k="MTOW"
                  v={<span className="tnum">{aircraft.massBalance.mtowKg} kg</span>}
                  sub={
                    <span className={wb.takeoff.massKg > aircraft.massBalance.mtowKg ? 'danger-text' : 'muted'}>
                      {(aircraft.massBalance.mtowKg - wb.takeoff.massKg).toFixed(1)} kg spare
                    </span>
                  }
                />
              </div>
              <EnvelopeChart
                massBalance={aircraft.massBalance}
                category={doc.options.category}
                takeoff={wb.takeoff}
                landing={wb.landing}
                stops={stops.filter((x) => x.wb).map((x) => ({ label: stopName(x), point: x.wb! }))}
              />
            </div>
          )}
        </>
      )}
      <Link to="/passengers" className="ep-link">
        Manage passengers
      </Link>

      {editingMe && (
        <PilotDetailsDialog
          onClose={() => setEditingMe(false)}
          onSaved={(p) => {
            setEditingMe(false);
            update((d) => ({ ...d, crew: d.crew.map((c) => (c.role === 'PIC' ? applyPerson(c, personOf(p)) : c)) }));
          }}
        />
      )}
      {creating !== null && (
        <PassengerDialog
          passenger={null}
          initialName={creating}
          onClose={() => setCreating(null)}
          onSaved={async (p) => {
            setCreating(null);
            await reloadLists().catch(() => {});
            addPassenger(p);
          }}
        />
      )}
      {editingPax && (
        <PassengerDialog
          passenger={editingPax}
          onClose={() => setEditingPax(null)}
          onSaved={async (p) => {
            setEditingPax(null);
            // the snapshot takes the saved details but the fields edited on this flight (the list refetch then finds nothing to change)
            update((d) => ({
              ...d,
              crew: d.crew.map((c) => (c.passengerId === p.id ? applyPerson(c, personOf(p)) : c)),
            }));
            await reloadLists().catch(() => {});
          }}
        />
      )}
    </Section>
  );
}
