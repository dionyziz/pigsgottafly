// On a flight shared with the pilot the aircraft is its owner's choice (from the owner's hangar): shown,
// not changed here.
import { FlowLink } from '../../../app/FlowLinks';
import { pickCompassCard } from '../../../calc';
import { type Aircraft, fuelTypesLabel, type HangarAircraft } from '../../../shared';
import { todayUtc } from '../../../shared/date';
import { Chip } from '../../../ui';
import { useEditor } from '../state';
import { setAircraft } from './aircraftChoice';
import { KV, Section } from './ui';

/** " · shared by Alice" for an aircraft another pilot shared with this one. */
function sharedBy(a: Aircraft): string {
  const access = (a as Partial<HangarAircraft>).access;
  return access && access.role !== 'owner' ? ` · shared by ${access.owner.name || access.owner.email}` : '';
}

export function AircraftSection() {
  const { flight, doc, update, hangar, aircraft } = useEditor();
  const ownersChoice = !!flight.access;
  // A compass card is only worth a line when it has expired by the day of the flight.
  const expiredOn = (expires: string) => !!expires && expires < (doc.date || todayUtc());
  const card = aircraft ? pickCompassCard(aircraft.compassCards, doc.options.compassCard) : null;
  const missing = doc.aircraftId && !aircraft;

  return (
    <Section
      id="aircraft"
      title="Aircraft"
      badge={aircraft ? <b className="mono">{aircraft.registration}</b> : <Chip tone="warn">None</Chip>}
    >
      {hangar.length === 0 ? (
        <p className="ep-note" data-focus="aircraft">
          Hangar empty. <FlowLink to="/hangar">Add an aircraft</FlowLink>
        </p>
      ) : (
        <select
          value={aircraft?.id ?? ''}
          data-testid="aircraft-select"
          data-focus="aircraft"
          aria-label="Aircraft"
          disabled={ownersChoice}
          title={ownersChoice ? 'The flight’s owner chooses its aircraft' : undefined}
          onChange={(e) => {
            const a = hangar.find((x) => x.id === e.target.value) ?? null;
            update((d) => setAircraft(d, a));
          }}
        >
          <option value="">Choose an aircraft…</option>
          {hangar.map((a) => (
            <option key={a.id} value={a.id}>
              {a.registration} · {a.makeModel || a.icaoType}
              {sharedBy(a)}
            </option>
          ))}
        </select>
      )}
      {missing && (
        <p className="ep-note warn-text" data-testid="aircraft-unavailable">
          Aircraft unavailable: deleted or no longer shared.
        </p>
      )}
      {aircraft && (
        <>
          <div className="ep-kvs">
            <KV
              k="Type"
              v={
                <>
                  {aircraft.icaoType}/{aircraft.wake}
                </>
              }
              sub={aircraft.colours || undefined}
            />
            <KV
              k="TAS cruise / pattern"
              v={
                <span className="tnum">
                  {aircraft.cruiseTasKt} / {aircraft.patternTasKt} kt
                </span>
              }
            />
            <KV
              k="Planning burn"
              v={<span className="tnum">{aircraft.fuel.burnLph} L/h</span>}
              sub={`+${aircraft.fuel.taxiAllowanceL} L taxi`}
            />
            <KV
              k="Fuel capacity"
              v={<span className="tnum">{aircraft.fuel.usableL} L</span>}
              sub={fuelTypesLabel(aircraft.fuel)}
            />
          </div>
          {aircraft.compassCards.length > 1 ? (
            <label className="field" data-focus="compassCard">
              Compass card
              <select
                value={card?.name ?? ''}
                onChange={(e) =>
                  update((d) => ({ ...d, options: { ...d.options, compassCard: e.target.value || null } }))
                }
              >
                {aircraft.compassCards.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                    {expiredOn(c.expires) ? ` (expired ${c.expires})` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : card && expiredOn(card.expires) ? (
            <KV k="Compass card" tone="danger" v={card.name} sub={`expired ${card.expires}`} />
          ) : null}
          <FlowLink to={`/hangar/${aircraft.id}`} className="ep-link">
            {aircraft.registration} in the hangar
          </FlowLink>
        </>
      )}
    </Section>
  );
}
