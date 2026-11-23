// Shared by the map's layers popover and the profile's "Map layers for new flights".
import './map.css';

import { type ReactNode, useLayoutEffect, useRef } from 'react';

import type { MapLayers, MapLayerToggle } from '../../../shared/mapLayers';
import { Check, SegmentedControl } from '../../../ui';
import { drawLegendSample, type LegendSample, SAMPLE_HEIGHT, sampleId, sampleWidth } from './legend';
import { BASE_MAPS, type BaseMapId } from './style';

export const LAYER_TOGGLE_GROUPS: {
  title: string;
  items: {
    key: MapLayerToggle;
    label: string;
    count?: 'prd' | 'mil' | 'act' | 'notams';
    /** What the layer draws, in the order the label names it. */
    legend?: LegendSample[];
  }[];
}[] = [
  {
    title: 'Airspace',
    items: [
      { key: 'fir', label: 'FIR boundary', legend: [{ line: 'fir', title: 'FIR boundary' }] },
      {
        key: 'tma',
        label: 'TMA / MTMA',
        legend: [
          { line: 'tma', title: 'TMA' },
          { line: 'mtma', title: 'MTMA' },
        ],
      },
      {
        key: 'zones',
        label: 'CTR / ATZ',
        legend: [
          { line: 'ctr', title: 'CTR' },
          { line: 'atz', title: 'ATZ' },
        ],
      },
    ],
  },
  {
    title: 'Points and routes',
    items: [
      { key: 'aerodromes', label: 'Aerodromes', legend: [{ symbol: 'pgf-ad-minor', title: 'Aerodrome' }] },
      {
        key: 'vfrPoints',
        label: 'VFR reporting points',
        legend: [
          { symbol: 'pgf-vfr', title: 'VFR reporting point (AIP)' },
          { symbol: 'pgf-vfr-ofm', title: 'VFR reporting point (openflightmaps)' },
        ],
      },
      { key: 'vfrRoutes', label: 'VFR routes', legend: [{ line: 'vfrRoute', title: 'VFR route' }] },
      { key: 'helRoutes', label: 'Helicopter routes', legend: [{ line: 'helRoute', title: 'HEL ONLY VFR route' }] },
      {
        key: 'milRoutes',
        label: 'Military routes',
        legend: [{ line: 'milRoute', title: 'MIL / JET ONLY VFR route' }],
      },
      {
        key: 'navaids',
        label: 'Radio navaids',
        legend: [
          { symbol: 'pgf-nav-vordme', title: 'VOR/DME' },
          { symbol: 'pgf-nav-ndb', title: 'NDB' },
        ],
      },
      { key: 'waypoints', label: 'My waypoints', legend: [{ symbol: 'pgf-wpt', title: 'My waypoint' }] },
    ],
  },
  {
    title: 'Areas',
    items: [
      {
        key: 'prd',
        label: 'Prohibited, restricted, danger',
        count: 'prd',
        legend: [
          { area: 'prohibited', title: 'Prohibited' },
          { area: 'restricted', title: 'Restricted' },
          { area: 'danger', title: 'Danger' },
        ],
      },
      { key: 'mil', label: 'Military training', count: 'mil', legend: [{ area: 'mil', title: 'Military training' }] },
      { key: 'act', label: 'Local flying', count: 'act', legend: [{ area: 'act', title: 'Local flying' }] },
      { key: 'notams', label: 'NOTAM areas', count: 'notams', legend: [{ area: 'notam', title: 'NOTAM area' }] },
    ],
  },
  {
    title: 'Overlay',
    items: [{ key: 'ofm', label: 'openflightmaps' }],
  },
];

const TEST_ID: Record<MapLayerToggle, string> = {
  fir: 'map-fir',
  tma: 'map-tma',
  zones: 'map-zones',
  aerodromes: 'map-aerodromes',
  vfrPoints: 'map-vfr-points',
  vfrRoutes: 'map-vfr-routes',
  helRoutes: 'map-hel-routes',
  milRoutes: 'map-mil-routes',
  navaids: 'map-navaids',
  waypoints: 'map-waypoints',
  prd: 'map-areas-prd',
  mil: 'map-areas-mil',
  act: 'map-areas-act',
  notams: 'map-notams',
  ofm: 'map-ofm',
};

export function MapLayerToggles({
  value,
  onChange,
  counts,
  extra,
}: {
  value: MapLayers;
  onChange: (v: MapLayers) => void;
  counts?: Partial<Record<'prd' | 'mil' | 'act' | 'notams', number>>;
  extra?: ReactNode;
}) {
  return (
    <div className="pgf-layers" data-testid="map-layer-toggles">
      <div className="pgf-layers-h">Base map</div>
      <SegmentedControl<BaseMapId>
        sm
        label="Base map"
        value={value.base}
        onChange={(base) => onChange({ ...value, base })}
        testId="map-base"
        options={BASE_MAPS.map((b) => ({ value: b.id, label: b.label }))}
      />
      {LAYER_TOGGLE_GROUPS.map((g) => (
        <div key={g.title} className="pgf-layers-group" role="group" aria-label={g.title}>
          <div className="pgf-layers-h">{g.title}</div>
          {g.items.map((it) => {
            const n = it.count ? counts?.[it.count] : undefined;
            return (
              <Check
                key={it.key}
                checked={value[it.key]}
                onChange={(v) => onChange({ ...value, [it.key]: v })}
                testId={TEST_ID[it.key]}
              >
                <span className="pgf-layers-label">{it.label}</span>
                {it.legend ? <LegendSamples samples={it.legend} /> : null}
                <span className="muted">{n || null}</span>
              </Check>
            );
          })}
        </div>
      ))}
      {extra}
    </div>
  );
}

/** What a layer draws, as the map draws it (legend.ts). */
export function LegendSamples({ samples }: { samples: readonly LegendSample[] }) {
  return (
    <span className="pgf-legend-samples">
      {samples.map((s) => (
        <Sample key={sampleId(s)} sample={s} />
      ))}
    </span>
  );
}

function Sample({ sample }: { sample: LegendSample }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = sampleWidth(sample),
    h = SAMPLE_HEIGHT;
  const pr = Math.max(2, Math.ceil(typeof window === 'undefined' ? 2 : window.devicePixelRatio || 1));
  useLayoutEffect(() => {
    const g = ref.current?.getContext('2d');
    if (!g) return;
    g.setTransform(pr, 0, 0, pr, 0, 0);
    g.clearRect(0, 0, w, h);
    drawLegendSample(g, sample, pr);
  }, [sample, pr, w, h]);
  return (
    <canvas
      ref={ref}
      className="pgf-legend-sample"
      width={w * pr}
      height={h * pr}
      style={{ width: w, height: h }}
      role="img"
      aria-label={sample.title}
      title={sample.title}
      data-legend={sampleId(sample)}
    />
  );
}
