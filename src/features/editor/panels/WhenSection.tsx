// When: date, block-off (UTC, with local time), taxi out/in for this flight, and the computed
// take-off, landing and block-on times.
import { useEffect, useState } from 'react';
import { parseClock } from '../../../calc';
import { SETTING_SUGGESTIONS } from '../../../shared';
import { useEditor } from '../state';
import { fmtDur, fmtMin, localClock, localOffsetLabel, useFlightCalc } from './calc';
import { KV, NumberInput, Section } from './ui';

/** 'HHMM', 'HH:MM', 'H:MM', 'HH.MM' → 'HH:MM', or null if invalid; '' stays ''. */
export function normalizeClock(s: string): string | null {
  const t = s.trim();
  if (!t) return '';
  const m = /^(\d{1,2})[:.h]?(\d{2})$/.exec(t);
  if (!m) return null;
  const h = +m[1], mi = +m[2];
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

function TimeRow({ label, min, dayMs, testId, tone }: { label: string; min: number; dayMs: number; testId: string; tone?: 'warn' | 'danger' }) {
  const ms = isFinite(dayMs) && isFinite(min) ? dayMs + min * 60000 : NaN;
  const nextDay = isFinite(min) && min >= 1440;
  return (
    <KV
      k={label}
      tone={tone}
      testId={testId}
      v={<><span className="mono">{fmtMin(min)}Z</span>{nextDay && <sup className="muted">+1</sup>}</>}
      sub={isFinite(ms) ? <span className="mono">{localClock(ms)} LT</span> : undefined}
    />
  );
}

export function WhenSection() {
  const { doc, update } = useEditor();
  const { navlog, dayMs } = useFlightCalc();
  const [draft, setDraft] = useState(doc.blockOff);
  const [focused, setFocused] = useState(false);
  useEffect(() => { if (!focused) setDraft(doc.blockOff); }, [doc.blockOff, focused]);
  const parsed = normalizeClock(draft);

  const bo = parseClock(doc.blockOff);
  const boMs = isFinite(dayMs) && isFinite(bo) ? dayMs + bo * 60000 : NaN;
  const taxiOut = doc.taxiOutMin ?? NaN;
  const taxiIn = doc.taxiInMin ?? NaN;
  // Times: from the navlog when there is one, else block-off + taxi.
  const t = navlog?.blockOffSet ? navlog.times : isFinite(bo) ? { blockOffMin: bo, takeoffMin: bo + (isFinite(taxiOut) ? taxiOut : 0), landingMin: NaN, blockOnMin: NaN } : null;
  const sunset = navlog?.sunsetMin ?? null;
  const late = (m: number) => (sunset != null && isFinite(m) && m > sunset ? 'danger' as const : undefined);

  const badge = doc.date
    ? `${new Date(doc.date + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}${doc.blockOff ? ` · ${doc.blockOff}Z` : ''}`
    : 'No date';

  return (
    <Section id="when" title="When" badge={<span className="muted">{badge}</span>}>
      <div className="ep-grid2">
        <label className="field">Date
          <input type="date" value={doc.date} data-testid="flight-date"
            onChange={(e) => update((d) => ({ ...d, date: e.target.value }), { coalesce: 'date' })} />
        </label>
        <label className="field">Block-off (UTC)
          <input
            value={draft}
            placeholder="HH:MM"
            className={parsed === null ? 'invalid' : ''}
            data-testid="block-off"
            onFocus={() => setFocused(true)}
            onBlur={() => { setFocused(false); if (parsed !== null) setDraft(parsed); else setDraft(doc.blockOff); }}
            onChange={(e) => {
              setDraft(e.target.value);
              const v = normalizeClock(e.target.value);
              if (v !== null && v !== doc.blockOff && (v === '' || /^(\d{1,2}[:.h]\d{2}|\d{4})$/.test(e.target.value.trim()))) update((d) => ({ ...d, blockOff: v }), { coalesce: 'blockOff' });
            }}
          />
          <span className="hint">{isFinite(boMs) ? `${localClock(boMs)} local (${localOffsetLabel(boMs)})` : 'Engine start, UTC'}</span>
        </label>
        <label className="field">Taxi out (min)
          <NumberInput value={doc.taxiOutMin} min={0} max={180} testId="taxi-out" placeholder={String(SETTING_SUGGESTIONS.taxiOutMin)}
            onCommit={(v) => update((d) => ({ ...d, taxiOutMin: v }), { coalesce: 'taxiOut' })} />
          {doc.taxiOutMin == null && <span className="hint warn-text">Not set</span>}
        </label>
        <label className="field">Taxi in (min)
          <NumberInput value={doc.taxiInMin} min={0} max={180} testId="taxi-in" placeholder={String(SETTING_SUGGESTIONS.taxiInMin)}
            onCommit={(v) => update((d) => ({ ...d, taxiInMin: v }), { coalesce: 'taxiIn' })} />
          {doc.taxiInMin == null && <span className="hint warn-text">Not set</span>}
        </label>
      </div>
      {t ? (
        <div className="ep-times">
          <TimeRow label="Block-off" min={t.blockOffMin} dayMs={dayMs} testId="time-blockoff" />
          <TimeRow label="Take-off" min={t.takeoffMin} dayMs={dayMs} testId="time-takeoff" />
          <TimeRow label="Landing" min={t.landingMin} dayMs={dayMs} testId="time-landing" tone={late(t.landingMin)} />
          <TimeRow label="Block-on" min={t.blockOnMin} dayMs={dayMs} testId="time-blockon" tone={late(t.blockOnMin)} />
          {navlog && navlog.legs.length > 0 && (
            <KV k="Flight / block time" v={<span className="mono">{fmtDur(navlog.flightMin)} / {fmtDur(t.blockOnMin - t.blockOffMin)}</span>} />
          )}
          {sunset != null && <TimeRow label="Sunset at destination" min={sunset} dayMs={dayMs} testId="time-sunset" />}
        </div>
      ) : (
        <p className="muted ep-note">Set the block-off time to compute take-off, landing and block-on.</p>
      )}
    </Section>
  );
}
