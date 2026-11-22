// The page edits a local draft and saves it on its own (useAutosave: PUT /api/aircraft/:id of the whole
// aircraft, debounced; on blur, Ctrl+S and leaving). Errors hold the save back; warnings do not.
import '../lobby/lists.css';
import './hangar.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { focusAndHighlight, useFocusParam } from '../../app/focusParam';
import { useSession } from '../../app/session';
import { Shell } from '../../app/Shell';
import { usePageTitle } from '../../app/title';
import { useToast } from '../../app/toast';
import { aircraftScope } from '../../data/aircraftFiles';
import { api, ApiRequestError, keepalivePut } from '../../data/api';
import { useAsync } from '../../data/useAsync';
import { CARD_EXPIRY_WARN_DAYS } from '../../shared/constants';
import { localToday } from '../../shared/date';
import { errorMessage } from '../../shared/format';
import { standardFuelTypes } from '../../shared/fuel';
import type { HangarAircraft } from '../../shared/sharing';
import type { Aircraft, AircraftInput } from '../../shared/types';
import { Chip, ConfirmDialog, EmptyState, Icon, KebabMenu, Loading, SaveStatus, useAutosave } from '../../ui';
import { DocumentsSection, PhotoControl } from './AircraftFiles';
import { CompassSection } from './CompassSection';
import { HistorySection } from './HistorySection';
import { MassBalanceSection } from './MassBalanceSection';
import { type Issue, type SectionId, validateAircraft } from './model';
import { PerformanceSection } from './PerformanceSection';
import { FplSection, FuelSection, IdentitySection, SpeedsSection } from './sections';
import { SharedChip, ShareDialog } from './ShareDialog';
import { useScrollSpy } from './useScrollSpy';

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: 'identity', label: 'Identity' },
  { id: 'fpl', label: 'Flight plan items' },
  { id: 'speeds', label: 'Speeds' },
  { id: 'fuel', label: 'Fuel' },
  { id: 'mb', label: 'Mass and balance' },
  { id: 'performance', label: 'Performance' },
  { id: 'compass', label: 'Compass swing' },
  { id: 'documents', label: 'Documents' },
  { id: 'history', label: 'History' },
];
const SECTION_IDS = SECTIONS.map((s) => s.id);

/** The editable part of an aircraft (fuel densities at the standard values: saving migrates old ones). */
export function toInput(a: Aircraft | HangarAircraft): AircraftInput {
  const {
    id: _i,
    created: _c,
    updated: _u,
    access: _a,
    photo: _p,
    placeholder: _ph,
    updatedAt: _ua,
    updatedBy: _ub,
    ...rest
  } = a as HangarAircraft;
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
    const el =
      root.querySelector<HTMLElement>(`[name="${p}"], [data-path="${p}"]`) ??
      root.querySelector<HTMLElement>(`[name^="${p}."], [data-path^="${p}."]`);
    if (el) return el;
  }
  return root.querySelector<HTMLElement>(`#${issue.section}`);
}

export function AircraftPage() {
  const { id = '' } = useParams();
  const { data, error, setData } = useAsync(() => api.aircraft.get(id), [id], { cache: `aircraft:${id}` });
  return (
    <Shell>
      {error && !data ? (
        <EmptyState
          title={
            error instanceof ApiRequestError && error.status === 404
              ? 'Aircraft not found'
              : 'Could not load the aircraft'
          }
          action={
            <Link to="/hangar" className="btn">
              Back to the hangar
            </Link>
          }
        >
          {error instanceof ApiRequestError && error.status === 404 ? 'It may have been deleted.' : error.message}
        </EmptyState>
      ) : !data ? (
        <Loading />
      ) : (
        <AircraftEditor key={data.id} aircraft={data} onSaved={setData} />
      )}
    </Shell>
  );
}

function AircraftEditor({ aircraft, onSaved }: { aircraft: HangarAircraft; onSaved: (a: HangarAircraft) => void }) {
  const { pilot, setPilot } = useSession();
  const toast = useToast();
  const navigate = useNavigate();
  const today = localToday();
  const [draft, setDraft] = useState<AircraftInput>(() => toInput(aircraft));
  usePageTitle(draft.registration || 'New aircraft');
  const [deleting, setDeleting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const role = aircraft.access?.role ?? 'owner';
  const readOnly = role === 'view';
  const issues = useMemo(() => validateAircraft(draft, today, CARD_EXPIRY_WARN_DAYS), [draft, today]);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const isDefault = pilot.defaultAircraftId === aircraft.id;
  // ?focus=<field>: a warning elsewhere (an export) linked here
  useFocusParam(() => document.querySelector('[data-testid=aircraft-page]'));
  const spy = useScrollSpy(SECTION_IDS);
  // the registration heads the section nav once the page title has scrolled away
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [titleGone, setTitleGone] = useState(false);
  useEffect(() => {
    const el = titleRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setTitleGone(!e.isIntersecting && e.boundingClientRect.top < 0), {
      rootMargin: '-64px 0px 0px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const edit = useCallback((fn: (d: AircraftInput) => void) => {
    setDraft((d) => {
      const c: AircraftInput = structuredClone(d);
      fn(c);
      return c;
    });
  }, []);

  // autosave: errors hold it back (the bar lists them); the server's copy keeps photo and access current
  const latestAircraft = useRef(aircraft);
  latestAircraft.current = aircraft;
  const save = useCallback(
    async (input: AircraftInput) => {
      const saved = await api.aircraft.update(aircraft.id, input);
      // the photo may have changed meanwhile (it is not part of the save)
      onSaved({ ...saved, photo: latestAircraft.current.photo });
    },
    [aircraft.id, onSaved],
  );
  const autosave = useAutosave({
    value: draft,
    enabled: !readOnly && errors.length === 0,
    save,
    keepalive: (v) => keepalivePut(`aircraft/${encodeURIComponent(aircraft.id)}`, v),
  });
  const blocked = autosave.dirty && errors.length > 0;

  const { flush } = autosave;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        flush();
      }
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [flush]);

  useEffect(() => {
    if (!showWarnings) return;
    const down = (e: PointerEvent) => {
      if (!(e.target as Element).closest?.('.ac-warn')) setShowWarnings(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowWarnings(false);
    };
    document.addEventListener('pointerdown', down);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('pointerdown', down);
      document.removeEventListener('keydown', esc);
    };
  }, [showWarnings]);

  const makeDefault = async () => {
    try {
      setPilot(await api.me.update({ defaultAircraftId: aircraft.id }));
      toast(`${aircraft.registration} is now your default aircraft`);
    } catch (e) {
      toast(errorMessage(e));
    }
  };

  const counts = (s: SectionId) => {
    const xs = issues.filter((i) => i.section === s);
    return { e: xs.filter((i) => i.level === 'error').length, w: xs.filter((i) => i.level === 'warning').length };
  };
  const props = { a: draft, edit, issues };
  const goTo = (i: Pick<Issue, 'path' | 'section'>) => {
    const root = document.querySelector('[data-testid=aircraft-page]');
    const el = root && issueTarget(root, i);
    if (!el) return;
    setShowWarnings(false);
    focusAndHighlight(el);
  };
  const saveError = autosave.status === 'failed' ? autosave.error : null;
  const duplicate = saveError instanceof ApiRequestError && saveError.status === 409;
  const sectionLabel = (id: SectionId) => SECTIONS.find((s) => s.id === id)?.label;

  return (
    <div className="ac-page" data-testid="aircraft-page">
      <div className="ac-head">
        <div className="ac-head-back">
          <Link to="/hangar" className="back" aria-label="Back to the hangar" title="Hangar">
            <Icon name="back" size={18} />
          </Link>
        </div>
        <div className="ac-head-main">
          <PhotoControl
            aircraftId={aircraft.id}
            registration={aircraft.registration}
            photo={aircraft.photo}
            placeholder={aircraft.placeholder}
            canEdit={!readOnly}
            onChange={(p) => onSaved({ ...latestAircraft.current, photo: p })}
          />
          <div className="ac-title">
            <h1 className="mono" ref={titleRef}>
              {draft.registration || 'New aircraft'}
            </h1>
            <span className="ac-sub">
              {[draft.makeModel, draft.icaoType && `${draft.icaoType}/${draft.wake}`, draft.operator]
                .filter(Boolean)
                .join(' · ') || 'Type not set'}
            </span>
            {isDefault && <Chip tone="ok">Default</Chip>}
            <SharedChip access={aircraft.access} />
            {warnings.length > 0 && (
              <span className="ac-warn">
                <button
                  type="button"
                  className="ac-warn-btn"
                  onClick={() => setShowWarnings((v) => !v)}
                  aria-expanded={showWarnings}
                  data-testid="warnings-toggle"
                >
                  <Chip tone="warn">
                    {warnings.length} warning{warnings.length > 1 ? 's' : ''}
                  </Chip>
                </button>
                {showWarnings && (
                  <ul className="issue-pop below" data-testid="issue-pop">
                    {warnings.map((i, k) => (
                      <li key={k} className={i.level}>
                        <button type="button" className="issue-go" onClick={() => goTo(i)} data-testid="issue-go">
                          <span className="sec">{sectionLabel(i.section)}</span>
                          <span className="msg">{i.message}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </span>
            )}
            {!readOnly && <SaveStatus status={autosave.status} blocked={blocked} />}
          </div>
          <span className="spacer" />
          <button type="button" onClick={() => setSharing(true)} data-testid="share-aircraft">
            Share
          </button>
          <KebabMenu
            label="Aircraft actions"
            items={[
              ...(isDefault ? [] : [{ label: 'Make default aircraft', onSelect: () => void makeDefault() }]),
              role === 'owner'
                ? { label: 'Delete aircraft', onSelect: () => setDeleting(true), danger: true, separator: !isDefault }
                : {
                    label: 'Remove from my hangar',
                    onSelect: () => setLeaving(true),
                    danger: true,
                    separator: !isDefault,
                  },
            ]}
          />
        </div>
      </div>

      <div className="ac-layout">
        <nav className="ac-nav" aria-label="Sections" data-testid="section-nav">
          <div
            className={'ac-nav-reg mono' + (titleGone ? ' shown' : '')}
            aria-hidden={!titleGone}
            data-testid="nav-registration"
          >
            {draft.registration || 'New aircraft'}
          </div>
          {SECTIONS.map((s) => {
            const c = counts(s.id);
            const on = spy.active === s.id;
            return (
              <a
                key={s.id}
                href={`#${s.id}`}
                className={on ? 'active' : undefined}
                aria-current={on ? 'location' : undefined}
                onClick={(e) => {
                  e.preventDefault();
                  spy.go(s.id);
                }}
              >
                <span>{s.label}</span>
                {c.e > 0 ? (
                  <Chip tone="danger" count sm title={`${c.e} error${c.e > 1 ? 's' : ''}`}>
                    {c.e}
                  </Chip>
                ) : c.w > 0 ? (
                  <Chip tone="warn" count sm title={`${c.w} warning${c.w > 1 ? 's' : ''}`}>
                    {c.w}
                  </Chip>
                ) : null}
              </a>
            );
          })}
        </nav>
        <form
          className="ac-main"
          onSubmit={(e) => {
            e.preventDefault();
            autosave.flush();
          }}
          onBlur={() => autosave.flush()}
          noValidate
        >
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
          <HistorySection aircraftId={aircraft.id} version={aircraft.updatedAt} myId={pilot.id} />

          {readOnly ? (
            <div className="ac-viewonly card" data-testid="aircraft-viewonly">
              <Chip>View only</Chip>
              <span className="muted">Shared by {aircraft.access.owner.name || aircraft.access.owner.email}</span>
            </div>
          ) : errors.length > 0 ? (
            <div className="ac-problem card" role="region" aria-label="Not saved" data-testid="problem-bar">
              <span className="ac-problem-head">
                <Chip tone="danger">
                  {errors.length} error{errors.length > 1 ? 's' : ''}
                </Chip>
                {autosave.dirty && <span className="danger-text">Changes not saved</span>}
              </span>
              <ul className="ac-problem-list">
                {errors.map((i, k) => (
                  <li key={k}>
                    <button type="button" className="issue-go" onClick={() => goTo(i)} data-testid="issue-go">
                      <span className="sec">{sectionLabel(i.section)}</span>
                      <span className="msg">{i.message}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : saveError ? (
            <div className="ac-problem card" role="alert" data-testid="problem-bar">
              <span className="ac-problem-head">
                <span className="danger-text">
                  {saveError instanceof ApiRequestError && saveError.offline
                    ? 'Offline: changes not saved yet'
                    : `Not saved: ${errorMessage(saveError)}`}
                </span>
              </span>
              <span className="spacer" />
              {duplicate && (
                <button
                  type="button"
                  className="ghost sm"
                  onClick={() => goTo({ path: 'registration', section: 'identity' })}
                >
                  Registration
                </button>
              )}
              <button type="button" className="sm" onClick={autosave.retry} data-testid="save-retry">
                Retry
              </button>
            </div>
          ) : null}
        </form>
      </div>

      {sharing && (
        <ShareDialog
          id={aircraft.id}
          name={aircraft.registration}
          onClose={() => setSharing(false)}
          onLeft={() => {
            if (isDefault) setPilot({ ...pilot, defaultAircraftId: null });
            toast(`Removed ${aircraft.registration} from your hangar`);
            void navigate('/hangar');
          }}
        />
      )}
      {leaving && (
        <ConfirmDialog
          title={`Remove ${aircraft.registration} from your hangar?`}
          confirmLabel="Remove"
          onClose={() => setLeaving(false)}
          onConfirm={async () => {
            await api.shares.remove(aircraft.id, pilot.id);
            if (isDefault) setPilot({ ...pilot, defaultAircraftId: null });
            toast(`Removed ${aircraft.registration} from your hangar`);
            void navigate('/hangar');
          }}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${aircraft.registration}?`}
          confirmLabel="Delete"
          onClose={() => setDeleting(false)}
          onConfirm={async () => {
            await api.aircraft.remove(aircraft.id);
            if (isDefault) setPilot({ ...pilot, defaultAircraftId: null });
            toast(`Deleted ${aircraft.registration}`);
            void navigate('/hangar');
          }}
        />
      )}
    </div>
  );
}
