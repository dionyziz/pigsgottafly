// One aircraft of the hangar: identity, flight plan items, speeds, fuel, mass & balance (stations,
// seats, envelopes), performance tables and compass cards. The page edits a local draft; Save sends
// the whole aircraft (PUT /api/aircraft/:id). Errors block saving, warnings do not. Shared aircraft:
// editors edit like the owner; viewers see the page read-only. Share opens the sharing dialog.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Shell } from '../../app/Shell';
import { focusAndHighlight, useFocusParam } from '../../app/focusParam';
import { useSession } from '../../app/session';
import { useToast } from '../../app/toast';
import { api, ApiRequestError } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import { CARD_EXPIRY_WARN_DAYS } from '../../shared/constants';
import { localToday } from '../../shared/date';
import { standardFuelTypes } from '../../shared/fuel';
import { errorMessage } from '../../shared/format';
import type { Aircraft, AircraftInput } from '../../shared/types';
import type { HangarAircraft } from '../../shared/sharing';
import { Chip, ConfirmDialog, EmptyState, Icon, KebabMenu, Loading } from '../../ui';
import { CompassSection } from './CompassSection';
import { DocumentsSection, PhotoControl } from './AircraftFiles';
import { aircraftScope } from '../../data/aircraftFiles';
import { MassBalanceSection } from './MassBalanceSection';
import { validateAircraft, type Issue, type SectionId } from './model';
import { PerformanceSection } from './PerformanceSection';
import { FplSection, FuelSection, IdentitySection, SpeedsSection } from './sections';
import { ShareDialog, SharedChip } from './ShareDialog';
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
  { id: 'documents', label: 'Documents' },
];

/** The editable part of an aircraft (fuel densities at the standard values: saving migrates old ones). */
export function toInput(a: Aircraft | HangarAircraft): AircraftInput {
  const { id: _i, created: _c, updated: _u, access: _a, photo: _p, ...rest } = a as HangarAircraft;
  return { ...rest, fuel: { ...rest.fuel, types: standardFuelTypes(rest.fuel.types) } };
}

/**
 * The input an issue is about: inputs are named by their issue path (name="fuel.usableL"), lists
 * and tables carry data-path; a path with no element of its own falls back to its parent path, and
 * at last to the section.
 */
export function issueTarget(root: ParentNode, issue: Pick<Issue, 'path' | 'section'>): HTMLElement | null {
  const parts = issue.path ? issue.path.split('.') : [];
  for (let n = parts.length; n > 0; n--) {
    const p = parts.slice(0, n).join('.').replace(/["\\]/g, '');
    const el = root.querySelector<HTMLElement>(`[name="${p}"], [data-path="${p}"]`)
      ?? root.querySelector<HTMLElement>(`[name^="${p}."], [data-path^="${p}."]`);
    if (el) return el;
  }
  return root.querySelector<HTMLElement>(`#${issue.section}`);
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
      ) : !data ? <Loading /> : <AircraftEditor key={data.id} aircraft={data} onSaved={setData} />}
    </Shell>
  );
}

function AircraftEditor({ aircraft, onSaved }: { aircraft: HangarAircraft; onSaved: (a: HangarAircraft) => void }) {
  const { pilot, setPilot } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const today = localToday();
  const baseline = useMemo(() => toInput(aircraft), [aircraft]);
  const [draft, setDraft] = useState<AircraftInput>(baseline);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const role = aircraft.access?.role ?? 'owner';
  const readOnly = role === 'view';
  const [showIssues, setShowIssues] = useState(false);
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(baseline), [draft, baseline]);
  const issues = useMemo(() => validateAircraft(draft, today, CARD_EXPIRY_WARN_DAYS), [draft, today]);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const isDefault = pilot.defaultAircraftId === aircraft.id;
  // ?focus=<field>: a warning elsewhere (an export) linked here
  useFocusParam(() => document.querySelector('[data-testid=aircraft-page]'));

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
      setSaveError(e instanceof ApiRequestError && e.status === 0 ? 'You are offline. Your changes are kept.' : errorMessage(e));
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
    catch (e) { toast(errorMessage(e)); }
  };

  const counts = (s: SectionId) => {
    const xs = issues.filter((i) => i.section === s);
    return { e: xs.filter((i) => i.level === 'error').length, w: xs.filter((i) => i.level === 'warning').length };
  };
  const props = { a: draft, edit, issues };
  const goTo = (i: Issue) => {
    const root = document.querySelector('[data-testid=aircraft-page]');
    const el = root && issueTarget(root, i);
    if (!el) return;
    setShowIssues(false);
    focusAndHighlight(el);
  };

  return (
    <div className="ac-page" data-testid="aircraft-page">
      <div className="page-head ac-head">
        <Link to="/hangar" className="back" aria-label="Back to the hangar" title="Hangar">
          <Icon name="back" size={18} />
        </Link>
        <PhotoControl aircraftId={aircraft.id} registration={aircraft.registration} photo={aircraft.photo} canEdit={!readOnly}
          onChange={(p) => onSaved({ ...aircraft, photo: p })} />
        <div>
          <h1 className="mono">{draft.registration || 'New aircraft'}</h1>
          <div className="muted">{[draft.makeModel, draft.icaoType && `${draft.icaoType}/${draft.wake}`, draft.operator].filter(Boolean).join(' · ') || 'Type not set'}</div>
        </div>
        {isDefault && <Chip tone="ok" title="New flights use this aircraft">Default</Chip>}
        <SharedChip access={aircraft.access} />
        <span className="spacer" />
        <button type="button" onClick={() => setSharing(true)} data-testid="share-aircraft">Share</button>
        <KebabMenu label="Aircraft actions" items={[
          ...(isDefault ? [] : [{ label: 'Make default aircraft', onSelect: () => void makeDefault() }]),
          role === 'owner'
            ? { label: 'Delete aircraft', onSelect: () => setDeleting(true), danger: true, separator: !isDefault }
            : { label: 'Remove from my hangar', onSelect: () => setLeaving(true), danger: true, separator: !isDefault },
        ]} />
      </div>

      <div className="ac-layout">
        <nav className="ac-nav" aria-label="Sections">
          {SECTIONS.map((s) => {
            const c = counts(s.id);
            return (
              <a key={s.id} href={`#${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>
                <span>{s.label}</span>
                {c.e > 0 ? <Chip tone="danger" count sm title={`${c.e} error${c.e > 1 ? 's' : ''}`}>{c.e}</Chip> : c.w > 0 ? <Chip tone="warn" count sm title={`${c.w} warning${c.w > 1 ? 's' : ''}`}>{c.w}</Chip> : null}
              </a>
            );
          })}
        </nav>
        <form className="ac-main" onSubmit={(e) => { e.preventDefault(); void save(); }} noValidate>
          <fieldset className="ac-fieldset" disabled={readOnly}>
          <IdentitySection {...props} />
          <FplSection {...props} />
          <SpeedsSection {...props} />
          <FuelSection {...props} />
          <MassBalanceSection {...props} />
          <PerformanceSection {...props} />
          <CompassSection {...props} today={today} aircraftId={aircraft.id} />
          </fieldset>
          <DocumentsSection scope={aircraftScope(aircraft.id)} canEdit={!readOnly} />

          {readOnly ? (
            <div className="ac-viewonly card" data-testid="aircraft-viewonly">
              <Chip>View only</Chip>
              <span className="muted">Shared by {aircraft.access.owner.name || aircraft.access.owner.email}</span>
            </div>
          ) : (

          <div className={'ac-savebar card' + (dirty ? ' dirty' : '')} role="region" aria-label="Save">
            <button type="button" className="issue-sum" onClick={() => setShowIssues((v) => !v)} aria-expanded={showIssues} disabled={!issues.length}>
              {errors.length > 0 && <Chip tone="danger">{errors.length} error{errors.length > 1 ? 's' : ''}</Chip>}
              {warnings.length > 0 && <Chip tone="warn">{warnings.length} warning{warnings.length > 1 ? 's' : ''}</Chip>}
              {!issues.length && <Chip tone="ok">Complete</Chip>}
            </button>
            {saveError ? <span className="form-error" role="alert">{saveError}</span> : <span className="muted">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>}
            <span className="spacer" />
            {dirty && <button type="button" className="ghost" onClick={() => { setDraft(baseline); setSaveError(null); }} disabled={busy}>Discard</button>}
            <button type="submit" className="primary" disabled={!dirty || busy} title="Save (Ctrl+S)">{busy ? 'Saving…' : 'Save'}</button>
            {showIssues && issues.length > 0 && (
              <ul className="issue-pop" data-testid="issue-pop">
                {[...errors, ...warnings].map((i, k) => (
                  <li key={k} className={i.level}>
                    <button type="button" className="issue-go" onClick={() => goTo(i)} data-testid="issue-go">
                      <span className="sec">{SECTIONS.find((s) => s.id === i.section)?.label}</span>
                      <span className="msg">{i.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          )}
        </form>
      </div>

      {sharing && (
        <ShareDialog id={aircraft.id} name={aircraft.registration} onClose={() => setSharing(false)}
          onLeft={() => { if (isDefault) setPilot({ ...pilot, defaultAircraftId: null }); toast(`Removed ${aircraft.registration} from your hangar`); navigate('/hangar'); }} />
      )}
      {leaving && (
        <ConfirmDialog title={`Remove ${aircraft.registration} from your hangar?`} confirmLabel="Remove" onClose={() => setLeaving(false)}
          onConfirm={async () => {
            await api.shares.remove(aircraft.id, pilot.id);
            if (isDefault) setPilot({ ...pilot, defaultAircraftId: null });
            toast(`Removed ${aircraft.registration} from your hangar`);
            navigate('/hangar');
          }} />
      )}
      {deleting && (
        <ConfirmDialog title={`Delete ${aircraft.registration}?`} confirmLabel="Delete" onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await api.aircraft.remove(aircraft.id);
            if (isDefault) setPilot({ ...pilot, defaultAircraftId: null });
            toast(`Deleted ${aircraft.registration}`);
            navigate('/hangar');
          }} />
      )}
    </div>
  );
}
