// Mass & balance section: empty aircraft from the weighing report, MTOW/MLW, loading stations with
// their seat layout, combined limits, and the normal/utility CG and moment envelopes.
import { DateInput } from '../../app/DateInput';
import { useState } from 'react';
import { moveAt } from '../../shared/list';
import type { AircraftInput, Envelope, MassBalance, Station, StationKind, WbCategory } from '../../shared/types';
import { Check, DragHandle, Field, IssueList, RowRemove, useSortable } from '../../ui';
import { EnvelopeChart, type ChartSeries } from './EnvelopeChart';
import { NumInput, PointTable, Section } from './fields';
import {
  addCombinedLimit,
  addSeat,
  addStation,
  addUtilityEnvelope,
  issuesAt,
  momentPolygonFromCg,
  removeSeat,
  removeStation,
  setArmRange,
  setStationKind,
} from './model';
import type { SectionProps } from './sections';

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const KIND_LABEL: Record<StationKind, string> = { seat: 'Seats', baggage: 'Baggage', fuel: 'Fuel' };

export function MassBalanceSection({ a, edit, issues }: SectionProps) {
  const mb = a.massBalance;
  const at = (p: string) => issuesAt(issues, p, true);
  const bad = (p: string) => at(p).some((i) => i.level === 'error');
  const m = (fn: (q: AircraftInput['massBalance']) => void) => edit((d) => fn(d.massBalance));
  const product = r2(mb.emptyMassKg * mb.emptyArmM);
  return (
    <Section id="mb" title="Mass and balance">
      <div className="sub-h">Empty aircraft</div>
      <div className="grid3">
        <Field focus="emptyMassKg" label="Empty mass" issues={at('massBalance.emptyMassKg')}>
          <NumInput
            name="massBalance.emptyMassKg"
            value={mb.emptyMassKg}
            zeroAsEmpty
            min={0}
            max={1e6}
            unit="kg"
            placeholder="not set"
            invalid={bad('massBalance.emptyMassKg')}
            onChange={(v) =>
              m((q) => {
                q.emptyMassKg = v ?? 0;
                if (q.emptyArmM > 0) q.emptyMomentKgM = r2(q.emptyMassKg * q.emptyArmM);
              })
            }
          />
        </Field>
        <Field label="Empty CG arm" issues={at('massBalance.emptyArmM')}>
          <NumInput
            name="massBalance.emptyArmM"
            value={mb.emptyArmM}
            zeroAsEmpty
            min={-10}
            max={50}
            unit="m"
            placeholder="not set"
            onChange={(v) =>
              m((q) => {
                q.emptyArmM = v ?? 0;
                q.emptyMomentKgM = r2(q.emptyMassKg * q.emptyArmM);
              })
            }
          />
        </Field>
        <Field
          label="Empty moment"
          issues={at('massBalance.emptyMomentKgM')}
          hint={
            mb.emptyMassKg > 0 && mb.emptyArmM > 0 && Math.abs(product - mb.emptyMomentKgM) > 0.005 ? (
              <>
                mass × arm = {product}{' '}
                <button
                  type="button"
                  className="linkish"
                  onClick={() =>
                    m((q) => {
                      q.emptyMomentKgM = product;
                    })
                  }
                >
                  use
                </button>
              </>
            ) : undefined
          }
        >
          <NumInput
            name="massBalance.emptyMomentKgM"
            value={mb.emptyMomentKgM}
            zeroAsEmpty
            min={-1e6}
            max={1e7}
            unit="kg·m"
            placeholder="not set"
            onChange={(v) =>
              m((q) => {
                q.emptyMomentKgM = v ?? 0;
                if (q.emptyMassKg > 0) q.emptyArmM = r4(q.emptyMomentKgM / q.emptyMassKg);
              })
            }
          />
        </Field>
      </div>
      <div className="grid3">
        <Field label="Weighing date" issues={at('massBalance.weighingDate')}>
          <DateInput
            name="massBalance.weighingDate"
            value={mb.weighingDate ?? ''}
            onChange={(e) => {
              const v = e.target.value || null;
              m((q) => {
                q.weighingDate = v;
              });
            }}
          />
        </Field>
        <Field label="Weighing report" issues={at('massBalance.weighingSource')} wide>
          <input
            name="massBalance.weighingSource"
            value={mb.weighingSource}
            onChange={(e) => {
              const v = e.target.value;
              m((q) => {
                q.weighingSource = v;
              });
            }}
            maxLength={300}
          />
        </Field>
      </div>
      <div className="grid3">
        <Field label="Datum" issues={at('massBalance.datum')}>
          <input
            name="massBalance.datum"
            value={mb.datum}
            onChange={(e) => {
              const v = e.target.value;
              m((q) => {
                q.datum = v;
              });
            }}
            placeholder="e.g. Forward face of firewall"
          />
        </Field>
        <div className="checks-col">
          <span className="lbl">The empty mass includes</span>
          <Check
            checked={mb.includesOil}
            onChange={(v) =>
              m((q) => {
                q.includesOil = v;
              })
            }
          >
            Full oil
          </Check>
          <Check
            checked={a.fuel.unusableIncludedInEmptyMass}
            onChange={(v) =>
              edit((d) => {
                d.fuel.unusableIncludedInEmptyMass = v;
              })
            }
          >
            Unusable fuel ({a.fuel.unusableL} L)
          </Check>
        </div>
      </div>

      <div className="sub-h">Maximum masses</div>
      <div className="grid3">
        <Field label="MTOW" issues={at('massBalance.mtowKg')}>
          <NumInput
            name="massBalance.mtowKg"
            value={mb.mtowKg}
            zeroAsEmpty
            min={0}
            max={1e6}
            unit="kg"
            placeholder="not set"
            onChange={(v) =>
              m((q) => {
                q.mtowKg = v ?? 0;
              })
            }
          />
        </Field>
        <Field label="Max landing mass" issues={at('massBalance.mlwKg')} hint="Empty = MTOW">
          <NumInput
            name="massBalance.mlwKg"
            value={mb.mlwKg}
            optional
            min={0}
            max={1e6}
            unit="kg"
            onChange={(v) =>
              m((q) => {
                q.mlwKg = v;
              })
            }
          />
        </Field>
      </div>

      <Stations a={a} edit={edit} issues={issues} />
      <Envelopes a={a} edit={edit} issues={issues} />
    </Section>
  );
}

function Stations({ a, edit, issues }: SectionProps) {
  const mb = a.massBalance;
  const st = (i: number, fn: (s: Station) => void) => edit((d) => fn(d.massBalance.stations[i]));
  const m = (fn: (q: MassBalance) => void) => edit((d) => fn(d.massBalance));
  const stIssues = issuesAt(issues, 'massBalance.stations');
  const hasFuel = mb.stations.some((s) => s.kind === 'fuel');
  const na = (title: string) => (
    <span className="cell-na" title={title}>
      —
    </span>
  );
  const sort = useSortable({
    count: mb.stations.length,
    onMove: (from, to) =>
      m((q) => {
        q.stations = moveAt(q.stations, from, to);
      }),
  });
  return (
    <>
      <div className="sub-h">Loading stations and seats</div>
      <ArmRuler a={a} />
      <div className="tbl-wrap">
        <table className="ed-table stations">
          <colgroup>
            <col className="c-drag" />
            <col className="c-name" />
            <col className="c-kind" />
            <col className="c-arm" />
            <col className="c-range" />
            <col className="c-max" />
            <col className="c-seats" />
            <col className="c-tools" />
          </colgroup>
          <thead>
            <tr>
              <th />
              <th>Station</th>
              <th>Kind</th>
              <th className="num">
                Arm <span className="u">m</span>
              </th>
              <th className="num">
                Seat range <span className="u">m</span>
              </th>
              <th className="num">
                Max load <span className="u">kg</span>
              </th>
              <th>Seats</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {mb.stations.map((s, i) => (
              <tr key={s.id + i} {...sort.itemProps(i)}>
                <td className="drag">
                  <DragHandle {...sort.handleProps(i)} label={`Move ${s.name || 'station'}`} />
                </td>
                <td>
                  <input
                    name={`massBalance.stations.${i}.name`}
                    value={s.name}
                    onChange={(e) => {
                      const v = e.target.value;
                      st(i, (x) => {
                        x.name = v;
                      });
                    }}
                    aria-label="Station name"
                    className={issuesAt(issues, `massBalance.stations.${i}.name`, true).length ? 'invalid' : ''}
                  />
                </td>
                <td>
                  <select
                    value={s.kind}
                    aria-label="Station kind"
                    onChange={(e) => {
                      const k = e.target.value as StationKind;
                      m((q) => setStationKind(q, i, k));
                    }}
                  >
                    {(Object.keys(KIND_LABEL) as StationKind[]).map((k) => (
                      <option key={k} value={k}>
                        {KIND_LABEL[k]}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="num">
                  <NumInput
                    name={`massBalance.stations.${i}.armM`}
                    value={s.armM}
                    min={-10}
                    max={50}
                    ariaLabel={`Arm of ${s.name}`}
                    onChange={(v) =>
                      st(i, (x) => {
                        x.armM = v ?? 0;
                      })
                    }
                    invalid={issuesAt(issues, `massBalance.stations.${i}.armM`, true).length > 0}
                  />
                </td>
                <td className="num">
                  {s.kind === 'seat' ? (
                    <div className="range">
                      <NumInput
                        name={`massBalance.stations.${i}.armRangeM`}
                        value={s.armRangeM?.[0] ?? null}
                        optional
                        min={-10}
                        max={50}
                        ariaLabel="Seat range from"
                        onChange={(v) => st(i, (x) => setArmRange(x, 0, v))}
                      />
                      <span className="muted">–</span>
                      <NumInput
                        value={s.armRangeM?.[1] ?? null}
                        optional
                        min={-10}
                        max={50}
                        ariaLabel="Seat range to"
                        onChange={(v) => st(i, (x) => setArmRange(x, 1, v))}
                      />
                    </div>
                  ) : (
                    na('Seat stations only')
                  )}
                </td>
                <td className="num">
                  {s.kind === 'baggage' ? (
                    <NumInput
                      name={`massBalance.stations.${i}.maxKg`}
                      value={s.maxKg ?? null}
                      optional
                      min={0}
                      max={100000}
                      ariaLabel={`Max load of ${s.name}`}
                      onChange={(v) =>
                        st(i, (x) => {
                          x.maxKg = v;
                        })
                      }
                    />
                  ) : (
                    na('Baggage areas only')
                  )}
                </td>
                <td>
                  {s.kind === 'seat' ? (
                    <div className="seats">
                      {(s.seats || []).map((p, k) => (
                        <span className="seat" key={p.id}>
                          <input
                            name={k === 0 ? `massBalance.stations.${i}.seats` : undefined}
                            value={p.label}
                            aria-label={`Seat ${k + 1} of ${s.name}`}
                            onChange={(e) => {
                              const v = e.target.value;
                              st(i, (x) => {
                                x.seats![k].label = v;
                              });
                            }}
                          />
                          <RowRemove
                            label={`Remove seat ${p.label}`}
                            disabled={(s.seats || []).length <= 1}
                            onClick={() => m((q) => removeSeat(q, i, k))}
                          />
                        </span>
                      ))}
                      <button type="button" className="ghost sm add-seat" onClick={() => m((q) => addSeat(q, i))}>
                        + Seat
                      </button>
                    </div>
                  ) : (
                    na('Seat stations only')
                  )}
                </td>
                <td className="row-tools">
                  <RowRemove label={`Remove ${s.name || 'station'}`} onClick={() => m((q) => removeStation(q, i))} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row">
        <button
          type="button"
          className="ghost sm"
          onClick={() =>
            m((q) => {
              addStation(q, 'seat');
            })
          }
        >
          + Seat row
        </button>
        <button
          type="button"
          className="ghost sm"
          onClick={() =>
            m((q) => {
              addStation(q, 'baggage');
            })
          }
        >
          + Baggage area
        </button>
        {!hasFuel && (
          <button
            type="button"
            className="ghost sm"
            onClick={() =>
              m((q) => {
                addStation(q, 'fuel');
              })
            }
          >
            + Fuel
          </button>
        )}
        <span className="spacer" />
        <span className="hint">{mb.stations.flatMap((s) => s.seats || []).length} seats</span>
      </div>
      <IssueList issues={stIssues.filter((i) => !/\.(name|armM)$/.test(i.path))} />

      <div className="sub-h">Combined load limits</div>
      {mb.combinedLimits.map((c, i) => (
        <div className="row wrap combined" key={i} data-path={`massBalance.combinedLimits.${i}`}>
          {mb.stations
            .filter((s) => s.kind !== 'fuel')
            .map((s) => (
              <Check
                key={s.id}
                checked={c.stations.includes(s.id)}
                onChange={(v) =>
                  edit((d) => {
                    const cl = d.massBalance.combinedLimits[i];
                    cl.stations = v ? [...cl.stations, s.id] : cl.stations.filter((x) => x !== s.id);
                  })
                }
              >
                {s.name}
              </Check>
            ))}
          <span className="muted">together at most</span>
          <NumInput
            value={c.maxKg}
            min={0}
            max={100000}
            width={90}
            unit="kg"
            ariaLabel="Combined limit"
            onChange={(v) =>
              edit((d) => {
                d.massBalance.combinedLimits[i].maxKg = v ?? 0;
              })
            }
          />
          <RowRemove
            label="Remove limit"
            onClick={() =>
              edit((d) => {
                d.massBalance.combinedLimits.splice(i, 1);
              })
            }
          />
          <IssueList issues={issuesAt(issues, `massBalance.combinedLimits.${i}`, true)} />
        </div>
      ))}
      <div>
        <button type="button" className="ghost sm" onClick={() => m(addCombinedLimit)}>
          + Combined limit
        </button>
      </div>
    </>
  );
}

/** Side-view ruler of the station arms, with the empty CG and the envelope's CG range. */
function ArmRuler({ a }: { a: AircraftInput }) {
  const mb = a.massBalance;
  const items = mb.stations.filter((s) => isFinite(s.armM));
  const env = mb.envelopes.normal.polygon.map((p) => p[0]).filter(isFinite);
  const xs = [
    0,
    ...items.map((s) => s.armM),
    ...items.flatMap((s) => s.armRangeM || []),
    ...(mb.emptyArmM > 0 ? [mb.emptyArmM] : []),
    ...env,
  ];
  if (items.length === 0) return null;
  const lo = Math.min(...xs),
    hi = Math.max(...xs);
  const span = hi - lo || 1;
  const W = 720,
    L = 24,
    R = 24,
    y = 46;
  const sx = (x: number) => L + ((x - lo) / span) * (W - L - R);
  const step = span > 6 ? 1 : 0.5;
  const ticks: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) ticks.push(Math.round(v / step) * step);
  const sorted = items.map((s, i) => ({ s, i })).sort((p, q) => p.s.armM - q.s.armM);
  return (
    <svg
      className="arm-ruler"
      viewBox={`0 0 ${W} 100`}
      role="img"
      aria-label={`Station arms: ${items.map((s) => `${s.name} ${s.armM} m`).join(', ')}`}
    >
      {env.length > 1 && (
        <rect
          x={sx(Math.min(...env))}
          y={y - 7}
          width={Math.max(1, sx(Math.max(...env)) - sx(Math.min(...env)))}
          height={14}
          className="cg-band"
        />
      )}
      <line x1={L} x2={W - R} y1={y} y2={y} className="axis" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={sx(t)} x2={sx(t)} y1={y - 3} y2={y + 3} className="axis" />
          <text x={sx(t)} y={y + 16} textAnchor="middle" className="tick">
            {t}
          </text>
        </g>
      ))}
      {lo <= 0 && (
        <text x={sx(0)} y={y + 30} textAnchor="middle" className="tick">
          datum
        </text>
      )}
      {items
        .filter((s) => s.armRangeM)
        .map((s) => (
          <line
            key={'r' + s.id}
            x1={sx(s.armRangeM![0])}
            x2={sx(s.armRangeM![1])}
            y1={y - 12}
            y2={y - 12}
            className={'range ' + s.kind}
          />
        ))}
      {sorted.map(({ s }, k) => (
        <g key={s.id} className={'st ' + s.kind}>
          <circle cx={sx(s.armM)} cy={y} r={5} />
          <text x={sx(s.armM)} y={k % 2 ? y - 30 : y - 18} textAnchor="middle">
            {s.name.length > 22 ? s.name.slice(0, 21) + '…' : s.name}
          </text>
        </g>
      ))}
      {mb.emptyArmM > 0 && (
        <g className="empty-cg">
          <path d={`M${sx(mb.emptyArmM)},${y + 6} l5,8 h-10 z`} />
          <text x={sx(mb.emptyArmM)} y={y + 30} textAnchor="middle">
            empty CG
          </text>
        </g>
      )}
    </svg>
  );
}

function Envelopes({ a, edit, issues }: SectionProps) {
  const [tab, setTab] = useState<WbCategory>('normal');
  const mb = a.massBalance;
  const env = mb.envelopes[tab];
  const p = `massBalance.envelopes.${tab}`;
  const set = (fn: (e: Envelope) => void) =>
    edit((d) => {
      const e = d.massBalance.envelopes[tab];
      if (e) fn(e);
    });
  const series: ChartSeries[] = [
    { label: 'Normal', points: mb.envelopes.normal.polygon, kind: 'normal' },
    ...(mb.envelopes.utility
      ? [{ label: 'Utility', points: mb.envelopes.utility.polygon, kind: 'utility' as const }]
      : []),
  ];
  const mseries: ChartSeries[] = [
    ...(mb.envelopes.normal.momentPolygon?.length
      ? [{ label: 'Normal', points: mb.envelopes.normal.momentPolygon, kind: 'normal' as const }]
      : []),
    ...(mb.envelopes.utility?.momentPolygon?.length
      ? [{ label: 'Utility', points: mb.envelopes.utility.momentPolygon, kind: 'utility' as const }]
      : []),
  ];
  const emptyMarker =
    mb.emptyMassKg > 0 && mb.emptyArmM > 0
      ? [{ label: 'Empty', at: [mb.emptyArmM, mb.emptyMassKg] as [number, number] }]
      : [];
  const emptyMomentMarker =
    mb.emptyMassKg > 0 && mb.emptyMomentKgM > 0
      ? [{ label: 'Empty', at: [mb.emptyMomentKgM, mb.emptyMassKg] as [number, number] }]
      : [];
  const maxLine = mb.mtowKg > 0 ? { label: `MTOW ${mb.mtowKg} kg`, y: mb.mtowKg } : null;
  return (
    <>
      <div className="sub-h row">
        <span>Envelopes</span>
        <span className="spacer" />
        <div className="tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-pressed={tab === 'normal'}
            aria-selected={tab === 'normal'}
            onClick={() => setTab('normal')}
          >
            Normal
          </button>
          <button
            type="button"
            role="tab"
            aria-pressed={tab === 'utility'}
            aria-selected={tab === 'utility'}
            onClick={() => setTab('utility')}
          >
            Utility{!mb.envelopes.utility && ' (none)'}
          </button>
        </div>
      </div>
      {!env ? (
        <div className="empty-inline">
          <span className="muted">This aircraft has no utility category.</span>
          <button
            type="button"
            onClick={() =>
              edit((d) => {
                addUtilityEnvelope(d.massBalance);
              })
            }
          >
            Add utility envelope
          </button>
        </div>
      ) : (
        <>
          <div className="grid2">
            <Field label="Max mass" issues={issuesAt(issues, `${p}.maxKg`, true)}>
              <NumInput
                name={`${p}.maxKg`}
                value={env.maxKg}
                min={0}
                max={1e6}
                unit="kg"
                onChange={(v) =>
                  set((e) => {
                    e.maxKg = v ?? 0;
                  })
                }
              />
            </Field>
            <Field label="Notes">
              <input
                value={env.notes ?? ''}
                onChange={(ev) => {
                  const v = ev.target.value;
                  set((e) => {
                    e.notes = v;
                  });
                }}
              />
            </Field>
          </div>
          <div className="env-row" data-testid="env-cg">
            <div className="stack">
              <div className="lbl">CG limits</div>
              <PointTable
                name={`${p}.polygon`}
                points={env.polygon}
                onChange={(pts) =>
                  set((e) => {
                    e.polygon = pts;
                  })
                }
                xLabel="CG arm"
                xUnit="m"
                yLabel="Mass"
                yUnit="kg"
                xProps={{ min: -10, max: 50 }}
                yProps={{ min: 0, max: 1e6 }}
              />
              <IssueList issues={issuesAt(issues, `${p}.polygon`, true)} />
            </div>
            <div className="chart-col">
              <EnvelopeChart
                series={series}
                markers={emptyMarker}
                xLabel="CG arm (m aft of datum)"
                yLabel="Mass (kg)"
                maxLine={maxLine}
              />
            </div>
          </div>
          <div className="env-row" data-testid="env-moment">
            <div className="stack">
              <div className="lbl row">
                <span>Moment limits (optional)</span>
                <span className="spacer" />
                <button
                  type="button"
                  className="ghost sm"
                  disabled={env.polygon.length < 3}
                  onClick={() =>
                    set((e) => {
                      e.momentPolygon = momentPolygonFromCg(e.polygon);
                    })
                  }
                >
                  Derive from CG limits
                </button>
                {env.momentPolygon && env.momentPolygon.length > 0 && (
                  <button
                    type="button"
                    className="ghost sm danger"
                    onClick={() =>
                      set((e) => {
                        e.momentPolygon = null;
                      })
                    }
                  >
                    Clear
                  </button>
                )}
              </div>
              <PointTable
                name={`${p}.momentPolygon`}
                points={env.momentPolygon || []}
                onChange={(pts) =>
                  set((e) => {
                    e.momentPolygon = pts.length ? pts : null;
                  })
                }
                xLabel="Moment"
                xUnit="kg·m"
                yLabel="Mass"
                yUnit="kg"
                xProps={{ min: -1e6, max: 1e7 }}
                yProps={{ min: 0, max: 1e6 }}
                extra={(q) => (q[1] > 0 ? `${(q[0] / q[1]).toFixed(3)} m` : '—')}
                extraLabel="CG"
              />
              <IssueList issues={issuesAt(issues, `${p}.momentPolygon`, true)} />
            </div>
            <div className="chart-col">
              {mseries.length > 0 ? (
                <EnvelopeChart
                  series={mseries}
                  markers={emptyMomentMarker}
                  xLabel="Moment (kg·m)"
                  yLabel="Mass (kg)"
                  maxLine={maxLine}
                />
              ) : (
                <div className="chart-empty muted">No moment limits</div>
              )}
            </div>
          </div>
          {tab === 'utility' && (
            <div>
              <button
                type="button"
                className="ghost sm danger"
                onClick={() => {
                  edit((d) => {
                    d.massBalance.envelopes.utility = null;
                  });
                }}
              >
                Remove utility category
              </button>
            </div>
          )}
        </>
      )}
      <IssueList issues={issuesAt(issues, 'massBalance.envelopes.utility.maxKg', true)} />
    </>
  );
}
