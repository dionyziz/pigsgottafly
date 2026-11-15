// One icon set (16-unit stroke drawings, currentColor) and the close button built on it.
import type { CSSProperties } from 'react';

interface Glyph { d: string; sw?: number; fill?: boolean }

const GLYPHS = {
  up: { d: 'M4 10l4-4 4 4' },
  down: { d: 'M4 6l4 4 4-4' },
  left: { d: 'M10 4 6 8l4 4' },
  right: { d: 'M6 4l4 4-4 4' },
  /** Back arrow of a page header. */
  back: { d: 'M10 2.7 4.7 8l5.3 5.3', sw: 1.6 },
  /** Section caret (rotated by CSS when collapsed). */
  caret: { d: 'M4 6l4 4 4-4', sw: 1.6 },
  x: { d: 'M4.5 4.5l7 7M11.5 4.5l-7 7' },
  /** The close/remove cross, filling the box (the old XIcon). */
  close: { d: 'M2.4 2.4l11.2 11.2M13.6 2.4 2.4 13.6', sw: 2.56 },
  plus: { d: 'M8 3.5v9M3.5 8h9' },
  check: { d: 'M3.5 8.5l3 3 6-7' },
  refresh: { d: 'M12.5 6.5A4.75 4.75 0 1 0 12.8 9.5M12.5 3v3.5H9' },
  undo: { d: 'M5.5 4 2.5 7l3 3M3 7h6.5a3.5 3.5 0 0 1 0 7H8' },
  redo: { d: 'M10.5 4l3 3-3 3M13 7H6.5a3.5 3.5 0 0 0 0 7H8' },
  edit: { d: 'M10.5 3.5l2 2L6 12H4v-2z' },
  trash: { d: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4' },
  external: { d: 'M9 3h4v4M13 3 7.5 8.5M11 9.5V13H3V5h3.5' },
  warn: { d: 'M8 2.5 14 13H2zM8 6.5v3M8 11.2v.1' },
  info: { d: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7.5v4M8 5v.1' },
  print: { d: 'M4.5 6V2.5h7V6M4.5 11.5H3V6h10v5.5h-1.5M4.5 9.5h7v4h-7z' },
  search: { d: 'M7 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM11 11l3.5 3.5', sw: 1.6 },
  calendar: { d: 'M3.5 3h9A1.5 1.5 0 0 1 14 4.5v8a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 12.5v-8A1.5 1.5 0 0 1 3.5 3zM2 6.5h12M5.5 1.5v3M10.5 1.5v3' },
  file: { d: 'M4 1.5h5.5l3 3v10h-8.5zM9.5 1.5v3h3' },
  upload: { d: 'M8 10.5V2.5M4.5 6 8 2.5 11.5 6M3 11v2.5h10V11' },
  download: { d: 'M8 2.5v8M4.5 7 8 10.5 11.5 7M3 11v2.5h10V11' },
  /** Drag handle: two columns of dots. */
  grip: { d: 'M6 3.5h.01M10 3.5h.01M6 8h.01M10 8h.01M6 12.5h.01M10 12.5h.01', sw: 2.4 },
  /** ⋮ */
  kebab: { d: 'M8 3.1h.01M8 8h.01M8 12.9h.01', sw: 2.85 },
} satisfies Record<string, Glyph>;

export type IconName = keyof typeof GLYPHS;
export const ICON_NAMES = Object.keys(GLYPHS) as IconName[];

export function Icon({ name, size = 16, className, style, title }: { name: IconName; size?: number; className?: string; style?: CSSProperties; title?: string }) {
  const g: Glyph = GLYPHS[name];
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" className={'ui-icon' + (className ? ' ' + className : '')} style={style}
      aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title}
      fill="none" stroke="currentColor" strokeWidth={g.sw ?? 1.5} strokeLinecap="round" strokeLinejoin="round">
      <path d={g.d} />
    </svg>
  );
}

/** Square icon button with the close cross. `label` is its accessible name. */
export function CloseButton({ onClick, label = 'Close', size = 10, className, testId, disabled }: {
  onClick: () => void; label?: string; size?: number; className?: string; testId?: string; disabled?: boolean;
}) {
  return (
    <button type="button" className={'icon close-btn' + (className ? ' ' + className : '')} onClick={onClick} aria-label={label} title={label} data-testid={testId} disabled={disabled}>
      <Icon name="close" size={size} style={{ display: 'block' }} />
    </button>
  );
}

/** Icon button that removes a row; always named for assistive tech ("Remove Maria"). */
export function RowRemove({ onClick, label, disabled, testId, title }: { onClick: () => void; label: string; disabled?: boolean; testId?: string; title?: string }) {
  return (
    <button type="button" className="icon sm danger row-remove" onClick={onClick} disabled={disabled} aria-label={label} title={title ?? label} data-testid={testId}>
      <Icon name="x" size={14} />
    </button>
  );
}
