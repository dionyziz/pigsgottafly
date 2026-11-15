// Aircraft: pick one from the hangar; shows the planning figures and the compass card in use.
import { Link } from 'react-router-dom';
import { pickCompassCard } from '../../../calc';
import { fuelTypesLabel, seatLayout, type Aircraft, type FlightCrew, type FlightDoc, type HangarAircraft } from '../../../shared';
import { useEditor } from '../state';
import { Chip, KV, Section } from './ui';

/**
 * The manifest moved onto another aircraft: people keep their seat when it exists there, the rest
 * take the first free seats (PIC first). People beyond the seat count keep their old seat id and
 * are flagged by validateCrew.
 */
export function reseatCrew(crew: FlightCrew[], aircraft: Aircraft | null): FlightCrew[] {
  if (!aircraft) return crew;
  const seats = seatLayout(aircraft.massBalance.stations).map((s) => s.id);
  if (!seats.length) return crew;
  const taken = new Set<string>();
  const keep = crew.map((c) => (seats.includes(c.seat) && !taken.has(c.seat) ? (taken.add(c.seat), true) : false));
  const order = crew.map((c, i) => ({ c, i })).sort((a, b) => (a.c.role === 'PIC' ? -1 : 0) - (b.c.role === 'PIC' ? -1 : 0));
  const out = [...crew];
  for (const { c, i } of order) {
    if (keep[i]) continue;
    const free = seats.find((s) => !taken.has(s));
    if (!free) continue;
    taken.add(free);
    out[i] = { ...c, seat: free };
  }
  return out;
}

export function setAircraft(d: FlightDoc, aircraft: Aircraft | null): FlightDoc {
  const crew = reseatCrew(d.crew, aircraft);
  const bagIds = new Set((aircraft?.massBalance.stations ?? []).filter((s) => s.kind === 'baggage').map((s) => s.id));
  const baggageKg = aircraft ? Object.fromEntries(Object.entries(d.baggageKg).filter(([k]) => bagIds.has(k))) : d.baggageKg;
  const compassCard = aircraft && d.options.compassCard && aircraft.compassCards.some((c) => c.name === d.options.compassCard) ? d.options.compassCard : null;
  const category = aircraft?.massBalance.envelopes.utility ? d.options.category : 'normal';
  return { ...d, aircraftId: aircraft?.id ?? null, crew, baggageKg, options: { ...d.options, compassCard, category } };
}

/** " · shared by Alice" for an aircraft another pilot shared with this one. */
function sharedBy(a: Aircraft): string {
  const access = (a as Partial<HangarAircraft>).access;
  return access && access.role !== 'owner' ? ` · shared by ${access.owner.name || access.owner.email}` : '';
}

export function AircraftSection() {
  const { doc, update, hangar, aircraft } = useEditor();
  const card = aircraft ? pickCompassCard(aircraft.compassCards, doc.options.compassCard) : null;
  const missing = doc.aircraftId && !aircraft;

  return (
    <Section id="aircraft" title="Aircraft" badge={aircraft ? <b className="mono">{aircraft.registration}</b> : <Chip tone="warn">None</Chip>}>
      {hangar.length === 0 ? (
        <p className="ep-note">Your hangar is empty. <Link to="/hangar">Add an aircraft</Link> to compute the navlog, fuel, weight &amp; balance and performance.</p>
      ) : (
        <select
          value={aircraft?.id ?? ''}
          data-testid="aircraft-select"
          data-focus="aircraft"
          aria-label="Aircraft"
          onChange={(e) => {
            const a = hangar.find((x) => x.id === e.target.value) ?? null;
            update((d) => setAircraft(d, a));
          }}
        >
          <option value="">Choose an aircraft…</option>
          {hangar.map((a) => <option key={a.id} value={a.id}>{a.registration} · {a.makeModel || a.icaoType}{sharedBy(a)}</option>)}
        </select>
      )}
      {missing && <p className="ep-note warn-text" data-testid="aircraft-unavailable">The aircraft of this flight is unavailable: it was deleted or is no longer shared with you. Choose another aircraft.</p>}
      {aircraft && (
        <>
          <div className="ep-kvs">
            <KV k="Type" v={<>{aircraft.icaoType}/{aircraft.wake}</>} sub={aircraft.colours || undefined} />
            <KV k="TAS cruise / pattern" v={<span className="mono">{aircraft.cruiseTasKt} / {aircraft.patternTasKt} kt</span>} />
            <KV k="Planning burn" v={<span className="mono">{aircraft.fuel.burnLph} L/h</span>} sub={`+${aircraft.fuel.taxiAllowanceL} L allowance`} />
            <KV k="Usable fuel" v={<span className="mono">{aircraft.fuel.usableL} L</span>} sub={fuelTypesLabel(aircraft.fuel)} />
          </div>
          {aircraft.compassCards.length > 1 ? (
            <label className="field" data-focus="compassCard">Compass card
              <select value={card?.name ?? ''} onChange={(e) => update((d) => ({ ...d, options: { ...d.options, compassCard: e.target.value || null } }))}>
                {aircraft.compassCards.map((c) => <option key={c.name} value={c.name}>{c.name} (expires {c.expires})</option>)}
              </select>
            </label>
          ) : (
            <KV k="Compass card" v={card ? card.name : <span className="muted">None</span>} sub={card ? `expires ${card.expires}` : undefined} />
          )}
          <Link to={`/hangar/${aircraft.id}`} className="ep-link">Open {aircraft.registration} in the hangar</Link>
        </>
      )}
    </Section>
  );
}
