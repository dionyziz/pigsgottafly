// The server fills in the profile defaults (home → home route, default aircraft, taxi times, wind model,
// PIC on the manifest). A pilot's first flight asks for their home aerodrome (sign-up asks nothing), saved
// to the profile; ?ask=1 asks for the origin and destination instead, or (Local flight ticked) for the
// estimated total time of a flight back to the origin with nothing between.
import './lists.css';

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { usePilot } from '../../app/session';
import { Shell } from '../../app/Shell';
import { api } from '../../data/api';
import { resolveAerodrome } from '../../data/ref';
import { aerodromeName, aerodromePoint, DEFAULT_LOCAL_DURATION_MIN, type FlightCreateRequest } from '../../shared';
import { errorMessage } from '../../shared/format';
import { AerodromeTextInput, Check, DurationField, EmptyState, Field, Loading } from '../../ui';
import { rememberStage } from '../editor/panels/readiness';

export function NewFlightPage() {
  const navigate = useNavigate();
  const pilot = usePilot();
  const [params] = useSearchParams();
  const noHome = !pilot.homeAerodrome;
  const ask = noHome || params.get('ask') === '1';
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [localChosen, setLocalChosen] = useState(false);
  const [durationMin, setDurationMin] = useState(DEFAULT_LOCAL_DURATION_MIN);
  const [home, setHome] = useState('');

  const create = (req: FlightCreateRequest) => {
    if (started.current) return;
    started.current = true;
    setError(null);
    api.flights.create(req).then(
      (f) => {
        // a flight that has just been created has nothing to brief yet, even when it is for today
        rememberStage(f.id, 'plan');
        void navigate(`/flights/${f.id}`, { replace: true });
      },
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

  if (noHome) {
    const h = resolveAerodrome(home);
    return (
      <Shell>
        <div className="page-head">
          <h1>New flight</h1>
        </div>
        <form
          className="card form-section"
          style={{ maxWidth: 520 }}
          data-testid="home-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!h || started.current) return;
            setError(null);
            // the home route needs the home aerodrome saved before the server builds the flight
            api.me.update({ homeAerodrome: h.icao || h.id }).then(
              () => create({}),
              (err) => setError(errorMessage(err)),
            );
          }}
        >
          <Field label="Your home aerodrome" req>
            <AerodromeTextInput name="home" value={home} onChange={(t) => setHome(t)} autoFocus required />
          </Field>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <div className="row">
            <span className="spacer" />
            <Link to="/" className="btn ghost">
              Cancel
            </Link>
            <button className="primary" type="submit" disabled={!h} data-testid="create-flight">
              Create flight
            </button>
          </div>
        </form>
      </Shell>
    );
  }

  // An unknown aerodrome says so under its field ("Not an aerodrome in the current AIP").
  const ad = resolveAerodrome(from);
  const dest = localChosen ? ad : resolveAerodrome(to);
  const local = !!ad && !!dest && ad.id === dest.id;
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
          if (!ad || !dest) return;
          create({
            route: [aerodromePoint(ad), aerodromePoint(dest)],
            ...(local ? { options: { localDurationMin: durationMin } } : {}),
          });
        }}
      >
        <div className="grid2">
          <Field label="Origin" req>
            <AerodromeTextInput name="from" value={from} onChange={(t) => setFrom(t)} autoFocus required />
          </Field>
          <Field label="Destination">
            {localChosen ? (
              <input
                name="to"
                data-testid="new-flight-local-to"
                disabled
                value={ad ? ad.icao || aerodromeName(ad) : from}
              />
            ) : (
              <AerodromeTextInput name="to" value={to} onChange={(t) => setTo(t)} placeholder="ICAO or name" />
            )}
          </Field>
        </div>
        <div className="grid2">
          <div>
            <Check checked={localChosen} onChange={setLocalChosen} testId="new-flight-local">
              Local flight
            </Check>
          </div>
          {localChosen && (
            <Field label="Estimated total time">
              <DurationField value={durationMin} onChange={setDurationMin} testId="new-flight-duration" />
            </Field>
          )}
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
