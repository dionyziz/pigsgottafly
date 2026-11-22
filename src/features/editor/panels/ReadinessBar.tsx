// The stage is remembered per flight in this tab. A new visit opens on Brief when the flight is today
// or tomorrow (the morning-of check), else on Plan. A focus request (a warning's Fix, a deep link) or a
// NOTAM picked on the map switches to the stage holding it.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

import { FlowLink } from '../../../app/FlowLinks';
import { focusParam } from '../../../app/focusParam';
import { api } from '../../../data/api';
import { flightStore } from '../../../data/flightStore';
import { useAsync } from '../../../data/useAsync';
import { Icon } from '../../../ui';
import { editorWarningFix, focusSection, onEditorFocus, sectionOf } from '../focus';
import { useNotams } from '../notams';
import { useEditor } from '../state';
import { useFlightCalc } from './calc';
import {
  type ItemState,
  PAPERWORK_KIND,
  picMissingOf,
  readiness,
  readinessWarnings,
  type ReadyItem,
  SECTION_STAGE,
  type Stage,
  STAGE_LABEL,
  STAGES,
  stageSummary,
} from './readiness';

const STATE_ICON: Record<ItemState, 'check' | 'warn' | 'info'> = {
  ok: 'check',
  todo: 'info',
  warn: 'warn',
  danger: 'warn',
};

/** The relevant NOTAMs, as one string: marking them read holds until this changes. */
function relevantSignature(keys: string[]): string {
  return [...keys].sort().join(',');
}
const readKey = (flightId: string) => `pgf.notamsRead.${flightId}`;
function loadRead(flightId: string): string | null {
  try {
    return localStorage.getItem(readKey(flightId));
  } catch {
    return null;
  }
}

export function useReadiness() {
  const { flight, doc, pilot } = useEditor();
  const { warnings } = useFlightCalc();
  const { briefing } = useNotams();
  const id = flight.id;
  const opts = (cache: string) => ({ cache, refetchOnFocus: true, invalidatedBy: 'flights' as const });
  const filing = useAsync(() => api.filing.get(id), [id], opts(`filing:${id}`));
  const forms = useAsync(() => api.forms.get(id), [id], opts(`forms:${id}`));
  const declarations = useAsync(() => api.declarations.get(id), [id], {
    ...opts(`declarations:${id}`),
    invalidatedBy: ['operators', 'aircraft', 'flights'],
  });

  const relevant = useMemo(
    () => relevantSignature((briefing?.notams ?? []).filter((n) => n.relevant).map((n) => n.key)),
    [briefing],
  );
  const [read, setRead] = useState(() => loadRead(id));
  const markNotamsRead = useCallback(() => {
    try {
      localStorage.setItem(readKey(id), relevant);
    } catch {
      /* private mode: read for this visit only */
    }
    setRead(relevant);
  }, [id, relevant]);

  const items = useMemo(
    () =>
      readiness({
        // a shared flight's PIC is its owner: their details are not the viewer's to add
        picMissing: flight.access ? [] : picMissingOf(doc.crew, pilot),
        routePoints: doc.route.length,
        hasAircraft: !!doc.aircraftId,
        warnings: readinessWarnings(warnings),
        notams: briefing,
        notamsRead: read === relevant,
        filing: filing.data ?? null,
        forms: forms.data ?? null,
        declarations: declarations.data ?? null,
      }),
    [
      flight.access,
      doc.crew,
      pilot,
      doc.route.length,
      doc.aircraftId,
      warnings,
      briefing,
      read,
      relevant,
      filing.data,
      forms.data,
      declarations.data,
    ],
  );
  return { items, markNotamsRead };
}

const stageKey = (flightId: string) => `pgf.editor.stage.${flightId}`;

export function useStage(): [Stage, (s: Stage) => void] {
  const { flight, doc } = useEditor();
  const [stage, setStageState] = useState<Stage>(() => {
    // a ?focus= deep link (an export's warning): the stage holding that field
    const linked = SECTION_STAGE[sectionOf(focusParam()) ?? ''];
    if (linked) return linked;
    try {
      const s = sessionStorage.getItem(stageKey(flight.id));
      if (s === 'plan' || s === 'brief') return s;
    } catch {
      /* no storage: the default */
    }
    const days = (Date.parse(`${doc.date}T00:00:00Z`) - Date.parse(new Date().toISOString().slice(0, 10))) / 864e5;
    return days >= 0 && days <= 1 ? 'brief' : 'plan';
  });
  const setStage = useCallback(
    (s: Stage) => {
      setStageState(s);
      try {
        sessionStorage.setItem(stageKey(flight.id), s);
      } catch {
        /* no storage: this visit only */
      }
    },
    [flight.id],
  );
  // a focus request (a warning's Fix, ?focus=) or a NOTAM picked on the map: its stage
  useEffect(
    () =>
      onEditorFocus((key) => {
        const st = SECTION_STAGE[sectionOf(key) ?? ''];
        if (st) setStage(st);
      }),
    [setStage],
  );
  const { selected } = useNotams();
  useEffect(() => {
    if (selected) setStage('brief');
  }, [selected, setStage]);
  return [stage, setStage];
}

function Row({ item, onMarkRead }: { item: ReadyItem; onMarkRead: () => void }) {
  const { doc } = useEditor();
  const fix = item.warning ? editorWarningFix(item.warning.text, doc.aircraftId) : null;
  return (
    <li className={'rd-row is-' + item.state} data-testid="ready-item" data-id={item.id} data-state={item.state}>
      <Icon name={STATE_ICON[item.state]} size={14} className="rd-icon" />
      <button type="button" className="rd-main" onClick={() => focusSection(item.section)}>
        <span className="rd-label">{item.label}</span>
        {item.text && <span className="rd-text">{item.text}</span>}
      </button>
      {item.id === 'notams' && item.state === 'todo' && item.text?.includes('to read') ? (
        <button type="button" className="linkish rd-act" onClick={onMarkRead} data-testid="notams-mark-read">
          Mark read
        </button>
      ) : item.link ? (
        <FlowLink className="rd-act" to={item.link.to}>
          {item.link.label} →
        </FlowLink>
      ) : fix ? (
        'to' in fix ? (
          <FlowLink className="rd-act" to={fix.to}>
            {fix.label} →
          </FlowLink>
        ) : (
          <button type="button" className="linkish rd-act" onClick={fix.onFix}>
            {fix.label} →
          </button>
        )
      ) : null}
    </li>
  );
}

export function ReadinessBar({ stage, onStage }: { stage: Stage; onStage: (s: Stage) => void }) {
  const { items, markNotamsRead } = useReadiness();
  const { flight } = useEditor();
  const navigate = useNavigate();
  const openItems = items.filter((x) => x.state !== 'ok');
  // File & forms opens on the first form that needs attention (else the flight plan)
  const openForms = (item?: ReadyItem) => {
    void flightStore.flushNow(); // the page loads the saved flight
    const first = item ?? openItems.find((x) => x.stage === 'file');
    void navigate(`/flights/${flight.id}/export/${(first && PAPERWORK_KIND[first.id]) || 'fpl'}`);
  };
  // the summary takes the pilot to the first thing left to do: its stage, its section (or its form)
  const goToFirst = () => {
    const first = STAGES.flatMap((s) => openItems.filter((x) => x.stage === s))[0];
    if (!first) return;
    if (first.stage === 'file') openForms(first);
    else {
      onStage(first.stage);
      focusSection(first.section);
    }
  };
  const open = openItems.length;
  const openNames = open <= 3 ? `: ${openItems.map((x) => x.label).join(', ')}` : '';
  const worst = STAGES.map((s) => stageSummary(items, s).state);
  const danger = worst.includes('danger');
  // the summary and the tabs stay at the top of the panel; the sections' sticky headers stop under them
  // (--rd-pinned on the panel, kept equal to their height)
  const pinned = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = pinned.current;
    const panel = el?.closest<HTMLElement>('.ep');
    if (!el || !panel) return;
    const set = () => panel.style.setProperty('--rd-pinned', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    // two siblings straight in the panel: a sticky element stays within its parent
    <>
      <div className="rd-pinned" ref={pinned} data-testid="readiness">
        <div
          className={'rd-head' + (open === 0 ? ' is-ok' : danger ? ' is-danger' : ' is-todo')}
          data-testid="ready-summary"
        >
          <Icon name={open === 0 ? 'check' : 'warn'} size={14} />
          {open === 0 ? (
            'Ready to fly'
          ) : (
            <button type="button" className="rd-head-go" onClick={goToFirst} data-testid="ready-go">
              {`${open} to do${openNames}`} →
            </button>
          )}
        </div>
        <div className="rd-tabs" role="tablist" aria-label="Stage">
          {STAGES.map((s) => {
            const sum = stageSummary(items, s);
            return (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={s === stage}
                className={'rd-tab is-' + sum.state}
                onClick={() => (s === 'file' ? openForms() : onStage(s))}
                data-testid={`stage-${s}`}
              >
                <span className="rd-dot" aria-hidden />
                {STAGE_LABEL[s]}
                {sum.open > 0 && <span className="rd-count tnum">{sum.open}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <ul className="rd-list" data-testid={`ready-${stage}`}>
        {items
          .filter((x) => x.stage === stage)
          .map((x) => (
            <Row key={x.id} item={x} onMarkRead={markNotamsRead} />
          ))}
      </ul>
    </>
  );
}
