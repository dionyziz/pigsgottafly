// One aircraft of the hangar: identity, flight plan items, speeds, fuel, mass & balance (stations,
// seats, envelopes), performance tables and compass cards. The page edits a local draft; Save sends
// the whole aircraft (PUT /api/aircraft/:id). Errors block saving, warnings do not.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Shell } from '../../app/Shell';
import { useSession } from '../../app/session';
import { useToast } from '../../app/toast';
import { api, ApiRequestError } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import { CARD_EXPIRY_WARN_DAYS } from '../../shared/constants';
import type { Aircraft, AircraftInput } from '../../shared/types';
import { localToday } from '../lobby/format';
import { ConfirmDialog, EmptyState, KebabMenu } from '../lobby/ui';
import { CompassSection } from './CompassSection';
import { MassBalanceSection } from './MassBalanceSection';
import { validateAircraft, type SectionId } from './model';
import { PerformanceSection } from './PerformanceSection';
import { FplSection, FuelSection, IdentitySection, SpeedsSection } from './sections';
import '../lobby/lists.css';
import './hangar.css';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'fpl', label: 'Flight plan items' },
  { id: 'speeds', label: 'Speeds' },
  { id: 'fuel', label: 'Fuel' },
  { id: 'mb', label: 'Mass and balance' },
  { id: 'performance', label: 'Performance' },
  { id: 'compass', label: 'Compass swing' },
];

export function toInput(a: Aircraft): AircraftInput {
  const { id: _i, created: _c, updated: _u, ...rest } = a;
  return rest;
}

export function AircraftPage() {
  const { id = '' } = useParams();
  const { data, error, setData } = useAsync(() => api.aircraft.get(id), [id]);
  return (
    <Shell>
      {error && !data ? (
        <EmptyState title={error instanceof ApiRequestError && error.status === 404 ? 'Aircraft not found' : 'Could not load the aircraft'} action={<Link to="/hangar" className="btn">Back to the hangar</Link>}>
          {error instanceof ApiRequestError && error.status === 404 ? 'It may have been deleted.' : error.message}
        </EmptyState>
      ) : !data ? <p className="muted">Loading…</p> : <AircraftEditor key={data.id} aircraft={data} onSaved={setData} />}
    </Shell>
  );
}

function AircraftEditor({ aircraft, onSaved }: { aircraft: Aircraft; onSaved: (a: Aircraft) => void }) {
  const { pilot, setPilot } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const today = localToday();
  const baseline = useMemo(() => toInput(aircraft), [aircraft]);
  const [draft, setDraft] = useState<AircraftInput>(baseline);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline]);
  const issues = useMemo(() => validateAircraft(draft, today, CARD_EXPIRY_WARN_DAYS), [draft, today]);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const isDefault = pilot.defaultAircraftId === aircraft.id;

  const edit = useCallback((fn: (d: AircraftInput) => void) => {
    setDraft((d) => { const c: AircraftInput = structuredClone(d); fn(c); return c; });
    setSaveError(null);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useCallback(async () => {
    if (!dirty || busy) return;
    if (errors.length) { setShowIssues(true); setSaveError(`Fix ${errors.length === 1 ? 'the error' : `the ${errors.length} errors`} before saving.`); return; }
    setBusy(true);
    try {
      const saved = await api.aircraft.update(aircraft.id, draft);
      onSaved(saved);
      setDraft(toInput(saved));
      setSaveError(null);
      toast(`Saved ${saved.registration}`);
    } catch (e) {
      setSaveError(e instanceof ApiRequestError && e.status === 0 ? 'You are offline. Your changes are still here; try again when back online.' : String((e as Error).message || e));
    } finally {
      setBusy(false);
    }
  }, [dirty, busy, errors.length, aircraft.id, draft, onSaved, toast]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void save(); } };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [save]);

  const makeDefault = async () => {
    try { setPilot(await api.me.update({ defaultAircraftId: aircraft.id })); toast(`${aircraft.registration} is now your default aircraft`); }
    catch (e) { toast(String((e as Error).message || e)); }
  };

  const counts = (s: SectionId) => {
    const xs = issues.filter((i) => i.section === s);
    return { e: xs.filter((i) => i.level === 'error').length, w: xs.filter((i) => i.level === 'warning').length };
  };
  const props = { a: draft, edit, issues };

  return (
    <div className="ac-page" data-testid="aircraft-page">
      <div className="page-head ac-head">
        <Link to="/hangar" className="back" aria-label="Back to the hangar" title="Hangar">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M11 3L5 9l6 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </Link>
        <div>
          <h1 className="mono">{draft.registration || 'New aircraft'}</h1>
          <div className="muted">{[draft.makeModel, draft.icaoType && `${draft.icaoType}/${draft.wake}`, draft.operator].filter(Boolean).join(' · ') || 'Type not set'}</div>
        </div>
        {isDefault && <span className="chip ok" title="New flights use this aircraft">Default</span>}
        <span className="spacer" />
        <KebabMenu label="Aircraft actions" items={[
          ...(isDefault ? [] : [{ label: 'Make default aircraft', onSelect: () => void makeDefault() }]),
          { label: 'Delete aircraft', onSelect: () => setDeleting(true), danger: true, separator: !isDefault },
        ]} />
      </div>

      <div className="ac-layout">
        <nav className="ac-nav" aria-label="Sections">
          {SECTIONS.map((s) => {
            const c = counts(s.id);
            return (
              <a key={s.id} href={`#${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                <span>{s.label}</span>
                {c.e > 0 ? <span className="hg-count err" title={`${c.e} error${c.e > 1 ? 's' : ''}`}>{c.e}</span> : c.w > 0 ? <span className="hg-count warn" title={`${c.w} warning${c.w > 1 ? 's' : ''}`}>{c.w}</span> : null}
              </a>
            );
          })}
        </nav>
        <form className="ac-main" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
          <IdentitySection {...props} />
          <FplSection {...props} />
          <SpeedsSection {...props} />
          <FuelSection {...props} />
          <MassBalanceSection {...props} />
          <PerformanceSection {...props} />
          <CompassSection {...props} today={today} aircraftId={aircraft.id} />

          <div className={'ac-savebar card' + (dirty ? ' dirty' : '')} role="region" aria-label="Save">
            <button type="button" className="issue-sum" onClick={() => setShowIssues((v) => !v)} aria-expanded={showIssues} disabled={!issues.length}>
              {errors.length > 0 && <span className="chip danger">{errors.length} error{errors.length > 1 ? 's' : ''}</span>}
              {warnings.length > 0 && <span className="chip warn">{warnings.length} warning{warnings.length > 1 ? 's' : ''}</span>}
              {!issues.length && <span className="chip ok">Complete</span>}
            </button>
            {saveError ? <span className="form-error" role="alert">{saveError}</span> : <span className="muted">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>}
            <span className="spacer" />
            {dirty && <button type="button" className="ghost" onClick={() => { setDraft(baseline); setSaveError(null); }} disabled={busy}>Discard</button>}
            <button type="submit" className="primary" disabled={!dirty || busy} title="Save (Ctrl+S)">{busy ? 'Saving…' : 'Save'}</button>
            {showIssues && issues.length > 0 && (
              <ul className="issue-pop">
                {[...errors, ...warnings].map((i, k) => (
                  <li key={k} className={i.level}>
                    <a href={`#${i.section}`} onClick={(e) => { e.preventDefault(); document.getElementById(i.section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{SECTIONS.find((s) => s.id === i.section)?.label}</a>
                    <span>{i.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </form>
      </div>

      {deleting && (
        <ConfirmDialog title={`Delete ${aircraft.registration}?`} confirmLabel="Delete" onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await api.aircraft.remove(aircraft.id);
            if (isDefault) setPilot({ ...pilot, defaultAircraftId: null });
            toast(`Deleted ${aircraft.registration}`);
            navigate('/hangar');
          }}>
          The aircraft and its weight and balance, performance and compass data are removed. Flights planned with it keep their route and manifest but will have no aircraft.
        </ConfirmDialog>
      )}
    </div>
  );
}
