// Performance section: the flight manual's take-off and landing tables with their corrections,
// the planning factors applied on top of them (safety, runway surface and condition, slope,
// crosswind limits) and stall speeds. Every value is an input; only the distance grids have a
// read view, and "Edit tables" turns their cells (masses, altitudes, headwinds, distances) into
// inputs with rows and columns to add and remove. Source fields are the pilot's own text.
import { useState } from 'react';
import type { DistancePair, PerformanceTables } from '../../shared/types';
import { Field, IssueList, RowRemove } from '../../ui';
import { NumInput, Section } from './fields';
import {
  addHeadwind, addLandingAltitude, addRunwayCondition, addStallSpeeds, addTakeoffAltitude, addTakeoffMassRow, issuesAt, removeHeadwind,
  removeLandingAltitude, removeTakeoffAltitude, removeTakeoffMassRow, runwayConditions, setRunwayConditions,
} from './model';
import type { SectionProps } from './sections';

/** Fraction → percent without float noise (0.07 → 7). */
const P = (f: number) => Math.round(f * 1e8) / 1e6;

function Pair({ v, editing, onChange, label }: { v: DistancePair; editing: boolean; onChange: (v: DistancePair) => void; label: string }) {
  if (!editing) return <><span className="g">{v[0]}</span><span className="t">{v[1]}</span></>;
  return (
    <span className="pair-ed">
      <NumInput value={v[0]} min={0} max={100000} width={58} ariaLabel={`${label} ground`} onChange={(x) => onChange([x ?? 0, v[1]])} />
      <NumInput value={v[1]} min={0} max={100000} width={58} ariaLabel={`${label} total`} onChange={(x) => onChange([v[0], x ?? 0])} />
    </span>
  );
}

export function PerformanceSection({ a, edit, issues }: SectionProps) {
  const [editing, setEditing] = useState(false);
  const pf = a.performance;
  const pe = (fn: (q: PerformanceTables) => void) => edit((d) => fn(d.performance));
  const t = pf.takeoff, l = pf.landing;
  const at = (p: string) => issuesAt(issues, p, true);
  const all = issuesAt(issues, 'performance');
  return (
    <Section id="performance" title="Performance"
      actions={<button type="button" className={editing ? 'primary sm' : 'sm'} onClick={() => setEditing((e) => !e)} aria-pressed={editing}>{editing ? 'Done editing' : 'Edit tables'}</button>}>
      <IssueList issues={all.filter((i) => !i.path.startsWith('performance.factors'))} />

      <div className="sub-h">Take-off</div>
      <div className="grid3">
        <Field label="Source" wide><input value={t.source} placeholder="e.g. AFM 5-8 Table 5" onChange={(e) => { const v = e.target.value; pe((q) => { q.takeoff.source = v; }); }} /></Field>
        <Field label="Flaps"><input value={t.flaps} placeholder="e.g. 0°" onChange={(e) => { const v = e.target.value; pe((q) => { q.takeoff.flaps = v; }); }} /></Field>
      </div>
      {t.rows.length === 0 && !editing ? (
        <div className="empty-inline">
          <span className="muted">No take-off table.</span>
          <button type="button" onClick={() => { setEditing(true); pe((q) => { if (!q.takeoff.altitudesFt.length) q.takeoff = addTakeoffAltitude(q.takeoff); q.takeoff = addTakeoffMassRow(q.takeoff); }); }}>Create take-off table</button>
        </div>
      ) : (
        <div className="tbl-wrap" data-path="performance.takeoff">
          <table className="perf">
            <thead>
              <tr>
                <th rowSpan={2}>Mass</th><th rowSpan={2}>Head&shy;wind</th>
                {t.altitudesFt.map((alt, i) => (
                  <th key={i} className="alt">
                    {editing ? (
                      <span className="alt-ed">
                        <NumInput value={alt} integer min={-2000} max={20000} width={70} unit="ft" ariaLabel={`Pressure altitude column ${i + 1}`} onChange={(v) => pe((q) => { q.takeoff.altitudesFt[i] = v ?? 0; })} />
                        <RowRemove label={`Remove ${alt} ft column`} onClick={() => pe((q) => { q.takeoff = removeTakeoffAltitude(q.takeoff, i); })} />
                      </span>
                    ) : <>{alt === 0 ? 'SL' : `${alt} ft`}</>}
                  </th>
                ))}
                {editing && <th rowSpan={2}><button type="button" className="ghost sm" onClick={() => pe((q) => { q.takeoff = addTakeoffAltitude(q.takeoff); })}>+ Altitude</button></th>}
              </tr>
              <tr>
                {t.altitudesFt.map((_, i) => (
                  <th key={i} className="sub">
                    {editing
                      ? <NumInput value={t.standardTempC[i] ?? null} min={-60} max={60} width={70} unit="°C" ariaLabel={`Standard temperature column ${i + 1}`} onChange={(v) => pe((q) => { q.takeoff.standardTempC[i] = v ?? 0; })} />
                      : <>{t.standardTempC[i]} °C · <span className="g">gnd</span> <span className="t">50 ft</span></>}
                  </th>
                ))}
              </tr>
            </thead>
            {t.rows.map((r, ri) => (
              <tbody key={ri} className="mass-group">
                {r.headwindKt.map((hw, hi) => (
                  <tr key={hi}>
                    {hi === 0 && (
                      <th rowSpan={r.headwindKt.length + (editing ? 1 : 0)} className="mass">
                        {editing ? (
                          <div className="stack-sm">
                            <NumInput value={r.massKg} min={0} max={1e6} width={86} unit="kg" ariaLabel="Mass" onChange={(v) => pe((q) => { q.takeoff.rows[ri].massKg = v ?? 0; })} />
                            <input value={r.liftoffIas} placeholder="Lift-off IAS" aria-label="Lift-off IAS" onChange={(e) => { const v = e.target.value; pe((q) => { q.takeoff.rows[ri].liftoffIas = v; }); }} style={{ width: 120 }} />
                            <button type="button" className="ghost sm danger" onClick={() => pe((q) => { q.takeoff = removeTakeoffMassRow(q.takeoff, ri); })}>Remove mass</button>
                          </div>
                        ) : <><b>{r.massKg} kg</b>{r.liftoffIas && <div className="hint">lift-off {r.liftoffIas}</div>}</>}
                      </th>
                    )}
                    <td className="hw">
                      {editing ? (
                        <span className="alt-ed">
                          <NumInput value={hw} min={0} max={100} width={64} unit="kt" ariaLabel="Headwind" onChange={(v) => pe((q) => { q.takeoff.rows[ri].headwindKt[hi] = v ?? 0; })} />
                          <RowRemove label="Remove headwind row" disabled={r.headwindKt.length <= 1} onClick={() => pe((q) => { q.takeoff = removeHeadwind(q.takeoff, ri, hi); })} />
                        </span>
                      ) : `${hw} kt`}
                    </td>
                    {t.altitudesFt.map((alt, ai) => (
                      <td key={ai} className="pair">
                        <Pair v={r.distances[hi]?.[ai] ?? [0, 0]} editing={editing} label={`${r.massKg} kg ${hw} kt ${alt} ft`}
                          onChange={(v) => pe((q) => { const row = q.takeoff.rows[ri]; while (row.distances[hi].length <= ai) row.distances[hi].push([0, 0]); row.distances[hi][ai] = v; })} />
                      </td>
                    ))}
                    {editing && <td />}
                  </tr>
                ))}
                {editing && (
                  <tr><td colSpan={t.altitudesFt.length + 2}><button type="button" className="ghost sm" onClick={() => pe((q) => { q.takeoff = addHeadwind(q.takeoff, ri); })}>+ Headwind</button></td></tr>
                )}
              </tbody>
            ))}
          </table>
          {editing && <button type="button" className="ghost sm" onClick={() => pe((q) => { q.takeoff = addTakeoffMassRow(q.takeoff); })}>+ Mass</button>}
        </div>
      )}
      <div className="grid3">
        <Field label="Temperature correction" hint="Increase per 15 °C above standard">
          <NumInput value={P(t.tempIncreasePer15C)} min={0} max={100} unit="%" onChange={(v) => pe((q) => { q.takeoff.tempIncreasePer15C = (v ?? 0) / 100; })} />
        </Field>
        <Field label="Dry grass" hint="Fraction of the total distance">
          <NumInput value={P(t.grassAddFractionOfTotal)} min={0} max={100} unit="%" onChange={(v) => pe((q) => { q.takeoff.grassAddFractionOfTotal = (v ?? 0) / 100; })} />
        </Field>
      </div>
      <Notes notes={t.notes} onChange={(n) => pe((q) => { q.takeoff.notes = n; })} />

      <div className="sub-h">Landing</div>
      <div className="grid3">
        <Field label="Source"><input value={l.source} placeholder="e.g. AFM 5-9 Table 6" onChange={(e) => { const v = e.target.value; pe((q) => { q.landing.source = v; }); }} /></Field>
        <Field label="Flaps"><input value={l.flaps} placeholder="e.g. 40°" onChange={(e) => { const v = e.target.value; pe((q) => { q.landing.flaps = v; }); }} /></Field>
        <Field label="Approach IAS"><input value={l.approachIas} placeholder="e.g. 60 kt" onChange={(e) => { const v = e.target.value; pe((q) => { q.landing.approachIas = v; }); }} /></Field>
      </div>
      {l.distances.length === 0 && !editing ? (
        <div className="empty-inline">
          <span className="muted">No landing table.</span>
          <button type="button" onClick={() => { setEditing(true); pe((q) => { q.landing = addLandingAltitude(q.landing); }); }}>Create landing table</button>
        </div>
      ) : (
        <div className="tbl-wrap" data-path="performance.landing">
          <table className="perf">
            <thead><tr>
              <th>Mass</th>
              {l.altitudesFt.map((alt, i) => (
                <th key={i} className="alt">
                  {editing ? (
                    <span className="alt-ed">
                      <NumInput value={alt} integer min={-2000} max={20000} width={70} unit="ft" ariaLabel={`Landing pressure altitude ${i + 1}`} onChange={(v) => pe((q) => { q.landing.altitudesFt[i] = v ?? 0; })} />
                      <RowRemove label={`Remove ${alt} ft column`} onClick={() => pe((q) => { q.landing = removeLandingAltitude(q.landing, i); })} />
                    </span>
                  ) : <>{alt === 0 ? 'SL' : `${alt} ft`}</>}
                </th>
              ))}
              {editing && <th><button type="button" className="ghost sm" onClick={() => pe((q) => { q.landing = addLandingAltitude(q.landing); })}>+ Altitude</button></th>}
            </tr>
            <tr>
              <th className="sub" />
              {l.altitudesFt.map((_, i) => (
                <th key={i} className="sub">
                  {editing
                    ? <NumInput value={l.standardTempC[i] ?? null} min={-60} max={60} width={70} unit="°C" ariaLabel={`Landing standard temperature ${i + 1}`} onChange={(v) => pe((q) => { q.landing.standardTempC[i] = v ?? 0; })} />
                    : <>{l.standardTempC[i]} °C · <span className="g">gnd</span> <span className="t">50 ft</span></>}
                </th>
              ))}
            </tr></thead>
            <tbody><tr>
              <th className="mass">{editing ? <NumInput value={l.massKg} min={0} max={1e6} width={86} unit="kg" ariaLabel="Landing mass" onChange={(v) => pe((q) => { q.landing.massKg = v ?? 0; })} /> : <b>{l.massKg} kg</b>}</th>
              {l.altitudesFt.map((alt, i) => (
                <td key={i} className="pair"><Pair v={l.distances[i] ?? [0, 0]} editing={editing} label={`Landing ${alt} ft`} onChange={(v) => pe((q) => { q.landing.distances[i] = v; })} /></td>
              ))}
            </tr></tbody>
          </table>
        </div>
      )}
      <div className="grid3">
        <Field label="Headwind correction" hint="Decrease per 5 kt headwind">
          <NumInput value={P(l.headwindDecreasePer5Kt)} min={0} max={100} unit="%" onChange={(v) => pe((q) => { q.landing.headwindDecreasePer5Kt = (v ?? 0) / 100; })} />
        </Field>
        <Field label="Temperature correction" hint="Increase per 15 °C above standard">
          <NumInput value={P(l.tempIncreasePer15C)} min={0} max={100} unit="%" onChange={(v) => pe((q) => { q.landing.tempIncreasePer15C = (v ?? 0) / 100; })} />
        </Field>
        <Field label="Dry grass" hint="Fraction of the total distance">
          <NumInput value={P(l.grassAddFractionOfTotal)} min={0} max={100} unit="%" onChange={(v) => pe((q) => { q.landing.grassAddFractionOfTotal = (v ?? 0) / 100; })} />
        </Field>
      </div>
      <Notes notes={l.notes} onChange={(n) => pe((q) => { q.landing.notes = n; })} />

      <Factors a={a} edit={edit} issues={issues} at={at} />
      <Stall a={a} edit={edit} issues={issues} />
    </Section>
  );
}

function Notes({ notes, onChange, label = 'Notes' }: { notes: string[]; onChange: (n: string[]) => void; label?: string }) {
  return (
    <Field label={label}>
      <textarea rows={Math.max(2, notes.length + 1)} value={notes.join('\n')} onChange={(e) => onChange(e.target.value.split('\n'))} onBlur={(e) => onChange(e.target.value.split('\n').map((x) => x.trim()).filter(Boolean))} />
    </Field>
  );
}

function Factors({ a, edit, at }: SectionProps & { at: (p: string) => ReturnType<typeof issuesAt> }) {
  const f = a.performance.factors;
  const fe = (fn: (q: PerformanceTables['factors']) => void) => edit((d) => fn(d.performance.factors));
  const conds = runwayConditions(f);
  const setConds = (entries: [string, number][]) => fe((q) => setRunwayConditions(q, entries));
  return (
    <>
      <div className="sub-h">Planning factors</div>
      <div className="grid3">
        <Field label="Safety factor, take-off" issues={at('performance.factors.safetyFactorTakeoff')}>
          <NumInput name="performance.factors.safetyFactorTakeoff" value={f.safetyFactorTakeoff} min={0} max={5} unit="×" onChange={(v) => fe((q) => { q.safetyFactorTakeoff = v ?? 0; })} />
        </Field>
        <Field label="Safety factor, landing" issues={at('performance.factors.safetyFactorLanding')}>
          <NumInput name="performance.factors.safetyFactorLanding" value={f.safetyFactorLanding} min={0} max={5} unit="×" onChange={(v) => fe((q) => { q.safetyFactorLanding = v ?? 0; })} />
        </Field>
        <Field label="Slope factor" issues={at('performance.factors.slopeFactorPer2Pct')} hint="Per 2% adverse slope">
          <NumInput name="performance.factors.slopeFactorPer2Pct" value={f.slopeFactorPer2Pct} min={0} max={5} unit="×" onChange={(v) => fe((q) => { q.slopeFactorPer2Pct = v ?? 0; })} />
        </Field>
      </div>
      <div className="grid3">
        <Field label="Max crosswind, take-off" issues={at('performance.factors.maxCrosswindKt')}>
          <NumInput name="performance.factors.maxCrosswindKt" value={f.maxCrosswindKt.takeoff} min={0} max={100} unit="kt" onChange={(v) => fe((q) => { q.maxCrosswindKt.takeoff = v ?? 0; })} />
        </Field>
        <Field label="Max crosswind, landing">
          <NumInput value={f.maxCrosswindKt.landing} min={0} max={100} unit="kt" onChange={(v) => fe((q) => { q.maxCrosswindKt.landing = v ?? 0; })} />
        </Field>
        <Field label="Source">
          <input value={f.source} placeholder="optional" onChange={(e) => { const v = e.target.value; fe((q) => { q.source = v; }); }} />
        </Field>
      </div>
      <div className="lbl">Runway surface and condition factors <span className="muted">· paved and dry × 1</span></div>
      {conds.length > 0 && (
        <table className="ed-table conds" data-path="performance.factors.runwayCondition">
          <thead><tr><th>Surface or condition</th><th className="num">Factor</th><th /></tr></thead>
          <tbody>
            {conds.map(([k, v], i) => (
              <tr key={i}>
                <td><input name={i === 0 ? 'performance.factors.runwayCondition' : undefined} value={k} aria-label="Condition" onChange={(e) => { const nk = e.target.value; setConds(conds.map((c, j) => (j === i ? [nk, c[1]] : c))); }} /></td>
                <td className="num"><NumInput value={v} min={0} max={5} width={90} unit="×" ariaLabel={`Factor for ${k}`} onChange={(x) => setConds(conds.map((c, j) => (j === i ? [c[0], x ?? 0] : c)))} /></td>
                <td className="row-tools"><RowRemove label={`Remove ${k || 'condition'}`} onClick={() => setConds(conds.filter((_, j) => j !== i))} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div><button type="button" className="ghost sm" onClick={() => fe((q) => { addRunwayCondition(q); })}>+ Condition</button></div>
      <IssueList issues={at('performance.factors.runwayCondition')} />
      <Notes notes={f.notes} onChange={(n) => fe((q) => { q.notes = n; })} />
    </>
  );
}

const BANKS = [0, 20, 40, 60];
const FLAPS: { k: 'flapsUp' | 'flaps10' | 'flaps40'; label: string }[] = [
  { k: 'flapsUp', label: 'Flaps up' },
  { k: 'flaps10', label: 'Flaps partial' },
  { k: 'flaps40', label: 'Flaps full' },
];

function Stall({ a, edit }: SectionProps) {
  const s = a.performance.stallIasKt;
  return (
    <>
      <div className="sub-h row">
        <span>Stall speeds <span className="muted">· IAS kt, power off, at MTOW, by angle of bank</span></span>
        <span className="spacer" />
        {s
          ? <button type="button" className="ghost sm danger" onClick={() => edit((d) => { d.performance.stallIasKt = null; })}>Remove</button>
          : <button type="button" className="ghost sm" onClick={() => edit((d) => addStallSpeeds(d.performance))}>Add stall speeds</button>}
      </div>
      {s && (
        <div className="tbl-wrap">
          <table className="perf compact">
            <thead><tr><th>Bank</th>{BANKS.map((b) => <th key={b}>{b}°</th>)}</tr></thead>
            <tbody>
              {FLAPS.map(({ k, label }) => (
                <tr key={k}>
                  <th>{label}</th>
                  {BANKS.map((b, i) => (
                    <td key={b}>
                      <NumInput value={s[k][i] ?? null} min={0} max={500} width={64} ariaLabel={`${label} ${b}° bank`} onChange={(v) => edit((d) => { d.performance.stallIasKt![k][i] = v ?? 0; })} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
