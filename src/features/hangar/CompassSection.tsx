// Compass swing section: deviation cards (for / steer), swing and expiry dates, source, the swing
// report itself (PDF or image, stored with the aircraft), with a deviation curve and an expiry
// warning. The first card is the flights' default.
import { useState } from 'react';

import { DateInput } from '../../app/DateInput';
import { saveBlob } from '../../data/aircraftFiles';
import { api } from '../../data/api';
import { CARD_EXPIRY_WARN_DAYS } from '../../shared/constants';
import { errorMessage, fmtSize } from '../../shared/format';
import { moveAt } from '../../shared/list';
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_TYPES,
  type AttachmentRef,
  type AttachmentType,
  type CompassCard,
} from '../../shared/types';
import { Chip, DragHandle, Field, FilePicker, IssueList, PdfViewer, useObjectUrl, useSortable } from '../../ui';
import { PointTable, Section } from './fields';
import { addCompassCard, addYears, cardStatus, deviationOf, issuesAt } from './model';
import type { SectionProps } from './sections';

export function StatusChip({ card, today }: { card: Pick<CompassCard, 'expires'>; today: string }) {
  const st = cardStatus(card, today, CARD_EXPIRY_WARN_DAYS);
  if (st.state === 'unknown') return <Chip>No expiry date</Chip>;
  if (st.state === 'expired') return <Chip tone="danger">Expired {card.expires}</Chip>;
  if (st.state === 'expiring') return <Chip tone="warn">Expires in {st.days} days</Chip>;
  return <Chip tone="ok">Valid to {card.expires}</Chip>;
}

function DeviationCurve({ points }: { points: [number, number][] }) {
  const pts = points
    .filter(([f, s]) => isFinite(f) && isFinite(s))
    .map(([f, s]) => [f, deviationOf(f, s)] as const)
    .sort((a, b) => a[0] - b[0]);
  const W = 300,
    H = 120,
    L = 30,
    R = 8,
    T = 10,
    B = 22;
  const lim = Math.max(3, ...pts.map((p) => Math.ceil(Math.abs(p[1]))));
  const sx = (x: number) => L + (x / 360) * (W - L - R);
  const sy = (y: number) => T + (1 - (y + lim) / (2 * lim)) * (H - T - B);
  return (
    <svg
      className="dev-curve"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Deviation by heading: ${pts.map(([f, d]) => `${f}° ${d > 0 ? '+' : ''}${d}°`).join(', ')}`}
    >
      <rect x={L} y={T} width={W - L - R} height={H - T - B} className="plot-bg" />
      {[0, 90, 180, 270, 360].map((x) => (
        <g key={x}>
          <line x1={sx(x)} x2={sx(x)} y1={T} y2={H - B} className="grid" />
          <text x={sx(x)} y={H - 8} textAnchor="middle" className="tick">
            {x === 0 || x === 360 ? 'N' : x === 90 ? 'E' : x === 180 ? 'S' : 'W'}
          </text>
        </g>
      ))}
      {[-lim, 0, lim].map((y) => (
        <g key={y}>
          <line x1={L} x2={W - R} y1={sy(y)} y2={sy(y)} className={y === 0 ? 'zero' : 'grid'} />
          <text x={L - 4} y={sy(y) + 3} textAnchor="end" className="tick">
            {y > 0 ? '+' : ''}
            {y}°
          </text>
        </g>
      ))}
      {pts.length > 1 && (
        <polyline
          points={[...pts, [pts[0][0] + 360, pts[0][1]] as const].map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')}
          className="dev-line"
        />
      )}
      {pts.map(([x, y]) => (
        <circle key={x} cx={sx(x)} cy={sy(y)} r={2.4} className="dev-pt" />
      ))}
    </svg>
  );
}

/** File → base64 (no data: prefix). */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = typeof r.result === 'string' ? r.result : '';
      resolve(s.slice(s.indexOf(',') + 1));
    };
    r.onerror = () => reject(r.error ?? new Error('could not read the file'));
    r.readAsDataURL(file);
  });
}
function base64Blob(data: string, mime: string): Blob {
  const bin = atob(data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * The swing report of one card: attach (PDF/PNG/JPEG/WebP up to 3 MB), open (a PDF in the viewer,
 * an image inline), download, replace, remove. The upload is stored at once; the card's reference
 * to it is saved with the aircraft (files no saved card refers to are deleted by the server on the
 * next save).
 */
export function SwingReport({
  aircraftId,
  report,
  onChange,
}: {
  aircraftId: string | null;
  report: AttachmentRef | null | undefined;
  onChange: (r: AttachmentRef | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // the report's content while it is shown (a PDF in the viewer, an image inline)
  const [shown, setShown] = useState<{ id: string; blob: Blob | null } | null>(null);
  const open = shown && report && shown.id === report.id ? shown : null;
  const isPdf = report?.mime === 'application/pdf';
  const imageUrl = useObjectUrl(open && !isPdf ? open.blob : null);

  const pick = async (file: File) => {
    if (!aircraftId) return;
    setErr(null);
    if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) {
      setErr('Attach a PDF or an image (PNG, JPEG, WebP).');
      return;
    }
    if (file.size > ATTACHMENT_MAX_BYTES) {
      setErr(`The file is ${fmtSize(file.size)}; the limit is ${fmtSize(ATTACHMENT_MAX_BYTES)}.`);
      return;
    }
    setBusy(true);
    try {
      const ref = await api.attachments.upload(aircraftId, {
        name: file.name,
        mime: file.type as AttachmentType,
        data: await readBase64(file),
      });
      onChange(ref);
    } catch (e) {
      setErr(`Upload failed: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const load = async (): Promise<Blob | null> => {
    if (!aircraftId || !report) return null;
    setErr(null);
    try {
      const f = await api.attachments.get(aircraftId, report.id);
      return base64Blob(f.data, f.mime);
    } catch (e) {
      setErr(`Could not load the report: ${errorMessage(e)}`);
      return null;
    }
  };
  const download = async () => {
    const b = open?.blob ?? (await load());
    if (b && report) saveBlob(b, report.name);
  };
  const show = async () => {
    if (!report) return;
    if (open && !isPdf) {
      setShown(null);
      return;
    }
    const id = report.id;
    setShown({ id, blob: null });
    const b = await load();
    setShown((s) => (s && s.id === id ? (b ? { id, blob: b } : isPdf ? s : null) : s));
  };

  return (
    <div className="cc-report" data-testid="swing-report">
      <span className="cc-report-label">Swing report</span>
      {report ? (
        <div className="row wrap cc-report-row">
          <span className="cc-report-name" title={report.name}>
            {report.name}
          </span>
          <span className="muted">
            {isPdf ? 'PDF' : 'image'} · {fmtSize(report.size)}
          </span>
          <span className="spacer" />
          <button type="button" className="sm" onClick={() => void show()} data-testid="swing-report-open">
            {open && !isPdf ? 'Hide' : 'Open'}
          </button>
          <button
            type="button"
            className="ghost sm"
            onClick={() => void download()}
            data-testid="swing-report-download"
          >
            Download
          </button>
          <FilePicker
            accept={ATTACHMENT_TYPES.join(',')}
            onPick={(f) => void pick(f)}
            disabled={busy || !aircraftId}
            className="ghost sm"
            inputTestId="swing-report-file"
          >
            Replace
          </FilePicker>
          <button
            type="button"
            className="ghost sm danger"
            onClick={() => {
              setShown(null);
              onChange(null);
            }}
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="row wrap cc-report-row">
          <FilePicker
            accept={ATTACHMENT_TYPES.join(',')}
            onPick={(f) => void pick(f)}
            disabled={busy || !aircraftId}
            testId="swing-report-attach"
            inputTestId="swing-report-file"
          >
            {busy ? 'Uploading…' : 'Attach report'}
          </FilePicker>
          <span className="muted">
            {aircraftId ? `PDF or image, up to ${fmtSize(ATTACHMENT_MAX_BYTES)}` : 'Save the aircraft first'}
          </span>
        </div>
      )}
      {busy && report && <span className="muted">Uploading…</span>}
      {err && !(open && isPdf) && (
        <span className="issue error" role="alert">
          {err}
        </span>
      )}
      {imageUrl && <img className="cc-report-img" src={imageUrl} alt={`Compass swing report ${report?.name ?? ''}`} />}
      {open && isPdf && report && (
        <PdfViewer
          src={open.blob}
          title={report.name}
          detail={fmtSize(report.size)}
          error={err}
          testId="swing-report-viewer"
          onClose={() => setShown(null)}
          onDownload={() => void download()}
        />
      )}
    </div>
  );
}

export function CompassSection({
  a,
  edit,
  issues,
  today,
  aircraftId = null,
}: SectionProps & { today: string; aircraftId?: string | null }) {
  const cards = a.compassCards;
  const cc = (i: number, fn: (c: CompassCard) => void) => edit((d) => fn(d.compassCards[i]));
  const add = () =>
    edit((d) => {
      addCompassCard(d, today);
    });
  const sort = useSortable({
    count: cards.length,
    onMove: (from, to) =>
      edit((d) => {
        d.compassCards = moveAt(d.compassCards, from, to);
      }),
  });
  return (
    <Section
      id="compass"
      title="Compass swing"
      actions={
        <button type="button" className="sm" onClick={add}>
          + Add card
        </button>
      }
    >
      {cards.length === 0 && (
        <p className="muted" style={{ margin: 0 }}>
          No cards.
        </p>
      )}
      {cards.map((c, i) => {
        const p = `compassCards.${i}`;
        return (
          <div key={i} {...sort.itemProps(i, 'compass-card')} data-testid="compass-card">
            <div className="row wrap cc-head">
              {cards.length > 1 && <DragHandle {...sort.handleProps(i)} label={`Move ${c.name || 'card'}`} />}
              <input
                name={`${p}.name`}
                className="cc-name"
                value={c.name}
                aria-label="Card name"
                onChange={(e) => {
                  const v = e.target.value;
                  cc(i, (x) => {
                    x.name = v;
                  });
                }}
                placeholder="e.g. Magnetic compass"
              />
              {i === 0 && cards.length > 1 && <Chip>Default</Chip>}
              <StatusChip card={c} today={today} />
              <span className="spacer" />
              {i > 0 && (
                <button
                  type="button"
                  className="ghost sm"
                  onClick={() =>
                    edit((d) => {
                      const [x] = d.compassCards.splice(i, 1);
                      d.compassCards.unshift(x);
                    })
                  }
                >
                  Make default
                </button>
              )}
              <button
                type="button"
                className="ghost sm danger"
                onClick={() =>
                  edit((d) => {
                    d.compassCards.splice(i, 1);
                  })
                }
              >
                Remove card
              </button>
            </div>
            <div className="grid3">
              <Field label="Swung" issues={issuesAt(issues, `${p}.swung`, true)}>
                <DateInput
                  name={`${p}.swung`}
                  value={c.swung}
                  onChange={(e) => {
                    const v = e.target.value;
                    cc(i, (x) => {
                      x.swung = v;
                    });
                  }}
                />
              </Field>
              <Field
                label="Expires"
                issues={issuesAt(issues, `${p}.expires`, true)}
                hint={
                  c.swung ? (
                    <button
                      type="button"
                      className="linkish"
                      onClick={() =>
                        cc(i, (x) => {
                          x.expires = addYears(x.swung, 2);
                        })
                      }
                    >
                      Swung + 2 years
                    </button>
                  ) : undefined
                }
              >
                <DateInput
                  name={`${p}.expires`}
                  value={c.expires}
                  onChange={(e) => {
                    const v = e.target.value;
                    cc(i, (x) => {
                      x.expires = v;
                    });
                  }}
                />
              </Field>
              <Field label="Reference">
                <input
                  value={c.source}
                  placeholder="optional"
                  onChange={(e) => {
                    const v = e.target.value;
                    cc(i, (x) => {
                      x.source = v;
                    });
                  }}
                />
              </Field>
            </div>
            <SwingReport
              aircraftId={aircraftId}
              report={c.report}
              onChange={(r) =>
                cc(i, (x) => {
                  if (r) x.report = r;
                  else delete x.report;
                })
              }
            />
            <div className="cc-body">
              <PointTable
                name={`${p}.points`}
                points={c.points}
                onChange={(pts) =>
                  cc(i, (x) => {
                    x.points = pts;
                  })
                }
                xLabel="For (MH)"
                xUnit="°"
                yLabel="Steer (CH)"
                yUnit="°"
                xProps={{ integer: false, min: 0, max: 359.9, width: 76 }}
                yProps={{ min: 0, max: 359.9, width: 76 }}
                extra={(q) => {
                  const d = deviationOf(q[0], q[1]);
                  return (
                    <span className={Math.abs(d) > 5 ? 'dev big' : 'dev'}>
                      {d > 0 ? '+' : ''}
                      {Math.round(d * 10) / 10}°
                    </span>
                  );
                }}
                extraLabel="Dev"
                addPoint={(pts) => {
                  const last = pts[pts.length - 1];
                  const f = last ? (last[0] + 30) % 360 : 0;
                  return [f, f];
                }}
                minRows={0}
              />
              <DeviationCurve points={c.points} />
            </div>
            <IssueList issues={issuesAt(issues, p).filter((x) => !/\.(swung|expires)$/.test(x.path))} />
          </div>
        );
      })}
    </Section>
  );
}
