// When: date, block-off (UTC, with local time), taxi out/in for this flight, and the computed
// take-off, landing and block-on times.
import { useEffect, useState } from 'react';

import { DateInput } from '../../../app/DateInput';
import { parseClock } from '../../../calc';
import { SETTING_SUGGESTIONS } from '../../../shared';
import { localOffsetLabel } from '../../../shared/date';
import { fmtClock, fmtDuration, fmtLocalClock } from '../../../shared/format';
import { NumberField } from '../../../ui';
import { useEditor } from '../state';
import { useFlightCalc } from './calc';
import { KV, Section } from './ui';

/** 'HHMM', 'HH:MM', 'H:MM', 'HH.MM' → 'HH:MM', or null if invalid; '' stays ''. */
export function normalizeClock(s: string): string | null {
  const t = s.trim();
  if (!t) return '';
  const m = /^(\d{1,2})[:.h]?(\d{2})$/.exec(t);
  if (!m) return null;
  const h = +m[1],
    mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

function TimeRow({
  label,
  min,
  testId,
  tone,
}: {
  label: string;
  min: number;
  testId: string;
  tone?: 'warn' | 'danger';
}) {
  const nextDay = isFinite(min) && min >= 1440;
  return (
    <KV
      k={label}
      tone={tone}
      testId={testId}
      v={
        <>
          <span className="tnum">{fmtClock(min, { fallback: '--:--' })}Z</span>
          {nextDay && <sup className="muted">+1</sup>}
        </>
      }
    />
  );
}

export function WhenSection() {
  const { doc, update } = useEditor();
  const { navlog, dayMs } = useFlightCalc();
  const [draft, setDraft] = useState(doc.blockOff);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(doc.blockOff);
  }, [doc.blockOff, focused]);
  const parsed = normalizeClock(draft);

  const bo = parseClock(doc.blockOff);
  const boMs = isFinite(dayMs) && isFinite(bo) ? dayMs + bo * 60000 : NaN;
  const taxiOut = doc.taxiOutMin ?? NaN;
  // Times: from the navlog when there is one, else block-off + taxi.
  const t = navlog?.blockOffSet
    ? navlog.times
    : isFinite(bo)
      ? { blockOffMin: bo, takeoffMin: bo + (isFinite(taxiOut) ? taxiOut : 0), landingMin: NaN, blockOnMin: NaN }
      : null;
  const sunset = navlog?.sunsetMin ?? null;
  const late = (m: number) => (sunset != null && isFinite(m) && m > sunset ? ('danger' as const) : undefined);

  const badge = doc.date ? `${doc.date}${doc.blockOff ? ` · ${doc.blockOff}Z` : ''}` : 'No date';

  return (
    <Section id="when" title="When" badge={<span className="muted">{badge}</span>}>
      <div className="ep-grid2">
        <label className="field" data-focus="date">
          Date
          <DateInput
            value={doc.date}
            testId="flight-date"
            onChange={(e) => update((d) => ({ ...d, date: e.target.value }), { coalesce: 'date' })}
          />
        </label>
        <label className="field">
          Block-off (UTC)
          <input
            value={draft}
            placeholder="HH:MM"
            className={parsed === null ? 'invalid' : ''}
            data-testid="block-off"
            data-focus="blockOff"
            onFocus={() => setFocused(true)}
            onBlur={() => {
              setFocused(false);
              if (parsed !== null) setDraft(parsed);
              else setDraft(doc.blockOff);
            }}
            onChange={(e) => {
              setDraft(e.target.value);
              const v = normalizeClock(e.target.value);
              if (
                v !== null &&
                v !== doc.blockOff &&
                (v === '' || /^(\d{1,2}[:.h]\d{2}|\d{4})$/.test(e.target.value.trim()))
              )
                update((d) => ({ ...d, blockOff: v }), { coalesce: 'blockOff' });
            }}
          />
          {isFinite(boMs) && (
            <span className="hint tnum" data-testid="block-off-local">
              {fmtLocalClock(boMs)} local ({localOffsetLabel(boMs)})
            </span>
          )}
        </label>
        <label className="field" data-focus="taxiOut">
          Taxi out (min)
          <NumberField
            value={doc.taxiOutMin}
            min={0}
            max={180}
            testId="taxi-out"
            placeholder={String(SETTING_SUGGESTIONS.taxiOutMin)}
            className="ep-num"
            invalid={doc.taxiOutMin == null}
            onChange={(v) => update((d) => ({ ...d, taxiOutMin: v }), { coalesce: 'taxiOut' })}
          />
        </label>
        <label className="field" data-focus="taxiIn">
          Taxi in (min)
          <NumberField
            value={doc.taxiInMin}
            min={0}
            max={180}
            testId="taxi-in"
            placeholder={String(SETTING_SUGGESTIONS.taxiInMin)}
            className="ep-num"
            invalid={doc.taxiInMin == null}
            onChange={(v) => update((d) => ({ ...d, taxiInMin: v }), { coalesce: 'taxiIn' })}
          />
        </label>
      </div>
      {t && (
        <div className="ep-times">
          <TimeRow label="Block-off" min={t.blockOffMin} testId="time-blockoff" />
          <TimeRow label="Take-off" min={t.takeoffMin} testId="time-takeoff" />
          <TimeRow label="Landing" min={t.landingMin} testId="time-landing" tone={late(t.landingMin)} />
          <TimeRow label="Block-on" min={t.blockOnMin} testId="time-blockon" tone={late(t.blockOnMin)} />
          {navlog && navlog.legs.length > 0 && (
            <KV
              k="Flight / block time"
              v={
                <span className="tnum">
                  {fmtDuration(navlog.flightMin, { fallback: '–' })} /{' '}
                  {fmtDuration(t.blockOnMin - t.blockOffMin, { fallback: '–' })}
                </span>
              }
            />
          )}
          {sunset != null && <TimeRow label="Sunset at destination" min={sunset} testId="time-sunset" />}
        </div>
      )}
    </Section>
  );
}
