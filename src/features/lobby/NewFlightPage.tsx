// /flights/new: creates a flight and opens it in the editor. The server fills in the profile
// defaults (home → home route, default aircraft, taxi times, wind model, PIC on the manifest). When
// the profile has no home aerodrome (or ?ask=1), the pilot is asked for the origin (and, optionally,
// the destination) first; nothing is assumed. Either way the editor's Route
// section shows both ends as fields. Route points come from aerodromePoint (src/shared/aerodrome).
import './lists.css';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { usePilot } from '../../app/session';
import { Shell } from '../../app/Shell';
import { api } from '../../data/api';
import { resolveAerodrome } from '../../data/ref';
import { aerodromeName, aerodromePoint, type FlightCreateRequest } from '../../shared';
import { errorMessage } from '../../shared/format';
import { AerodromeTextInput, EmptyState, Field, Loading } from '../../ui';

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
      (f) => void navigate(`/flights/${f.id}`, { replace: true }),
      (e) => {
        started.current = false;
        setError(errorMessage(e));
      },
    );
  };

  const createNow = useEffectEvent(create);
  useEffect(() => {
    if (!ask) createNow({});
  }, [ask]);

  if (!ask) {
    return error ? (
      <Shell>
        <EmptyState
          title="Could not create the flight"
          action={
            <div className="row">
              <Link to="/" className="btn">
                Back to flights
              </Link>
              <button className="primary" onClick={() => create({})}>
                Try again
              </button>
            </div>
          }
        >
          {error}
        </EmptyState>
      </Shell>
    ) : (
      <Loading variant="screen" label="Creating flight…" />
    );
  }

  // An unknown aerodrome says so under its field ("Not an aerodrome in the current AIP"); an
  // empty destination means back to the origin.
  const ad = resolveAerodrome(from);
  const dest = to.trim() ? resolveAerodrome(to) : ad;
  const ok = !!ad && !!dest;
  return (
    <Shell>
      <div className="page-head">
        <h1>New flight</h1>
      </div>
      <form
        className="card form-section"
        style={{ maxWidth: 520 }}
        data-testid="new-flight-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (ad && dest) create({ route: [aerodromePoint(ad), aerodromePoint(dest)] });
        }}
      >
        <div className="grid2">
          <Field label="Origin" req>
            <AerodromeTextInput name="from" value={from} onChange={(t) => setFrom(t)} autoFocus required />
          </Field>
          <Field label="Destination">
            <AerodromeTextInput
              name="to"
              value={to}
              onChange={(t) => setTo(t)}
              placeholder={ad ? `${aerodromeName(ad)} (back to the origin)` : 'ICAO or name'}
            />
          </Field>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="button" className="ghost" onClick={() => create({ route: [] })}>
            Start with an empty map
          </button>
          <span className="spacer" />
          <Link to="/" className="btn ghost">
            Cancel
          </Link>
          <button className="primary" type="submit" disabled={!ok} data-testid="create-flight">
            Create flight
          </button>
        </div>
      </form>
    </Shell>
  );
}
