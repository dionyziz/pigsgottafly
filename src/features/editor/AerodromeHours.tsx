// An aerodrome's hours on the flight's date (AIP AD 2.3 / AD 1.6 overlaid with the flight's NOTAMs,
// src/calc/aerodromeStatus.ts): operating hours, ATS, handling and customs, the NOTAMs that change them
// (by NOTAM id), and the AIP text as printed. Shared by the editor's "Aerodrome hours" section and the
// map's aerodrome tooltip / details.
import { useState } from 'react';
import { aerodromeDay, type AdDay, type AdNotamEffect } from '../../calc';
import type { RefAerodrome } from '../../shared/ref';
import { SUN_TABLES } from '../../data/ref';

export interface AdDayInfo {
  day: string;
  ad: AdDay | null;
  ats: AdDay | null;
  handling: AdDay | null;
  /** NOTAMs of this aerodrome that change its hours, ATS or handling on that day. */
  notams: AdNotamEffect[];
}

const DAY_MS = 86400e3;

/** The aerodrome's hours on `day` ('' = today, UTC). */
export function adDayInfo(a: RefAerodrome, day: string, effects: readonly AdNotamEffect[]): AdDayInfo {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : new Date().toISOString().slice(0, 10);
  const start = Date.parse(d + 'T00:00:00Z');
  const opts = { effects, sunTables: SUN_TABLES };
  const notams = effects.filter((e) => e.icao === a.icao && e.from < start + DAY_MS && (e.to === null || e.to > start));
  if (!a.hours) return { day: d, ad: null, ats: null, handling: null, notams };
  return {
    day: d,
    ad: aerodromeDay(a, 'ad', d, opts),
    ats: a.hours.ats ? aerodromeDay(a, 'ats', d, opts) : null,
    handling: aerodromeDay(a, 'handling', d, opts),
    notams,
  };
}

const fmtDay = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** 'Hours Sat 15 Nov: Open 04:52–15:01Z (HJ) · NOTAM A1234/26' — one line for tooltips. */
export function adHoursLine(info: AdDayInfo): string {
  if (!info.ad) return 'Hours not published';
  return `${fmtDay(info.day)}: ${info.ad.text}${info.ad.notams.length ? ` (NOTAM ${info.ad.notams.join(', ')})` : ''}`;
}
export function adHandlingLine(info: AdDayInfo): string {
  if (!info.handling) return '';
  return `Handling: ${info.handling.text}${info.handling.notams.length ? ` (NOTAM ${info.handling.notams.join(', ')})` : ''}`;
}

function DayText({ d, testId }: { d: AdDay; testId?: string }) {
  return (
    <span data-testid={testId}>
      {d.text}
      {d.notams.length > 0 && <> <b className="pgf-ad-notam">NOTAM {d.notams.join(', ')}</b></>}
    </span>
  );
}

/** Definition list of the hours (used inside the map popover and the panel section). */
export function AdHoursDetail({ a, info, compact }: { a: RefAerodrome; info: AdDayInfo; compact?: boolean }) {
  const [aip, setAip] = useState(false);
  const h = a.hours;
  if (!h || !info.ad) return <p className="muted">No operational hours published for this aerodrome.</p>;
  const partial = [h.ad, h.ats, h.handling].some((f) => f?.parsed.partial);
  return (
    <dl className="pgf-air-body pgf-ad-body" data-testid="ad-hours">
      <dt>{compact ? 'Hours' : fmtDay(info.day)}</dt><dd><DayText d={info.ad} testId="ad-hours-day" /></dd>
      {info.ats && <><dt>ATS</dt><dd><DayText d={info.ats} /></dd></>}
      {info.handling && <><dt>Handling</dt><dd><DayText d={info.handling} testId="ad-hours-handling" /></dd></>}
      {h.customs && <><dt>Customs</dt><dd>{h.customs.parsed.partial ? h.customs.text : h.customs.parsed.label}</dd></>}
      {info.notams.map((n) => (
        <Notam key={n.key + n.target} n={n} />
      ))}
      <dt>AIP</dt>
      <dd>
        <button type="button" className="linkish" onClick={() => setAip((v) => !v)} aria-expanded={aip || partial} data-testid="ad-hours-aip">
          {aip || partial ? 'AIP text' : 'Show the AIP text'}
        </button>{' '}
        <span className="muted">{h.source}</span>
        {(aip || partial) && (
          <div className="pgf-ad-aip" data-testid="ad-hours-aip-text">
            <div><b>AD</b> {h.ad.text}</div>
            {h.ats && <div><b>ATS</b> {h.ats.text}</div>}
            <div><b>Handling</b> {h.handling.text}</div>
            {h.customs && <div><b>Customs</b> {h.customs.text}</div>}
            {h.remarks && <div><b>Remarks</b> {h.remarks}</div>}
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
      <dd data-testid="ad-hours-notam"><b className="pgf-ad-notam">{n.key}</b> {n.summary}{n.partial ? <span className="pgf-air-text"> · {n.text}</span> : null}</dd>
    </>
  );
}
