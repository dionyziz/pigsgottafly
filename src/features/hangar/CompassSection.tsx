// Compass swing section: deviation cards (for / steer), swing and expiry dates, source, the swing
// report itself (PDF or image, stored with the aircraft), with a deviation curve and an expiry
// warning. The first card is the flights' default.
import { useEffect, useRef, useState } from 'react';
import { CARD_EXPIRY_WARN_DAYS } from '../../shared/constants';
import { ATTACHMENT_MAX_BYTES, ATTACHMENT_TYPES, type AttachmentRef, type AttachmentType, type CompassCard } from '../../shared/types';
import { api } from '../../data/api';
import { Field, IssueList, PointTable, Section } from './fields';
import { blankCardPoints, cardStatus, deviationOf, issuesAt } from './model';
import type { SectionProps } from './sections';

function addYears(d: string, n: number): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return '';
  return `${+m[1] + n}-${m[2]}-${m[3] === '29' && m[2] === '02' ? '28' : m[3]}`;
}

export function StatusChip({ card, today }: { card: Pick<CompassCard, 'expires'>; today: string }) {
  const st = cardStatus(card, today, CARD_EXPIRY_WARN_DAYS);
  if (st.state === 'unknown') return <span className="chip">No expiry date</span>;
  if (st.state === 'expired') return <span className="chip danger">Expired {card.expires}</span>;
  if (st.state === 'expiring') return <span className="chip warn">Expires in {st.days} days</span>;
  return <span className="chip ok">Valid to {card.expires}</span>;
}

function DeviationCurve({ points }: { points: [number, number][] }) {
  const pts = points.filter(([f, s]) => isFinite(f) && isFinite(s)).map(([f, s]) => [f, deviationOf(f, s)] as const).sort((a, b) => a[0] - b[0]);
  const W = 300, H = 120, L = 30, R = 8, T = 10, B = 22;
  const lim = Math.max(3, ...pts.map((p) => Math.ceil(Math.abs(p[1]))));
  const sx = (x: number) => L + (x / 360) * (W - L - R);
  const sy = (y: number) => T + (1 - (y + lim) / (2 * lim)) * (H - T - B);
  return (
    <svg className="dev-curve" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Deviation by heading: ${pts.map(([f, d]) => `${f}° ${d > 0 ? '+' : ''}${d}°`).join(', ')}`}>
      <rect x={L} y={T} width={W - L - R} height={H - T - B} className="plot-bg" />
      {[0, 90, 180, 270, 360].map((x) => <g key={x}><line x1={sx(x)} x2={sx(x)} y1={T} y2={H - B} className="grid" /><text x={sx(x)} y={H - 8} textAnchor="middle" className="tick">{x === 0 || x === 360 ? 'N' : x === 90 ? 'E' : x === 180 ? 'S' : 'W'}</text></g>)}
      {[-lim, 0, lim].map((y) => <g key={y}><line x1={L} x2={W - R} y1={sy(y)} y2={sy(y)} className={y === 0 ? 'zero' : 'grid'} /><text x={L - 4} y={sy(y) + 3} textAnchor="end" className="tick">{y > 0 ? '+' : ''}{y}°</text></g>)}
      {pts.length > 1 && <polyline points={[...pts, [pts[0][0] + 360, pts[0][1]] as const].map(([x, y]) => `${sx(x)},${sy(y)}`).join(' ')} className="dev-line" />}
      {pts.map(([x, y]) => <circle key={x} cx={sx(x)} cy={sy(y)} r={2.4} className="dev-pt" />)}
    </svg>
  );
}

const fmtSize = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** File → base64 (no data: prefix). */
function readBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result); resolve(s.slice(s.indexOf(',') + 1)); };
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
 * The swing report of one card: upload (PDF/PNG/JPEG/WebP up to 3 MB), download, image preview,
 * replace, remove. The upload is stored at once; the card's reference to it is saved with the
 * aircraft (files no saved card refers to are deleted by the server on the next save).
 */
export function SwingReport({ aircraftId, report, onChange }: { aircraftId: string | null; report: AttachmentRef | null | undefined; onChange(r: AttachmentRef | null): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => { setPreview(null); }, [report?.id]);

  const pick = async (file: File | undefined) => {
    if (!file || !aircraftId) return;
    setErr(null);
    if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) { setErr('Attach a PDF or an image (PNG, JPEG, WebP).'); return; }
    if (file.size > ATTACHMENT_MAX_BYTES) { setErr(`The file is ${fmtSize(file.size)}; the limit is ${fmtSize(ATTACHMENT_MAX_BYTES)}.`); return; }
    setBusy(true);
    try {
      const ref = await api.attachments.upload(aircraftId, { name: file.name, mime: file.type as AttachmentType, data: await readBase64(file) });
      onChange(ref);
    } catch (e) {
      setErr(`Upload failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  const load = async (): Promise<Blob | null> => {
    if (!aircraftId || !report) return null;
    setErr(null);
    try {
      const f = await api.attachments.get(aircraftId, report.id);
      return base64Blob(f.data, f.mime);
    } catch (e) {
      setErr(`Could not load the report: ${(e as Error).message}`);
      return null;
    }
  };
  const download = async () => {
    const b = await load();
    if (!b || !report) return;
    const url = URL.createObjectURL(b);
    const el = document.createElement('a');
    el.href = url;
    el.download = report.name;
    document.body.appendChild(el);
    el.click();
    el.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  const show = async () => {
    if (preview) { setPreview(null); return; }
    const b = await load();
    if (b) setPreview(URL.createObjectURL(b));
  };

  return (
    <div className="cc-report" data-testid="swing-report">
      <span className="cc-report-label">Swing report</span>
      {report ? (
        <div className="row wrap cc-report-row">
          <span className="cc-report-name" title={report.name}>{report.name}</span>
          <span className="muted">{report.mime === 'application/pdf' ? 'PDF' : 'image'} · {fmtSize(report.size)}</span>
          <span className="spacer" />
          {report.mime !== 'application/pdf' && <button type="button" className="ghost sm" onClick={show}>{preview ? 'Hide' : 'Preview'}</button>}
          <button type="button" className="ghost sm" onClick={download} data-testid="swing-report-download">Download</button>
          <button type="button" className="ghost sm" onClick={() => input.current?.click()} disabled={busy || !aircraftId}>Replace</button>
          <button type="button" className="ghost sm danger" onClick={() => onChange(null)}>Remove</button>
        </div>
      ) : (
        <div className="row wrap cc-report-row">
          <button type="button" className="sm" onClick={() => input.current?.click()} disabled={busy || !aircraftId} data-testid="swing-report-attach">
            {busy ? 'Uploading…' : 'Attach report'}
          </button>
          <span className="muted">{aircraftId ? `PDF or image, up to ${fmtSize(ATTACHMENT_MAX_BYTES)}` : 'Save the aircraft first'}</span>
        </div>
      )}
      <input ref={input} type="file" hidden accept={ATTACHMENT_TYPES.join(',')} onChange={(e) => void pick(e.target.files?.[0])} data-testid="swing-report-file" />
      {busy && report && <span className="muted">Uploading…</span>}
      {err && <span className="issue error" role="alert">{err}</span>}
      {preview && <img className="cc-report-img" src={preview} alt={`Compass swing report ${report?.name ?? ''}`} />}
    </div>
  );
}

export function CompassSection({ a, edit, issues, today, aircraftId = null }: SectionProps & { today: string; aircraftId?: string | null }) {
  const cards = a.compassCards;
  const cc = (i: number, fn: (c: CompassCard) => void) => edit((d) => fn(d.compassCards[i]));
  const add = () => edit((d) => {
    const names = new Set(d.compassCards.map((c) => c.name));
    const name = !names.has('Magnetic compass') ? 'Magnetic compass' : `Card ${d.compassCards.length + 1}`;
    d.compassCards.push({ name, swung: today, expires: addYears(today, 2), source: '', points: blankCardPoints() });
  });
  return (
    <Section id="compass" title="Compass swing" intro="Deviation cards from the compass swing report. The navigation log turns magnetic heading (for) into compass heading (steer) by interpolating the card. The first card is the default for new flights."
      actions={<button type="button" className="sm" onClick={add}>+ Add card</button>}>
      {cards.length === 0 && <p className="muted" style={{ margin: 0 }}>No cards. Without one, compass headings equal magnetic headings on the navigation log.</p>}
      {cards.map((c, i) => {
        const p = `compassCards.${i}`;
        return (
          <div className="compass-card" key={i}>
            <div className="row wrap cc-head">
              <input className="cc-name" value={c.name} aria-label="Card name" onChange={(e) => { const v = e.target.value; cc(i, (x) => { x.name = v; }); }} placeholder="e.g. Magnetic compass" />
              {i === 0 && cards.length > 1 && <span className="chip">Default</span>}
              <StatusChip card={c} today={today} />
              <span className="spacer" />
              {i > 0 && <button type="button" className="ghost sm" onClick={() => edit((d) => { const [x] = d.compassCards.splice(i, 1); d.compassCards.unshift(x); })}>Make default</button>}
              <button type="button" className="ghost sm danger" onClick={() => edit((d) => { d.compassCards.splice(i, 1); })}>Remove card</button>
            </div>
            <div className="grid3">
              <Field label="Swung" issues={issuesAt(issues, `${p}.swung`, true)}>
                <input type="date" value={c.swung} onChange={(e) => { const v = e.target.value; cc(i, (x) => { x.swung = v; }); }} />
              </Field>
              <Field label="Expires" issues={issuesAt(issues, `${p}.expires`, true)} hint={c.swung ? <button type="button" className="link" onClick={() => cc(i, (x) => { x.expires = addYears(x.swung, 2); })}>Swung + 2 years</button> : undefined}>
                <input type="date" value={c.expires} onChange={(e) => { const v = e.target.value; cc(i, (x) => { x.expires = v; }); }} />
              </Field>
              <Field label="Reference" hint="Report number or who swung it">
                <input value={c.source} onChange={(e) => { const v = e.target.value; cc(i, (x) => { x.source = v; }); }} />
              </Field>
            </div>
            <SwingReport aircraftId={aircraftId} report={c.report}
              onChange={(r) => cc(i, (x) => { if (r) x.report = r; else delete x.report; })} />
            <div className="cc-body">
              <PointTable points={c.points} onChange={(pts) => cc(i, (x) => { x.points = pts; })}
                xLabel="For (MH)" xUnit="°" yLabel="Steer (CH)" yUnit="°" xProps={{ integer: false, min: 0, max: 359.9, width: 76 }} yProps={{ min: 0, max: 359.9, width: 76 }}
                extra={(q) => { const d = deviationOf(q[0], q[1]); return <span className={Math.abs(d) > 5 ? 'dev big' : 'dev'}>{d > 0 ? '+' : ''}{Math.round(d * 10) / 10}°</span>; }} extraLabel="Dev"
                addPoint={(pts) => { const last = pts[pts.length - 1]; const f = last ? (last[0] + 30) % 360 : 0; return [f, f]; }}
                caption="Deviation = steer − for" minRows={0} />
              <DeviationCurve points={c.points} />
            </div>
            <IssueList issues={issuesAt(issues, p).filter((x) => !/\.(swung|expires)$/.test(x.path))} />
          </div>
        );
      })}
    </Section>
  );
}
