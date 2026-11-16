// The map's controls: the route toolbar (draw, custom point, undo/redo, zoom to the route), the layers
// button with its popover (base map, chart layers, ENR 5 areas, overlay, tips, NOTAM areas, legend) and
// the editing hint bubble.
import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import { Check, CloseButton, Icon, Segmented } from '../../../ui';
import { BASE_MAPS, type BaseMapId } from './style';
import type { MapPrefs } from './mapPrefs';

export type DrawMode = 'idle' | 'draw' | 'custom';

export function MapToolbar({ mode, hasRoute, onMode, onUndo, onRedo, canUndo, canRedo, onFit }: {
  mode: DrawMode;
  hasRoute: boolean;
  onMode(m: DrawMode): void;
  onUndo?(): void;
  onRedo?(): void;
  canUndo?: boolean;
  canRedo?: boolean;
  onFit(): void;
}) {
  return (
    <div className="pgf-map-toolbar" role="toolbar" aria-label="Route tools">
      <ToolButton active={mode === 'draw'} onClick={() => onMode(mode === 'draw' ? 'idle' : 'draw')} title="Draw route (D)" testid="map-draw">
        <IconPen /> <span>{hasRoute ? 'Extend' : 'Draw'}</span>
      </ToolButton>
      <ToolButton active={mode === 'custom'} onClick={() => onMode(mode === 'custom' ? 'idle' : 'custom')} title="Place a custom named point (W, or Shift-click while drawing)" testid="map-custom">
        <IconPin /> <span>Custom point</span>
      </ToolButton>
      <span className="pgf-map-sep" />
      <ToolButton onClick={() => onUndo?.()} disabled={!canUndo} title="Undo (⌘Z)" testid="map-undo"><Icon name="undo" size={18} /></ToolButton>
      <ToolButton onClick={() => onRedo?.()} disabled={!canRedo} title="Redo (⇧⌘Z)" testid="map-redo"><Icon name="redo" size={18} /></ToolButton>
      <span className="pgf-map-sep" />
      <ToolButton onClick={onFit} disabled={!hasRoute} title="Zoom to the route" testid="map-fit"><IconFit /></ToolButton>
    </div>
  );
}

function ToolButton({ children, onClick, title, active, disabled, testid }: { children: ReactNode; onClick(): void; title: string; active?: boolean; disabled?: boolean; testid?: string }) {
  return (
    <button type="button" className={'pgf-map-btn' + (active ? ' is-active' : '')} onClick={onClick} title={title} aria-label={title} aria-pressed={active} disabled={disabled} data-testid={testid}>
      {children}
    </button>
  );
}

export function LayersControl({ open, onOpen, prefs, onPrefs, airac, areaCount, notamCount }: {
  open: boolean;
  onOpen(open: boolean): void;
  prefs: MapPrefs;
  onPrefs(p: MapPrefs): void;
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
  const set = <K extends keyof MapPrefs>(k: K) => (v: MapPrefs[K]) => onPrefs({ ...prefs, [k]: v });
  const n = (v: number) => <span className="muted">{v}</span>;
  return (
    <div className="pgf-map-layers" ref={el}>
      <button type="button" className={'pgf-map-btn' + (open ? ' is-active' : '')} onClick={() => onOpen(!open)} title="Map layers" aria-expanded={open} data-testid="map-layers">
        <IconLayers />
      </button>
      {open && (
        <div className="pgf-map-pop" role="dialog" aria-label="Map layers">
          <div className="pgf-map-pop-h">Base map</div>
          <Segmented<BaseMapId> sm label="Base map" value={prefs.base} onChange={set('base')} testId="map-base"
            options={BASE_MAPS.map((b) => ({ value: b.id, label: b.label }))} />
          <Check checked={prefs.chart} onChange={set('chart')} testId="map-chart">Chart layers <span className="muted">AIRAC {airac}</span></Check>
          <div className="pgf-map-pop-sub" role="group" aria-label="AIP ENR 5 areas">
            <Check checked={prefs.prd} disabled={!prefs.chart} onChange={set('prd')} testId="map-areas-prd">Prohibited, restricted, danger {n(areaCount.prd)}</Check>
            <Check checked={prefs.mil} disabled={!prefs.chart} onChange={set('mil')} testId="map-areas-mil">Military training areas {n(areaCount.mil)}</Check>
            <Check checked={prefs.act} disabled={!prefs.chart} onChange={set('act')} testId="map-areas-act">Local flying areas {n(areaCount.act)}</Check>
          </div>
          <Check checked={prefs.ofm} onChange={set('ofm')} testId="map-ofm">openflightmaps overlay</Check>
          <Check checked={prefs.tips} onChange={set('tips')} testId="map-tips">Editing tips</Check>
          <Check checked={prefs.notams} onChange={set('notams')} testId="map-notams">NOTAM areas {notamCount ? n(notamCount) : null}</Check>
          <div className="pgf-legend">
            <span><i className="lg-tma" /> TMA</span><span><i className="lg-mtma" /> MTMA</span><span><i className="lg-zone" /> CTR</span><span><i className="lg-atz" /> ATZ</span><span><i className="lg-zone-g" /> Class G zone</span>
            <span><i className="lg-p" /> Prohibited</span><span><i className="lg-r" /> Restricted</span><span><i className="lg-d" /> Danger</span><span><i className="lg-mil" /> Military</span><span><i className="lg-act" /> Local flying</span>
            <span><i className="lg-vfr" /> VFR route</span><span><i className="lg-route" /> Your route</span>
          </div>
        </div>
      )}
    </div>
  );
}

/** The editing hint (top left); it fades out while the cursor is near it (`away`). */
export function MapHint({ text, away, onClose, hintRef }: { text: string; away: boolean; onClose(): void; hintRef: Ref<HTMLDivElement> }) {
  return (
    <div ref={hintRef} className={'pgf-map-hint' + (away ? ' is-away' : '')} data-testid="map-hint">
      <span>{text}</span>
      <CloseButton onClick={onClose} label="Hide tips" size={8} className="pgf-map-hint-x" testId="map-hint-close" />
    </div>
  );
}

// Icons the shared set does not have (24-unit stroke drawings)
const svg = (d: ReactNode) => <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;
const IconPen = () => svg(<><circle cx="5" cy="19" r="2" /><circle cx="19" cy="5" r="2" /><path d="M6.5 17.5 10 11l4 2 3.5-6.5" /></>);
const IconPin = () => svg(<><path d="M12 21s-6-5.6-6-10.5a6 6 0 0 1 12 0C18 15.4 12 21 12 21Z" /><path d="M10 10.5h4M12 8.5v4" /></>);
const IconFit = () => svg(<><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /><path d="M8.5 15.5 12 9l3.5 6.5" /></>);
const IconLayers = () => svg(<><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>);
