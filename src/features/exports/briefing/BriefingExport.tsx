// The NOTAMs relevant to the flight (decoded, with the ICAO text); the ones filtered out are only counted.
import '../form731/forms.css';
import '../wb/xp.css';
import './briefing.css';

import { useEffect, useState } from 'react';

import { ApiRequestError } from '../../../data/api';
import { fetchNotams, lastNotams, type NotamBriefing } from '../../../data/notams';
import type { Flight } from '../../../shared';
import { Chip, Panel } from '../../../ui';
import { ExportWarnings } from '../WarningList';
import { type BriefingModel, briefingModel } from './model';

export function BriefingExport({ flight }: { flight: Flight }) {
  const [briefing, setBriefing] = useState<NotamBriefing | null>(() => lastNotams(flight.id) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(() => !lastNotams(flight.id));
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true;
    // the last briefing stays shown while the new one loads
    if (refresh > 0 || !lastNotams(flight.id)) setBusy(true);
    fetchNotams(flight.id, { refresh: refresh > 0 }).then(
      (b) => {
        if (live) {
          setBriefing(b);
          setError(null);
          setBusy(false);
        }
      },
      (e) => {
        if (live) {
          setError(
            e instanceof ApiRequestError && e.offline
              ? 'Offline: the NOTAMs could not be loaded.'
              : `The NOTAMs could not be loaded (${(e as Error).message}).`,
          );
          setBusy(false);
        }
      },
    );
    return () => {
      live = false;
    };
  }, [flight.id, refresh]);

  const m = briefingModel({ doc: flight, title: flight.summary.title || flight.title, briefing });
  return (
    <div
      className="xp-doc print-sheet-page"
      data-testid="briefing-export"
      data-ready={busy ? 'false' : 'true'}
      data-status={m.status}
    >
      <Panel
        title="NOTAMs"
        className="xp-status"
        status={
          <Chip tone={busy ? undefined : m.status === 'ok' ? (m.relevant.length ? 'warn' : 'ok') : 'warn'}>
            {busy
              ? 'Loading…'
              : m.status === 'ok'
                ? `${m.relevant.length} relevant, ${m.hiddenCount} hidden`
                : 'Not loaded'}
          </Chip>
        }
        actions={
          <button className="ghost" onClick={() => setRefresh((x) => x + 1)} disabled={busy}>
            Reload NOTAMs
          </button>
        }
      >
        <ExportWarnings warnings={error ? [error] : []} classify={false} testId="briefing-warnings" />
      </Panel>
      <div className="xp-stage">
        <BriefingSheet m={m} />
      </div>
    </div>
  );
}

export function BriefingSheet({ m }: { m: BriefingModel }) {
  return (
    <section className="xp-sheet brief-sheet" aria-label="NOTAM briefing">
      <header className="xp-head">
        <h1>NOTAM briefing</h1>
        <span className="brief-count">
          {m.status === 'ok' ? `${m.relevant.length} relevant · ${m.hiddenCount} filtered out` : ''}
        </span>
      </header>
      <dl className="xp-fields">
        <div>
          <dt>Date</dt>
          <dd className="xp-fill">{m.date}</dd>
        </div>
        <div className="wide">
          <dt>Flight</dt>
          <dd className="xp-fill">{m.title}</dd>
        </div>
        <div className="full">
          <dt>Route</dt>
          <dd className="xp-fill">{m.route || '—'}</dd>
        </div>
        <div className="full">
          <dt>Time window</dt>
          <dd className="xp-fill">{m.window || '—'}</dd>
        </div>
        <div className="full">
          <dt>Filter</dt>
          <dd className="xp-fill">{m.filter || '—'}</dd>
        </div>
        <div className="full">
          <dt>Locations queried</dt>
          <dd className="xp-fill brief-wrap">{m.locations || '—'}</dd>
        </div>
        {m.source && (
          <div className="full">
            <dt>Source</dt>
            <dd className="xp-fill">{m.source}</dd>
          </div>
        )}
      </dl>

      {m.status !== 'ok' && (
        <p className="brief-msg" data-testid="briefing-message">
          {m.status === 'loading' ? 'Loading…' : m.message}
        </p>
      )}
      {m.status === 'ok' && m.message && <p className="brief-msg">{m.message}</p>}

      {m.status === 'ok' && (
        <>
          <h2 className="brief-h">Relevant to the flight</h2>
          {m.relevant.length === 0 && <p className="xp-small">None.</p>}
          {m.relevant.map((r) => (
            <article key={r.key} className="brief-notam" data-testid="briefing-notam">
              <header>
                <b className="brief-key">{r.key}</b>
                <span>{r.where}</span>
                <span className="brief-subject">{r.subject}</span>
                <span className="spacer" />
                {r.leg && <span className="brief-leg">{r.leg}</span>}
              </header>
              <div className="brief-meta">
                <span>{r.validity}</span>
                <span>{r.limits}</span>
                {r.schedule && <span>{r.schedule}</span>}
                {r.reasons && <span>{r.reasons}</span>}
              </div>
              <pre className="brief-raw">{r.raw}</pre>
            </article>
          ))}
        </>
      )}
    </section>
  );
}
