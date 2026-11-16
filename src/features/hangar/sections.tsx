// Aircraft page sections: identity, flight plan items, speeds, fuel. (Mass & balance, performance
// and compass cards are in their own files.) Each section edits the draft through `edit`. Inputs are
// named by the issue path they fix (name="fuel.usableL"), so the save bar's issues can focus them.
import { fuelDensity } from '../../shared/fuel';
import { fmtDuration } from '../../shared/format';
import type { AircraftInput, WakeCategory } from '../../shared/types';
import { AerodromeTextInput, Check, Field, IssueList, RowRemove } from '../../ui';
import { NumInput, Section } from './fields';
import { OperatorPicker } from '../operators/OperatorPicker';
import { ADS_CODES, ITEM10A_CODES, SSR_CODES, addFuelType, issuesAt, join10a, join10b, makePrimaryFuel, otherFuelTypes, removeFuelType, split10a, split10b, type Issue } from './model';

export interface SectionProps {
  a: AircraftInput;
  edit: (fn: (d: AircraftInput) => void) => void;
  issues: Issue[];
}

const WAKE: { v: WakeCategory; label: string }[] = [
  { v: 'L', label: 'L: light (≤ 7 000 kg)' },
  { v: 'M', label: 'M: medium' },
  { v: 'H', label: 'H: heavy' },
  { v: 'J', label: 'J: super' },
];

export function IdentitySection({ a, edit, issues }: SectionProps) {
  const at = (p: string) => issuesAt(issues, p, true);
  return (
    <Section id="identity" title="Identity">
      <div className="grid3">
        <Field focus="registration" label="Registration" req issues={at('registration')} hint="FPL item 7 drops the hyphen">
          <input name="registration" className="mono upper" value={a.registration} onChange={(e) => { const v = e.target.value.toUpperCase(); edit((d) => { d.registration = v; }); }} placeholder="e.g. SX-ABC" maxLength={20} />
        </Field>
        <Field label="Make and model" issues={at('makeModel')}>
          <input name="makeModel" value={a.makeModel} onChange={(e) => { const v = e.target.value; edit((d) => { d.makeModel = v; }); }} placeholder="e.g. Reims/Cessna F172M" maxLength={200} />
        </Field>
        <Field label="Serial number" issues={at('serial')}>
          <input name="serial" className="mono" value={a.serial} onChange={(e) => { const v = e.target.value; edit((d) => { d.serial = v; }); }} maxLength={200} />
        </Field>
      </div>
      <div className="grid3">
        <Field focus="icaoType" label="ICAO type designator" issues={at('icaoType')} hint="FPL item 9, e.g. C172">
          <input name="icaoType" className="mono upper" value={a.icaoType} onChange={(e) => { const v = e.target.value.toUpperCase().trim(); edit((d) => { d.icaoType = v; }); }} maxLength={4} placeholder="C172" />
        </Field>
        <Field focus="wake" label="Wake turbulence category" issues={at('wake')}>
          <select name="wake" value={a.wake} onChange={(e) => { const v = e.target.value as WakeCategory; edit((d) => { d.wake = v; }); }}>
            {WAKE.map((w) => <option key={w.v} value={w.v}>{w.label}</option>)}
          </select>
        </Field>
        <Field label="Home base" issues={at('homeBase')}>
          <AerodromeTextInput name="homeBase" value={a.homeBase} placeholder="e.g. LGTT" testId="home-base"
            onChange={(t, ad) => { const v = ad?.icao || t.toUpperCase().trim(); edit((d) => { d.homeBase = v; }); }} />
        </Field>
      </div>
      <div className="grid2">
        <Field focus="colours" label="Colours and markings" issues={at('colours')} hint="FPL item 19 A/, in capitals as filed">
          <input name="colours" className="upper" value={a.colours} onChange={(e) => { const v = e.target.value.toUpperCase(); edit((d) => { d.colours = v; }); }} placeholder="e.g. WHITE WITH BLUE STRIPES" maxLength={200} />
        </Field>
        <Field focus="operator" label="Operator" issues={at('operator')}>
          <OperatorPicker a={a} edit={edit} />
        </Field>
      </div>
      <Field label="Notes" issues={at('notes')}>
        <textarea name="notes" rows={2} value={a.notes} onChange={(e) => { const v = e.target.value; edit((d) => { d.notes = v; }); }} maxLength={5000} />
      </Field>
    </Section>
  );
}

export function FplSection({ a, edit, issues }: SectionProps) {
  const e = a.equipment;
  const at = (p: string) => issuesAt(issues, p, true);
  const codes = split10a(e.item10a);
  const toggle10a = (c: string) => edit((d) => {
    const cur = split10a(d.equipment.item10a).filter((x) => x !== 'N');
    d.equipment.item10a = join10a(cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]);
  });
  const b = split10b(e.item10b);
  const valid10b = e.item10b === '' || join10b(b.ssr, b.ads) === e.item10b.toUpperCase();
  const set10b = (ssr: string, ads: string[]) => edit((d) => { d.equipment.item10b = join10b(ssr, ads); });
  const eq = (fn: (q: AircraftInput['equipment']) => void) => edit((d) => fn(d.equipment));
  const item19 = [
    `R/${['U', 'V', 'E'].filter((_, i) => [e.emergencyRadio.uhf, e.emergencyRadio.vhf, e.emergencyRadio.elt][i]).join('') || '—'}`,
    `S/${['P', 'D', 'M', 'J'].filter((_, i) => [e.survival.polar, e.survival.desert, e.survival.maritime, e.survival.jungle][i]).join('') || '—'}`,
    e.jackets.present ? `J/${['L', 'F', 'U', 'V'].filter((_, i) => [e.jackets.light, e.jackets.fluorescein, e.jackets.uhf, e.jackets.vhf][i]).join('')}` : 'J/—',
    e.dinghies ? `D/${e.dinghies.number} ${e.dinghies.capacity}${e.dinghies.covered ? ' C' : ''} ${e.dinghies.colour.toUpperCase()}`.trim() : 'D/—',
    `A/${a.colours || '—'}`,
  ];
  return (
    <Section id="fpl" title="Flight plan items">
      <div className="sub-h">Item 10a: radio communication, navigation and approach aids</div>
      <div className="code-chips" role="group" aria-label="Item 10a designators">
        <button type="button" className={'code-chip' + (e.item10a === 'N' ? ' on' : '')} aria-pressed={e.item10a === 'N'} title="No COM/NAV/approach aid equipment for the route, or it is unserviceable"
          onClick={() => eq((q) => { q.item10a = q.item10a === 'N' ? '' : 'N'; })}>N</button>
        {ITEM10A_CODES.map((c) => (
          <button key={c.code} type="button" className={'code-chip' + (codes.includes(c.code) ? ' on' : '')} aria-pressed={codes.includes(c.code)} title={c.label} onClick={() => toggle10a(c.code)}>{c.code}</button>
        ))}
      </div>
      <div className="grid3">
        <Field focus="item10a" label="Item 10a as filed" issues={at('equipment.item10a')} hint="Click the codes above or type, e.g. SDFGY">
          <input name="equipment.item10a" className="mono upper" value={e.item10a} onChange={(ev) => { const v = ev.target.value.toUpperCase().replace(/\s/g, ''); eq((q) => { q.item10a = v; }); }} maxLength={40} />
        </Field>
        <Field label="Transponder (item 10b)" issues={valid10b ? at('equipment.item10b') : []}>
          <select value={b.ssr} onChange={(ev) => set10b(ev.target.value, ev.target.value === 'N' ? [] : b.ads)} disabled={!valid10b}>
            <option value="">—</option>
            {SSR_CODES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
          </select>
        </Field>
        <Field focus="item10b" label="Item 10b as filed" issues={valid10b ? [] : at('equipment.item10b')} hint="e.g. C, S, SB2">
          <input name="equipment.item10b" className="mono upper" value={e.item10b} onChange={(ev) => { const v = ev.target.value.toUpperCase().replace(/\s/g, ''); eq((q) => { q.item10b = v; }); }} maxLength={20} />
        </Field>
      </div>
      <div className="code-chips" role="group" aria-label="ADS designators of item 10b">
        {ADS_CODES.map((c) => {
          const on = b.ads.includes(c.code);
          return <button key={c.code} type="button" className={'code-chip' + (on ? ' on' : '')} aria-pressed={on} title={c.label} disabled={!valid10b || b.ssr === 'N'}
            onClick={() => set10b(b.ssr, on ? b.ads.filter((x) => x !== c.code) : [...b.ads, c.code])}>{c.code}</button>;
        })}
        <span className="hint">ADS-B / ADS-C</span>
      </div>

      <div className="grid2">
        <Field focus="pbn" label="PBN/ (item 18)" issues={at('equipment.pbn')} hint="Only with R in item 10a, e.g. B2D2S1">
          <input name="equipment.pbn" className="mono upper" value={e.pbn} onChange={(ev) => { const v = ev.target.value.toUpperCase().replace(/\s/g, ''); eq((q) => { q.pbn = v; }); }} maxLength={16} placeholder="none" />
        </Field>
        <Field focus="item18Extras" label="Other item 18 indicators" issues={at('equipment.item18Extras')} hint="e.g. NAV/SBAS COM/… · RMK/ text joins the flight’s RMK/">
          <input name="equipment.item18Extras" className="mono upper" value={e.item18Extras} onChange={(ev) => { const v = ev.target.value.toUpperCase(); eq((q) => { q.item18Extras = v; }); }} maxLength={200} />
        </Field>
      </div>

      <div className="sub-h">Item 19: supplementary information</div>
      <div className="i19">
        <fieldset>
          <legend>R/ Emergency radio</legend>
          <Check checked={e.emergencyRadio.uhf} onChange={(v) => eq((q) => { q.emergencyRadio.uhf = v; })}>U: UHF 243.0 MHz</Check>
          <Check checked={e.emergencyRadio.vhf} onChange={(v) => eq((q) => { q.emergencyRadio.vhf = v; })}>V: VHF 121.5 MHz</Check>
          <Check checked={e.emergencyRadio.elt} onChange={(v) => eq((q) => { q.emergencyRadio.elt = v; })}>E: ELT</Check>
        </fieldset>
        <fieldset>
          <legend>S/ Survival equipment</legend>
          <Check checked={e.survival.polar} onChange={(v) => eq((q) => { q.survival.polar = v; })}>P: polar</Check>
          <Check checked={e.survival.desert} onChange={(v) => eq((q) => { q.survival.desert = v; })}>D: desert</Check>
          <Check checked={e.survival.maritime} onChange={(v) => eq((q) => { q.survival.maritime = v; })}>M: maritime</Check>
          <Check checked={e.survival.jungle} onChange={(v) => eq((q) => { q.survival.jungle = v; })}>J: jungle</Check>
        </fieldset>
        <fieldset>
          <legend>J/ Life jackets</legend>
          <Check checked={e.jackets.present} onChange={(v) => eq((q) => { q.jackets.present = v; if (!v) { q.jackets.light = q.jackets.fluorescein = q.jackets.uhf = q.jackets.vhf = false; } })}>Carried</Check>
          <div className={'indent' + (e.jackets.present ? '' : ' off')}>
            <Check checked={e.jackets.light} onChange={(v) => eq((q) => { q.jackets.light = v; q.jackets.present ||= v; })}>L: with lights</Check>
            <Check checked={e.jackets.fluorescein} onChange={(v) => eq((q) => { q.jackets.fluorescein = v; q.jackets.present ||= v; })}>F: with fluorescein</Check>
            <Check checked={e.jackets.uhf} onChange={(v) => eq((q) => { q.jackets.uhf = v; q.jackets.present ||= v; })}>U: UHF radio</Check>
            <Check checked={e.jackets.vhf} onChange={(v) => eq((q) => { q.jackets.vhf = v; q.jackets.present ||= v; })}>V: VHF radio</Check>
          </div>
        </fieldset>
        <fieldset>
          <legend>D/ Dinghies</legend>
          <Check checked={!!e.dinghies} onChange={(v) => eq((q) => { q.dinghies = v ? { number: 1, capacity: 4, covered: false, colour: '' } : null; })}>Carried</Check>
          {e.dinghies && (
            <div className="indent stack-sm">
              <div className="row">
                <label className="field mini">Number<NumInput name="equipment.dinghies.number" value={e.dinghies.number} integer min={1} max={99} width={70} onChange={(v) => eq((q) => { q.dinghies!.number = v ?? 0; })} invalid={issuesAt(issues, 'equipment.dinghies.number', true).length > 0} /></label>
                <label className="field mini">Total capacity<NumInput name="equipment.dinghies.capacity" value={e.dinghies.capacity} integer min={1} max={999} width={90} unit="pers" onChange={(v) => eq((q) => { q.dinghies!.capacity = v ?? 0; })} invalid={issuesAt(issues, 'equipment.dinghies.capacity', true).length > 0} /></label>
              </div>
              <Check checked={e.dinghies.covered} onChange={(v) => eq((q) => { q.dinghies!.covered = v; })}>C: covered</Check>
              <label className="field mini">Colour<input name="equipment.dinghies.colour" className="upper" value={e.dinghies.colour} onChange={(ev) => { const v = ev.target.value.toUpperCase(); eq((q) => { q.dinghies!.colour = v; }); }} placeholder="e.g. ORANGE" /></label>
              {issuesAt(issues, 'equipment.dinghies').map((i, k) => <span key={k} className={'issue ' + i.level}>{i.message}</span>)}
            </div>
          )}
        </fieldset>
      </div>
      <Field focus="remarks" label="N/ Remarks for this aircraft" issues={at('equipment.remarks')} hint="Other survival equipment and useful remarks">
        <input name="equipment.remarks" className="upper" value={e.remarks} onChange={(ev) => { const v = ev.target.value.toUpperCase(); eq((q) => { q.remarks = v; }); }} maxLength={200} />
      </Field>
      <div className="fpl-preview" aria-label="Preview">
        <span className="muted">Preview</span>
        <code>-{a.icaoType || 'ZZZZ'}/{a.wake}-{e.item10a || '?'}/{e.item10b || '?'}</code>
        {(e.pbn || e.item18Extras) && <code>{[e.pbn && `PBN/${e.pbn}`, e.item18Extras].filter(Boolean).join(' ')}</code>}
        <code>{item19.join(' ')}{e.remarks ? ` N/${e.remarks}` : ''}</code>
      </div>
    </Section>
  );
}

export function SpeedsSection({ a, edit, issues }: SectionProps) {
  const at = (p: string) => issuesAt(issues, p, true);
  return (
    <Section id="speeds" title="Speeds">
      <div className="grid3">
        <Field focus="cruiseTasKt" label="Cruise TAS" issues={at('cruiseTasKt')}>
          <NumInput name="cruiseTasKt" value={a.cruiseTasKt} zeroAsEmpty onChange={(v) => edit((d) => { d.cruiseTasKt = v ?? 0; })} min={0} max={1000} unit="kt" placeholder="not set" invalid={at('cruiseTasKt').some((i) => i.level === 'error')} />
        </Field>
        <Field focus="patternTasKt" label="Pattern TAS" issues={at('patternTasKt')} hint="First and last legs">
          <NumInput name="patternTasKt" value={a.patternTasKt} zeroAsEmpty onChange={(v) => edit((d) => { d.patternTasKt = v ?? 0; })} min={0} max={1000} unit="kt" placeholder="not set" />
        </Field>
        <Field label="Climb TAS" issues={at('climbTasKt')}>
          <NumInput name="climbTasKt" value={a.climbTasKt} optional onChange={(v) => edit((d) => { d.climbTasKt = v; })} min={0} max={1000} unit="kt" />
        </Field>
      </div>
    </Section>
  );
}

export function FuelSection({ a, edit, issues }: SectionProps) {
  const f = a.fuel;
  const at = (p: string) => issuesAt(issues, p, true);
  const bad = (p: string) => at(p).some((i) => i.level === 'error');
  const fu = (fn: (q: AircraftInput['fuel']) => void) => edit((d) => fn(d.fuel));
  const enduranceMin = f.burnLph > 0 && f.usableL > 0 ? (f.usableL / f.burnLph) * 60 : null;
  const others = otherFuelTypes(f);
  const primary = f.types[0]?.type;
  return (
    <Section id="fuel" title="Fuel">
      <div className="fuel-types" data-path="fuel.types">
        <span className="lbl">Approved fuels</span>
        <table className="ed-table fuel-tbl">
          <thead><tr><th>Fuel</th><th className="num">Density <span className="u">kg/L</span></th><th /><th /></tr></thead>
          <tbody>
            {f.types.map((g) => (
              <tr key={g.type}>
                <td className="mono">{g.type}</td>
                <td className="num tnum muted">{fuelDensity(g.type).toFixed(2)}</td>
                <td>{g.type === primary
                  ? (f.types.length > 1 ? <span className="hint" title="A flight that gives only a total carries this fuel">Default</span> : null)
                  : <button type="button" className="linkish" onClick={() => fu((q) => makePrimaryFuel(q, g.type))}>Make default</button>}</td>
                <td className="row-tools">
                  <RowRemove label={`Remove ${g.type}`} disabled={f.types.length <= 1} onClick={() => fu((q) => removeFuelType(q, g.type))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {others.length > 0 && (
          <div className="row">{others.map((t) => <button key={t} type="button" className="ghost sm" onClick={() => fu((q) => addFuelType(q, t))}>+ {t}</button>)}</div>
        )}
        <IssueList issues={issuesAt(issues, 'fuel.types')} />
      </div>
      <div className="grid3">
        <Field label="Tanks" issues={at('fuel.tanks')}>
          <input name="fuel.tanks" value={f.tanks} onChange={(e) => { const v = e.target.value; fu((q) => { q.tanks = v; }); }} maxLength={60} placeholder="e.g. standard, long-range" />
        </Field>
      </div>
      <div className="grid3">
        <Field label="Total capacity" issues={at('fuel.totalL')}>
          <NumInput name="fuel.totalL" value={f.totalL} zeroAsEmpty onChange={(v) => fu((q) => { q.totalL = v ?? 0; })} min={0} max={100000} unit="L" />
        </Field>
        <Field label="Usable" issues={at('fuel.usableL')}>
          <NumInput name="fuel.usableL" value={f.usableL} zeroAsEmpty onChange={(v) => fu((q) => { q.usableL = v ?? 0; })} min={0} max={100000} unit="L" invalid={bad('fuel.usableL')} />
        </Field>
        <Field label="Unusable" issues={at('fuel.unusableL')}>
          <NumInput name="fuel.unusableL" value={f.unusableL} onChange={(v) => fu((q) => { q.unusableL = v ?? 0; })} min={0} max={100000} unit="L" invalid={bad('fuel.unusableL')} />
        </Field>
      </div>
      <div className="grid3">
        <Field focus="burnLph" label="Planning burn rate" issues={at('fuel.burnLph')}>
          <NumInput name="fuel.burnLph" value={f.burnLph} zeroAsEmpty onChange={(v) => fu((q) => { q.burnLph = v ?? 0; })} min={0} max={10000} unit="L/h" placeholder="not set" invalid={bad('fuel.burnLph')} />
        </Field>
        <Field label="Fixed allowance" issues={at('fuel.taxiAllowanceL')} hint="Start-up, taxi, take-off and landing; once per flight">
          <NumInput name="fuel.taxiAllowanceL" value={f.taxiAllowanceL} onChange={(v) => fu((q) => { q.taxiAllowanceL = v ?? 0; })} min={0} max={10000} unit="L" />
        </Field>
        <div className="stat" data-testid="endurance">
          <span className="muted">Endurance on usable fuel</span>
          <b>{fmtDuration(enduranceMin, { fallback: '—' })}</b>
          {primary && f.usableL > 0 && <span className="muted">{Math.round(f.usableL * fuelDensity(primary))} kg usable ({primary})</span>}
        </div>
      </div>
    </Section>
  );
}
