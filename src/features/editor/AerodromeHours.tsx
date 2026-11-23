// An aerodrome's hours of the day (adDay.ts) in detail. Shared by the editor's "Aerodrome hours" section
// and the map's aerodrome details.
import { AipLink } from '../../app/AipLink';
import type { AdDay, AdNotamEffect } from '../../calc';
import type { RefAerodrome } from '../../shared/ref';
import { type AdDayInfo, fmtAdDay } from './adDay';

function DayText({ d, testId }: { d: AdDay; testId?: string }) {
  return (
    <span data-testid={testId}>
      {d.text}
      {d.notams.length > 0 && (
        <>
          {' '}
          <b className="pgf-ad-notam">NOTAM {d.notams.join(', ')}</b>
        </>
      )}
    </span>
  );
}

export function AdHoursDetail({ a, info, compact }: { a: RefAerodrome; info: AdDayInfo; compact?: boolean }) {
  const h = a.hours;
  if (!h || !info.ad) return <p className="muted">No operational hours published for this aerodrome.</p>;
  const partial = [h.ad, h.ats, h.handling].some((f) => f?.parsed.partial);
  return (
    <dl className="pgf-air-body pgf-ad-body" data-testid="ad-hours">
      <dt>{compact ? 'Hours' : fmtAdDay(info.day)}</dt>
      <dd>
        <DayText d={info.ad} testId="ad-hours-day" />
      </dd>
      {info.ats && (
        <>
          <dt>ATS</dt>
          <dd>
            <DayText d={info.ats} />
          </dd>
        </>
      )}
      {info.handling && (
        <>
          <dt>Handling</dt>
          <dd>
            <DayText d={info.handling} testId="ad-hours-handling" />
          </dd>
        </>
      )}
      {h.customs && (
        <>
          <dt>Customs</dt>
          <dd>{h.customs.parsed.partial ? h.customs.text : h.customs.parsed.label}</dd>
        </>
      )}
      {info.notams.map((n) => (
        <Notam key={n.key + n.target} n={n} />
      ))}
      <dt>AIP</dt>
      <dd>
        <AipLink refText={h.source}>{h.source}</AipLink>
        {partial && (
          // text the parser could not represent exactly: shown as printed
          <div className="pgf-ad-aip" data-testid="ad-hours-aip-text">
            <div>
              <b>AD</b> {h.ad.text}
            </div>
            {h.ats && (
              <div>
                <b>ATS</b> {h.ats.text}
              </div>
            )}
            <div>
              <b>Handling</b> {h.handling.text}
            </div>
            {h.customs && (
              <div>
                <b>Customs</b> {h.customs.text}
              </div>
            )}
            {h.remarks && (
              <div>
                <b>Remarks</b> {h.remarks}
              </div>
            )}
            {h.ad.parsed.notes.length > 0 && <div className="muted">{h.ad.parsed.notes.join(' · ')}</div>}
          </div>
        )}
      </dd>
    </dl>
  );
}

function Notam({ n }: { n: AdNotamEffect }) {
  return (
    <>
      <dt>NOTAM</dt>
      <dd data-testid="ad-hours-notam">
        <b className="pgf-ad-notam">{n.key}</b> {n.summary}
        {n.partial ? <span className="pgf-air-text"> · {n.text}</span> : null}
      </dd>
    </>
  );
}
