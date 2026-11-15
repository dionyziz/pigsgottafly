// Manifest and loading: PIC (me, from the profile) and PAX from the passenger list (type-ahead,
// or created on the spot), each in a seat of the aircraft; body weights for this flight; baggage per
// baggage area; W&B category; take-off/landing mass and CG against the envelope.
import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FALLBACK_SEATS, seatLayout, type FlightCrew, type Passenger, type PersonDetails, type Pilot } from '../../../shared';
import { PassengerDialog, PilotDetailsDialog } from '../../passengers/PassengerDialog';
import { useEditor } from '../state';
import { useFlightCalc } from './calc';
import { EnvelopeChart } from './EnvelopeChart';
import { addPicToCrew } from './manifest';
import { Chip, Icon, KV, NumberInput, Section } from './ui';

export function personOf(p: Pilot | Passenger): PersonDetails {
  return {
    fullName: p.fullName, phone: p.phone, dateOfBirth: p.dateOfBirth, weightKg: p.weightKg,
    idNumber: p.idNumber, idType: p.idType, nationality: p.nationality, relation: p.relation,
  };
}

const FALLBACK_LABELS: Record<string, string> = { 'front-left': 'Front left', 'front-right': 'Front right', 'rear-left': 'Rear left', 'rear-right': 'Rear right' };

export function ManifestSection() {
  const { doc, update, aircraft, passengers, pilot, reloadLists } = useEditor();
  const { wb, wbOk, wbMissingWeights, crewErrors, fuel, stops } = useFlightCalc();
  const stopsOut = stops.some((x) => x.wbOk === false);
  const stopName = (x: (typeof stops)[number]) => x.aerodrome?.icao || x.point.name;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const [creating, setCreating] = useState<string | null>(null);
  const [editingMe, setEditingMe] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const seats = useMemo(() => {
    if (aircraft) return seatLayout(aircraft.massBalance.stations).map((s) => ({ id: s.id, label: s.label }));
    return FALLBACK_SEATS.map((id) => ({ id, label: FALLBACK_LABELS[id] ?? id }));
  }, [aircraft]);
  const seatLabel = (id: string) => seats.find((s) => s.id === id)?.label ?? id;
  const used = new Set(doc.crew.map((c) => c.seat));
  const freeSeat = seats.find((s) => !used.has(s.id))?.id ?? null;
  const full = doc.crew.length >= seats.length;
  const hasPic = doc.crew.some((c) => c.role === 'PIC');

  const onBoard = new Set(doc.crew.map((c) => c.passengerId).filter(Boolean));
  const q = query.trim().toLowerCase();
  const matches = passengers
    .filter((p) => !onBoard.has(p.id))
    .filter((p) => !q || p.fullName.toLowerCase().includes(q))
    .slice(0, 8);
  const options: ({ kind: 'pax'; p: Passenger } | { kind: 'new'; name: string })[] = [
    ...matches.map((p) => ({ kind: 'pax' as const, p })),
    ...(q ? [{ kind: 'new' as const, name: query.trim() }] : []),
  ];

  const addPassenger = (p: Passenger) => {
    update((d) => {
      if (d.crew.some((c) => c.passengerId === p.id)) return d;
      const taken = new Set(d.crew.map((c) => c.seat));
      const seat = seats.find((s) => !taken.has(s.id))?.id;
      if (!seat) return d;
      return { ...d, crew: [...d.crew, { role: 'PAX', passengerId: p.id, seat, snapshot: personOf(p) }] };
    });
    setQuery('');
    setOpen(false);
    setHi(0);
  };
  const choose = (i: number) => {
    const o = options[i];
    if (!o) return;
    if (o.kind === 'pax') addPassenger(o.p);
    else { setCreating(o.name); setOpen(false); }
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
    if (src) setCrew(i, (x) => ({ ...x, snapshot: personOf(src) }));
  };
  // The PIC goes back to front left; whoever sits there moves to a free seat.
  const seatIds = seats.map((s) => s.id);
  const picFits = addPicToCrew(doc.crew, seatIds, personOf(pilot)) !== null;
  const [picNote, setPicNote] = useState<string | null>(null);
  const addPic = () => {
    const r = addPicToCrew(doc.crew, seatIds, personOf(pilot));
    if (!r) return;
    update((d) => ({ ...d, crew: addPicToCrew(d.crew, seatIds, personOf(pilot))?.crew ?? d.crew }));
    setPicNote(r.moved ? `${r.moved.snapshot.fullName || 'The passenger'} moved to ${seatLabel(r.moved.seat).toLowerCase()} to free the PIC seat.` : null);
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
      {wbOk && (!(wbOk.takeoff && wbOk.landing && wbOk.loading) || stopsOut ? <Chip tone="danger">W&amp;B out</Chip>
        : wbMissingWeights.length ? <Chip tone="warn">W&amp;B incomplete</Chip>
        : <Chip tone="ok">W&amp;B ok</Chip>)}
    </>
  );

  return (
    <Section id="manifest" title="Manifest & loading" badge={badge}>
      <ul className="ep-crew" data-testid="manifest" data-focus="manifest">
        {doc.crew.map((c, i) => {
          const linked = c.role === 'PIC' || passengers.some((p) => p.id === c.passengerId);
          return (
            <li key={`${c.role}-${c.passengerId ?? i}`} className="ep-crew-row" data-testid={`crew-${c.role.toLowerCase()}`}>
              <span className={'ep-role ' + c.role.toLowerCase()}>{c.role}</span>
              <div className="ep-crew-main">
                <div className="ep-crew-name" title={c.snapshot.fullName}>
                  {c.snapshot.fullName || <span className="warn-text">{c.role === 'PIC' ? 'Your name is not set' : 'No name'}</span>}
                </div>
                <div className="ep-crew-sub">
                  <select value={c.seat} aria-label={`Seat of ${c.snapshot.fullName}`} onChange={(e) => changeSeat(i, e.target.value)} data-testid="crew-seat">
                    {!seats.some((s) => s.id === c.seat) && <option value={c.seat}>{c.seat} (not on this aircraft)</option>}
                    {seats.map((s) => <option key={s.id} value={s.id}>{s.label}{used.has(s.id) && s.id !== c.seat ? ' (swap)' : ''}</option>)}
                  </select>
                  <span className="ep-weight">
                    <NumberInput value={c.snapshot.weightKg} min={1} max={300} width={58} ariaLabel={`Weight of ${c.snapshot.fullName}`} placeholder="kg"
                      testId="crew-weight"
                      onCommit={(v) => setCrew(i, (x) => ({ ...x, snapshot: { ...x.snapshot, weightKg: v } }), `w-${i}`)} />
                    <span className="muted">kg</span>
                  </span>
                </div>
              </div>
              <div className="ep-row-actions">
                {c.role === 'PIC' && <button type="button" className="icon" title="Edit my details" aria-label="Edit my details" data-testid="pic-edit" onClick={() => setEditingMe(true)}><Icon name="edit" size={14} /></button>}
                {linked && <button type="button" className="icon" title={c.role === 'PIC' ? 'Refresh from my profile' : 'Refresh from the passenger list'} onClick={() => refresh(i)}><Icon name="refresh" /></button>}
                {c.role === 'PAX' && (
                  <button type="button" className="icon" title="Remove from the manifest" aria-label={`Remove ${c.snapshot.fullName}`} data-testid="crew-remove"
                    onClick={() => update((d) => ({ ...d, crew: d.crew.filter((_, j) => j !== i) }))}><Icon name="x" /></button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {!hasPic && (
        <button type="button" onClick={addPic} disabled={!picFits} data-testid="add-pic"
          title={picFits ? 'Seats you in front left' : 'Every seat is taken: remove a passenger first'}>
          <Icon name="plus" /> Add me as PIC
        </button>
      )}
      {!hasPic && !picFits && <p className="ep-note">Every seat is taken: remove a passenger to make room for the PIC.</p>}
      {hasPic && picNote && <p className="ep-note" data-testid="pic-note">{picNote}</p>}

      <div className="ep-typeahead">
        <input
          ref={inputRef}
          value={query}
          disabled={full}
          placeholder={full ? `All ${seats.length} seats taken` : 'Add passenger…'}
          data-testid="pax-search"
          role="combobox"
          aria-expanded={open && options.length > 0}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, options.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            else if (e.key === 'Enter') { e.preventDefault(); choose(hi); }
            else if (e.key === 'Escape') { setOpen(false); }
          }}
        />
        {open && !full && options.length > 0 && (
          <ul className="ep-suggest" role="listbox">
            {options.map((o, i) => (
              <li key={o.kind === 'pax' ? o.p.id : 'new'} role="option" aria-selected={i === hi}
                className={i === hi ? 'hi' : ''}
                onMouseDown={(e) => { e.preventDefault(); choose(i); }}
                onMouseEnter={() => setHi(i)}>
                {o.kind === 'pax' ? (
                  <><span>{o.p.fullName}</span><span className="muted">{o.p.weightKg != null ? `${o.p.weightKg} kg` : 'no weight'}</span></>
                ) : (
                  <><span><Icon name="plus" size={14} /> Create “{o.name}”</span><span className="muted">new passenger</span></>
                )}
              </li>
            ))}
          </ul>
        )}
        {open && !full && options.length === 0 && passengers.length === 0 && (
          <div className="ep-suggest empty muted">No passengers yet: type a name to create one.</div>
        )}
      </div>
      {freeSeat === null && !full && <p className="hint">No free seat.</p>}
      {crewErrors.map((e) => <p key={e} className="ep-note danger-text">{e}</p>)}

      {aircraft && (
        <>
          {bags.length > 0 && (
            <div className="ep-bags" data-focus="baggage">
              {bags.map((s) => (
                <label key={s.id} className="field">{s.name}
                  <span className="ep-weight">
                    {/* The placard limit is not the input's max: an over-limit load is kept as typed and
                        flagged by the W&B (station breach), never cut to fit. 500 kg is a typo guard. */}
                    <NumberInput value={doc.baggageKg[s.id] ?? null} min={0} max={500} width={70} placeholder="0" testId={`bag-${s.id}`}
                      onCommit={(v) => update((d) => {
                        const baggageKg = { ...d.baggageKg };
                        if (v == null || v === 0) delete baggageKg[s.id]; else baggageKg[s.id] = v;
                        return { ...d, baggageKg };
                      }, { coalesce: `bag-${s.id}` })} />
                    <span className={s.maxKg != null && (doc.baggageKg[s.id] ?? 0) > s.maxKg ? 'danger-text' : 'muted'} data-testid={`bag-${s.id}-limit`}>
                      kg{s.maxKg ? ` (max ${s.maxKg})` : ''}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {wb && wb.limitBreaches.filter((b) => b.kind === 'station' || b.kind === 'combined').map((b) => (
            <p key={b.text} className="ep-note danger-text" data-testid="wb-load-breach">{b.text}</p>
          ))}
          {hasUtility && (
            <div className="ep-seg" role="radiogroup" aria-label="Category">
              {(['normal', 'utility'] as const).map((k) => (
                <button key={k} type="button" role="radio" aria-checked={doc.options.category === k} className={doc.options.category === k ? 'on' : ''}
                  onClick={() => update((d) => ({ ...d, options: { ...d.options, category: k } }))}>{k === 'normal' ? 'Normal' : 'Utility'}</button>
              ))}
            </div>
          )}
          {wb && (
            <div className="ep-wb" data-testid="wb-summary">
              <div className="ep-kvs">
                <KV k="People" v={<span className="tnum">{total.toFixed(0)} kg</span>}
                  tone={wbMissingWeights.length ? 'warn' : undefined}
                  sub={wbMissingWeights.length ? <span data-testid="wb-missing">weight missing: {wbMissingWeights.join(', ')}</span> : undefined} />
                <KV k="Fuel at take-off" v={<span className="tnum">{fuel ? `${fuel.fobL} L` : '–'}</span>} />
                <KV k="Take-off" tone={wbOk && !wbOk.takeoff ? 'danger' : undefined}
                  v={<span className="tnum">{wb.takeoff.massKg.toFixed(1)} kg</span>} sub={<span className="tnum">CG {wb.takeoff.armM.toFixed(3)} m</span>} />
                {stops.filter((x) => x.wb).map((x) => (
                  <KV key={x.point.uid} k={`Stop ${stopName(x)}`} testId="wb-stop" tone={x.wbOk === false ? 'danger' : undefined}
                    v={<span className="tnum">{x.wb!.massKg.toFixed(1)} kg</span>}
                    sub={<span className="tnum">CG {x.wb!.armM.toFixed(3)} m{x.fuelL != null ? ` · ${x.fuelL} L` : ''}</span>} />
                ))}
                <KV k="Landing" tone={wbOk && !wbOk.landing ? 'danger' : undefined}
                  v={<span className="tnum">{wb.landing.massKg.toFixed(1)} kg</span>} sub={<span className="tnum">CG {wb.landing.armM.toFixed(3)} m</span>} />
                <KV k="MTOW" v={<span className="tnum">{aircraft.massBalance.mtowKg} kg</span>}
                  sub={<span className={wb.takeoff.massKg > aircraft.massBalance.mtowKg ? 'danger-text' : 'muted'}>{(aircraft.massBalance.mtowKg - wb.takeoff.massKg).toFixed(1)} kg spare</span>} />
              </div>
              <EnvelopeChart massBalance={aircraft.massBalance} category={doc.options.category} takeoff={wb.takeoff} landing={wb.landing}
                stops={stops.filter((x) => x.wb).map((x) => ({ label: stopName(x), point: x.wb! }))} />
            </div>
          )}
        </>
      )}
      <Link to="/passengers" className="ep-link">Manage passengers</Link>

      {editingMe && (
        <PilotDetailsDialog onClose={() => setEditingMe(false)} onSaved={(p) => {
          setEditingMe(false);
          update((d) => ({ ...d, crew: d.crew.map((c) => (c.role === 'PIC' ? { ...c, snapshot: personOf(p) } : c)) }));
        }} />
      )}
      {creating !== null && (
        <PassengerDialog
          passenger={null}
          initialName={creating}
          onClose={() => setCreating(null)}
          onSaved={async (p) => {
            setCreating(null);
            setQuery('');
            await reloadLists().catch(() => {});
            addPassenger(p);
            inputRef.current?.focus();
          }}
        />
      )}
    </Section>
  );
}
