// /flights/new: creates a flight and opens it in the editor. The server fills in the profile
// defaults (home → home route, default aircraft, taxi times, wind model, PIC on the manifest). When
// the profile has no home aerodrome (or ?ask=1), the pilot is asked for the origin (and, optionally,
// the destination) first; nothing is assumed (pilot correction #1). Either way the editor's Route
// section shows both ends as fields.
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Shell } from '../../app/Shell';
import { usePilot } from '../../app/session';
import { api } from '../../data/api';
import { uid, type FlightCreateRequest, type RefAerodrome, type RoutePoint } from '../../shared';
import { AerodromePicker, resolveAerodrome } from '../profile/AerodromePicker';
import { EmptyState } from './ui';

const point = (a: RefAerodrome): RoutePoint => ({ uid: uid(), kind: 'aerodrome', refId: a.id, name: a.icao || a.id, lat: a.lat, lon: a.lon });

export function NewFlightPage() {
  const navigate = useNavigate();
  const pilot = usePilot();
  const [params] = useSearchParams();
  const ask = !pilot.homeAerodrome || params.get('ask') === '1';
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const create = (req: FlightCreateRequest) => {
    if (started.current) return;
    started.current = true;
    setError(null);
    api.flights.create(req).then(
      (f) => navigate(`/flights/${f.id}`, { replace: true }),
      (e) => { started.current = false; setError(String((e as Error).message || e)); },
    );
  };

  useEffect(() => {
    if (!ask) create({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask]);

  if (!ask) {
    return error
      ? <Shell><EmptyState title="Could not create the flight" action={<div className="row"><Link to="/" className="btn">Back to flights</Link><button className="primary" onClick={() => create({})}>Try again</button></div>}>{error}</EmptyState></Shell>
      : <div className="loading-screen">Creating flight…</div>;
  }

  const ad = resolveAerodrome(from);
  const dest = to.trim() ? resolveAerodrome(to) : ad;
  const ok = !!ad && !!dest;
  return (
    <Shell>
      <div className="page-head"><h1>New flight</h1></div>
      <form className="card form-section" style={{ maxWidth: 520 }} data-testid="new-flight-form"
        onSubmit={(e) => { e.preventDefault(); if (ad && dest) create({ route: [point(ad), point(dest)] }); }}>
        <header>
          <h2>Where does the flight go?</h2>
          <p>{pilot.homeAerodrome ? 'Draw the rest of the route on the map. Both ends can be changed later in the editor.' : <>You have no home aerodrome in your <Link to="/profile">profile</Link> yet. Draw the rest of the route on the map; both ends can be changed later in the editor.</>}</p>
        </header>
        <div className="grid2">
          <label className="field">Origin
            <AerodromePicker name="from" value={from} onChange={setFrom} autoFocus />
          </label>
          <label className="field">Destination
            <AerodromePicker name="to" value={to} onChange={setTo} placeholder={ad ? `${ad.icao || ad.id} (back to the origin)` : 'ICAO or name'} />
          </label>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="row">
          <button type="button" className="ghost" onClick={() => create({ route: [] })}>Start with an empty map</button>
          <span className="spacer" />
          <Link to="/" className="btn ghost">Cancel</Link>
          <button className="primary" type="submit" disabled={!ok}>Create flight</button>
        </div>
      </form>
    </Shell>
  );
}
