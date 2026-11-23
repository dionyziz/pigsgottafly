import { type ReactNode, type Ref, useEffect, useLayoutEffect, useRef } from 'react';

import type { MapLayers } from '../../../shared/mapLayers';
import { Check, CloseButton, Icon } from '../../../ui';
import { MapLayerToggles } from './MapLayerToggles';

export type DrawMode = 'idle' | 'draw' | 'custom';

export function MapToolbar({
  mode,
  hasRoute,
  onMode,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onFit,
  readOnly,
  drawLocked,
}: {
  mode: DrawMode;
  /** Only "zoom to the route" (a flight shared as a viewer). */
  readOnly?: boolean;
  /** A local flight: nothing to draw until Local flight is unticked. */
  drawLocked?: boolean;
  hasRoute: boolean;
  onMode: (m: DrawMode) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  onFit: () => void;
}) {
  if (readOnly)
    return (
      <div className="pgf-map-toolbar" role="toolbar" aria-label="Route tools">
        <ToolButton onClick={onFit} disabled={!hasRoute} title="Zoom to the route" testid="map-fit">
          <IconFit />
        </ToolButton>
      </div>
    );
  return (
    <div className="pgf-map-toolbar" role="toolbar" aria-label="Route tools">
      <ToolButton
        active={mode === 'draw'}
        onClick={() => onMode(mode === 'draw' ? 'idle' : 'draw')}
        disabled={drawLocked}
        title={drawLocked ? 'A local flight has no route to draw' : 'Draw route (D)'}
        testid="map-draw"
      >
        <IconPen /> <span>{hasRoute ? 'Extend' : 'Draw'}</span>
      </ToolButton>
      <ToolButton
        active={mode === 'custom'}
        onClick={() => onMode(mode === 'custom' ? 'idle' : 'custom')}
        disabled={drawLocked}
        title={
          drawLocked
            ? 'A local flight has no route to draw'
            : 'Place a custom named point (W, or Shift-click while drawing)'
        }
        testid="map-custom"
      >
        <IconPin /> <span>Custom point</span>
      </ToolButton>
      <span className="pgf-map-sep" />
      <ToolButton onClick={() => onUndo?.()} disabled={!canUndo} title="Undo (⌘Z)" testid="map-undo">
        <Icon name="undo" size={18} />
      </ToolButton>
      <ToolButton onClick={() => onRedo?.()} disabled={!canRedo} title="Redo (⇧⌘Z)" testid="map-redo">
        <Icon name="redo" size={18} />
      </ToolButton>
      <span className="pgf-map-sep" />
      <ToolButton onClick={onFit} disabled={!hasRoute} title="Zoom to the route" testid="map-fit">
        <IconFit />
      </ToolButton>
    </div>
  );
}

function ToolButton({
  children,
  onClick,
  title,
  active,
  disabled,
  testid,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
  testid?: string;
}) {
  return (
    <button
      type="button"
      className={'pgf-map-btn' + (active ? ' is-active' : '')}
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      disabled={disabled}
      data-testid={testid}
    >
      {children}
    </button>
  );
}

export function LayersControl({
  open,
  onOpen,
  layers,
  onLayers,
  tips,
  onTips,
  airac,
  areaCount,
  notamCount,
}: {
  open: boolean;
  onOpen: (open: boolean) => void;
  layers: MapLayers;
  onLayers: (l: MapLayers) => void;
  tips: boolean;
  onTips: (v: boolean) => void;
  airac: string;
  areaCount: { prd: number; mil: number; act: number };
  notamCount: number;
}) {
  // the popover closes on any press outside it (the map included)
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (el.current && !el.current.contains(e.target as Node)) onOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open, onOpen]);
  // the popover scrolls inside the map (above the navlog strip)
  useLayoutEffect(() => {
    const host = el.current?.closest('.pgf-map');
    if (!open || !host) return;
    const fit = () => {
      const pop = el.current?.querySelector<HTMLElement>('.pgf-map-pop');
      if (pop)
        pop.style.maxHeight = `${Math.max(160, host.getBoundingClientRect().bottom - pop.getBoundingClientRect().top - 12)}px`;
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit);
    ro.observe(host);
    return () => ro.disconnect();
  }, [open]);
  return (
    <div className="pgf-map-layers" ref={el}>
      <button
        type="button"
        className={'pgf-map-btn' + (open ? ' is-active' : '')}
        onClick={() => onOpen(!open)}
        title="Map layers"
        aria-expanded={open}
        data-testid="map-layers"
      >
        <IconLayers />
      </button>
      {open && (
        <div className="pgf-map-pop" role="dialog" aria-label="Map layers">
          <MapLayerToggles
            value={layers}
            onChange={onLayers}
            counts={{ ...areaCount, notams: notamCount }}
            extra={
              <div className="pgf-layers-group pgf-layers-sep">
                <Check checked={tips} onChange={onTips} testId="map-tips">
                  Editing tips
                </Check>
              </div>
            }
          />
          <div className="pgf-map-airac muted">AIRAC {airac}</div>
          <div className="pgf-legend">
            <span>
              <i className="lg-fir" /> FIR
            </span>
            <span>
              <i className="lg-tma" /> TMA
            </span>
            <span>
              <i className="lg-mtma" /> MTMA
            </span>
            <span>
              <i className="lg-zone" /> CTR
            </span>
            <span>
              <i className="lg-atz" /> ATZ
            </span>
            <span>
              <i className="lg-zone-g" /> Class G zone
            </span>
            <span>
              <i className="lg-p" /> Prohibited
            </span>
            <span>
              <i className="lg-r" /> Restricted
            </span>
            <span>
              <i className="lg-d" /> Danger
            </span>
            <span>
              <i className="lg-mil" /> Military
            </span>
            <span>
              <i className="lg-act" /> Local flying
            </span>
            <span>
              <i className="lg-vfr" /> VFR route
            </span>
            <span>
              <i className="lg-hel" /> Helicopter route
            </span>
            <span>
              <i className="lg-milroute" /> Military route
            </span>
            <span>
              <i className="lg-route" /> Your route
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/** The editing hint (top left); it fades out while the cursor is near it (`away`), except near its close
 *  button, which stays visible and clickable. */
export function MapHint({
  text,
  away,
  onClose,
  hintRef,
}: {
  text: string;
  away: boolean;
  onClose: () => void;
  hintRef: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={hintRef} className={'pgf-map-hint' + (away ? ' is-away' : '')} data-testid="map-hint">
      <span>{text}</span>
      <CloseButton onClick={onClose} label="Hide tips" size={8} className="pgf-map-hint-x" testId="map-hint-close" />
    </div>
  );
}

// Icons the shared set does not have (24-unit stroke drawings)
const svg = (d: ReactNode) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {d}
  </svg>
);
const IconPen = () =>
  svg(
    <>
      <circle cx="5" cy="19" r="2" />
      <circle cx="19" cy="5" r="2" />
      <path d="M6.5 17.5 10 11l4 2 3.5-6.5" />
    </>,
  );
const IconPin = () =>
  svg(
    <>
      <path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21Z" />
      <path d="M10 10.5h4M12 8.5v4" />
    </>,
  );
const IconFit = () =>
  svg(
    <>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
      <path d="M8.5 15.5 12 9l3.5 6.5" />
    </>,
  );
const IconLayers = () =>
  svg(
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </>,
  );
