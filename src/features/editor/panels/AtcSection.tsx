// ATC list: generated from the route (departure, aerodromes along the route, destination, TMAs
// entered at the planned altitude, FIS). It follows the route until the pilot edits it; then the
// edited list is saved on the flight (doc.atc) and "Regenerate" refreshes the generated rows while
// keeping the rows added by hand.
import { useMemo, useState } from 'react';
import { uid, type AtcEntry } from '../../../shared';
import { moveAt } from '../../../shared/list';
import { Chip, DragHandle, Icon, useSortable } from '../../../ui';
import { atcFreqText, atcInput, generateAtcList, regenerateAtcList } from '../../../data/atc';
import { useEditor } from '../state';
import { Section } from './ui';

const FREQ_RE = /^\d{3}\.\d{1,3}$/;

function EditRow({ entry, onSave, onCancel }: { entry: AtcEntry; onSave(e: AtcEntry): void; onCancel(): void }) {
  const [f, setF] = useState({
    group: entry.group, callsign: entry.callsign, service: entry.service,
    primary: entry.primary, backups: entry.backups.join(' '), remark: entry.remark,
  });
  const backups = f.backups.split(/[\s,/]+/).filter(Boolean);
  const bad = [f.primary, ...backups].filter((x) => x && !FREQ_RE.test(x));
  const ok = f.callsign.trim() && bad.length === 0;
  const badPrimary = !!f.primary && !FREQ_RE.test(f.primary);
  const badBackups = backups.some((x) => !FREQ_RE.test(x));
  const save = () => {
    if (!ok) return;
    onSave({ ...entry, group: f.group.trim(), callsign: f.callsign.trim().toUpperCase(), service: f.service.trim().toUpperCase(), primary: f.primary.trim(), backups, remark: f.remark.trim() });
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form className="ep-atc-edit" onSubmit={(e) => { e.preventDefault(); save(); }} onKeyDown={(e) => { if (e.key === 'Escape') onCancel(); }} data-testid="atc-edit">
      <label className="field wide">Callsign<input value={f.callsign} onChange={set('callsign')} placeholder="TATOI TOWER" autoFocus /></label>
      <label className="field">Unit<input value={f.service} onChange={set('service')} placeholder="TWR" /></label>
      <label className="field">Primary<input value={f.primary} onChange={set('primary')} placeholder="122.650" className={badPrimary ? 'invalid' : ''} aria-invalid={badPrimary || undefined} data-testid="atc-primary" />
        {badPrimary && <span className="hint danger-text" data-testid="atc-freq-format">Format 123.450</span>}</label>
      <label className="field wide">Backups<input value={f.backups} onChange={set('backups')} placeholder="118.500 …" className={badBackups ? 'invalid' : ''} aria-invalid={badBackups || undefined} />
        {badBackups && <span className="hint danger-text">Format 123.450</span>}</label>
      <label className="field wide">Heading<input value={f.group} onChange={set('group')} placeholder="e.g. LGTT DEKELIA / TATOI" /></label>
      <label className="field wide">Remark<input value={f.remark} onChange={set('remark')} /></label>
      <div className="row wide">
        <span className="spacer" />
        <button type="button" className="ghost" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={!ok}>Save</button>
      </div>
    </form>
  );
}

export function AtcSection() {
  const { doc, update, altitudesFt, ref, pilot } = useEditor();
  const [editing, setEditing] = useState<string | null>(null);

  const generated = useMemo(() => {
    if (doc.route.length < 1) return [];
    try {
      return generateAtcList(atcInput(doc.route, altitudesFt, ref, pilot.settings.enrouteAerodromeRadiusNm ?? 2));
    } catch (e) {
      console.warn('ATC list generation failed', e);
      return [];
    }
  }, [doc.route, altitudesFt, ref, pilot.settings.enrouteAerodromeRadiusNm]);

  const edited = doc.atc !== null;
  const list = doc.atc ?? generated;
  const stale = useMemo(() => {
    if (!doc.atc) return false;
    const a = doc.atc.filter((e) => e.sourceKey).map((e) => e.sourceKey).join('|');
    const b = generated.map((e) => e.sourceKey).join('|');
    return a !== b;
  }, [doc.atc, generated]);

  /** Every edit materializes the list on the flight. */
  const edit = (fn: (l: AtcEntry[]) => AtcEntry[]) => update((d) => ({ ...d, atc: fn(d.atc ?? generated) }));
  const sort = useSortable({ count: list.length, onMove: (from, to) => edit((l) => moveAt(l, from, to)), disabled: editing !== null });
  const regenerate = () => update((d) => {
    const custom = (d.atc ?? []).filter((e) => e.sourceKey === null);
    return { ...d, atc: custom.length ? regenerateAtcList(d.atc, generated) : null };
  });
  const add = () => {
    const e: AtcEntry = { id: uid(), role: 'custom', group: 'Other', callsign: '', service: '', primary: '', backups: [], remark: '', sourceKey: null };
    edit((l) => [...l, e]);
    setEditing(e.id);
  };

  const badge = (
    <>
      <span className="muted">{list.length} units</span>
      {edited ? <Chip tone={stale ? 'warn' : undefined} title={stale ? 'The route changed since the list was edited' : 'Edited by hand'}>{stale ? 'Outdated' : 'Edited'}</Chip> : null}
    </>
  );

  let lastGroup = '';
  return (
    <Section id="atc" title="ATC" badge={badge} actions={
      <>
        {edited && <button type="button" className="icon" title="Regenerate from the route (keeps rows you added)" aria-label="Regenerate" onClick={regenerate} data-testid="atc-regenerate"><Icon name="refresh" className="ep-icon" /></button>}
        <button type="button" className="icon" title="Add a unit" aria-label="Add a unit" onClick={add} data-testid="atc-add"><Icon name="plus" className="ep-icon" /></button>
      </>
    }>
      {stale && (
        <p className="ep-note warn-text">Route changed since this list was edited. <button type="button" className="linkish" onClick={regenerate}>Regenerate</button></p>
      )}
      {list.length === 0 && <p className="muted ep-note">No route.</p>}
      <ol className="ep-atc" data-testid="atc-list">
        {list.map((e, i) => {
          const head = e.group !== lastGroup ? e.group : null;
          lastGroup = e.group;
          return (
            <li key={e.id} {...sort.itemProps(i, 'ep-atc-item')}>
              {head !== null && <div className="ep-atc-group">{head || 'Other'}</div>}
              {editing === e.id ? (
                <EditRow
                  entry={e}
                  onCancel={() => {
                    setEditing(null);
                    // a new row cancelled before it had a callsign is dropped
                    if (!e.callsign) edit((l) => l.filter((x) => x.id !== e.id));
                  }}
                  onSave={(n) => { edit((l) => l.map((x) => (x.id === e.id ? n : x))); setEditing(null); }}
                />
              ) : (
                <div className="ep-atc-row" data-testid="atc-row">
                  <DragHandle {...sort.handleProps(i)} label={`Move ${e.callsign || 'unit'}`} />
                  <div className="ep-atc-main" role="button" tabIndex={0} title="Edit" data-testid="atc-row-edit"
                    onClick={() => setEditing(e.id)} onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); setEditing(e.id); } }}>
                    <span className="ep-atc-cs">{e.callsign}{e.service && <span className="ep-atc-svc">{e.service}</span>}</span>
                    <span className="ep-atc-freq tnum">{atcFreqText(e) || <span className="muted">no frequency</span>}</span>
                    {e.remark && <span className="ep-atc-remark muted">{e.remark}</span>}
                  </div>
                  <div className="ep-row-actions">
                    <button type="button" className="icon" title="Remove" aria-label={`Remove ${e.callsign || 'unit'}`} onClick={() => edit((l) => l.filter((x) => x.id !== e.id))} data-testid="atc-remove"><Icon name="x" size={14} className="ep-icon" /></button>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Section>
  );
}
