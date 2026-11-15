// Small UI pieces shared by the lobby and the account list pages (profile, passengers, waypoints):
// a modal dialog, a ⋮ menu, a route thumbnail and an empty state. Styles in lists.css.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import './lists.css';

/** Modal dialog. Escape or a click on the backdrop closes it (unless `busy`). */
export function Dialog({ title, onClose, children, footer, busy, wide, testId }: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  wide?: boolean;
  testId?: string;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose, busy]);
  useEffect(() => {
    const first = box.current?.querySelector<HTMLElement>('[data-autofocus]') ?? box.current?.querySelector<HTMLElement>('.dlg-body input, .dlg-body select, .dlg-body textarea, button');
    first?.focus();
  }, []);
  return (
    <div className="dlg-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div className={'dlg card' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-labelledby={id} ref={box} data-testid={testId}>
        <div className="dlg-head"><h2 id={id}>{title}</h2></div>
        <div className="dlg-body">{children}</div>
        {footer && <div className="dlg-foot">{footer}</div>}
      </div>
    </div>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  /** Draw a separator above this item. */
  separator?: boolean;
}

/** ⋮ button with a dropdown menu. */
export function KebabMenu({ items, label = 'More actions' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);
  return (
    <div className="menu-wrap kebab" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className="icon" aria-label={label} aria-haspopup="menu" aria-expanded={open} title={label}
        onClick={(e) => { e.preventDefault(); setOpen((o) => !o); }} data-testid="row-menu">
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="3.5" r="1.6" /><circle cx="9" cy="9" r="1.6" /><circle cx="9" cy="14.5" r="1.6" /></svg>
      </button>
      {open && (
        <div className="menu" role="menu">
          {items.map((it) => (
            <div key={it.label} style={{ display: 'contents' }}>
              {it.separator && <hr />}
              <button type="button" role="menuitem" className={it.danger ? 'danger' : ''} onClick={(e) => { e.preventDefault(); setOpen(false); it.onSelect(); }}>{it.label}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Route sketch from summary.route ([lat, lon] pairs), equirectangular with cos(lat) scaling. */
export function RouteThumb({ route, size = 44 }: { route: [number, number][]; size?: number }) {
  const pad = 5;
  if (route.length < 2) {
    return (
      <svg className="thumb" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={3} className="thumb-dot" />
      </svg>
    );
  }
  const k = Math.cos((route.reduce((s, p) => s + p[0], 0) / route.length) * Math.PI / 180);
  const xs = route.map((p) => p[1] * k), ys = route.map((p) => -p[0]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY, 1e-6);
  const s = (size - 2 * pad) / span;
  const ox = pad + ((size - 2 * pad) - (maxX - minX) * s) / 2, oy = pad + ((size - 2 * pad) - (maxY - minY) * s) / 2;
  const pts = route.map((_, i) => [ox + (xs[i] - minX) * s, oy + (ys[i] - minY) * s] as const);
  const closed = route[0][0] === route[route.length - 1][0] && route[0][1] === route[route.length - 1][1];
  return (
    <svg className="thumb" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <polyline points={pts.map((p) => p.join(',')).join(' ')} className="thumb-line" />
      <circle cx={pts[0][0]} cy={pts[0][1]} r={2.6} className="thumb-start" />
      {!closed && <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r={2.6} className="thumb-end" />}
    </svg>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty card">
      <h3>{title}</h3>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

/** Confirmation dialog for destructive actions. */
export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onClose }: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    setBusy(true);
    try { await onConfirm(); onClose(); } catch (e) { setError(String((e as Error).message || e)); setBusy(false); }
  };
  return (
    <Dialog title={title} onClose={onClose} busy={busy} footer={<>
      <button type="button" className="ghost" onClick={onClose} disabled={busy}>Cancel</button>
      <button type="button" className="primary danger-fill" onClick={go} disabled={busy} data-autofocus>{confirmLabel}</button>
    </>}>
      <div className="muted">{children}</div>
      {error && <p className="form-error">{error}</p>}
    </Dialog>
  );
}
