// Briefing export: the NOTAMs relevant to the flight (decoded, with the ICAO text), then the hidden
// ones in one line each with the reason. A4 portrait sheets (named page "xp"); a long list flows on
// to further pages.
//
// Usage (ExportPage): <BriefingExport flight={flight} />. Loads the briefing itself.
import '../form731/forms.css';
import '../wb/xp.css';
import './briefing.css';

import { useEffect, useState } from 'react';

import { usePilot } from '../../../app/session';
import { ApiRequestError } from '../../../data/api';
import { fetchNotams, type NotamBriefing } from '../../../data/notams';
import type { Flight } from '../../../shared';
import { Chip, Panel } from '../../../ui';
import type { ShownSignature } from '../form731/Form731';
import { ExportWarnings } from '../WarningList';
import { SignLine } from '../wb/SignLine';
import { type BriefingModel, briefingModel } from './model';

export function BriefingExport({ flight }: { flight: Flight }) {
  const [briefing, setBriefing] = useState<NotamBriefing | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [refresh, setRefresh] = useState(0);
  // acknowledged by the PIC, e-signed when the briefing is generated
  const pilot = usePilot();
  const [signedAt] = useState(() => Date.now());
  const signature: ShownSignature | null = pilot.fullName.trim() ? { name: pilot.fullName, signedAt } : null;
  useEffect(() => {
    let live = true;
    setBusy(true);
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
                ? `${m.relevant.length} relevant, ${m.hidden.length} hidden`
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
        <BriefingSheet m={m} signature={signature} />
      </div>
    </div>
  );
}

export function BriefingSheet({ m, signature = null }: { m: BriefingModel; signature?: ShownSignature | null }) {
  return (
    <section className="xp-sheet brief-sheet" aria-label="NOTAM briefing">
      <header className="xp-head">
        <h1>NOTAM briefing</h1>
        <span className="brief-count">
          {m.status === 'ok' ? `${m.relevant.length} relevant · ${m.hidden.length} not relevant` : ''}
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

          {m.hidden.length > 0 && (
            <>
              <h2 className="brief-h">Not relevant (filtered out)</h2>
              <table className="brief-hidden">
                <tbody>
                  {m.hidden.map((r) => (
                    <tr key={r.key}>
                      <td className="brief-key">{r.key}</td>
                      <td>{r.where}</td>
                      <td>{r.subject}</td>
                      <td>{r.reasons}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
      <footer className="xp-sign brief-sign" data-testid="briefing-ack">
        <span>
          ACKNOWLEDGED BY PIC <b className="xp-fill">{signature?.name ?? ''}</b>
        </span>
        <SignLine signature={signature} />
      </footer>
    </section>
  );
}
