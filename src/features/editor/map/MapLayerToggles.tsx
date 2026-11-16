// The map layer selection (base map and one toggle per layer): the map's layers popover and the
// profile's "Map layers for new flights" use this one list.
import type { ReactNode } from 'react';
import { Check, SegmentedControl } from '../../../ui';
import type { MapLayers, MapLayerToggle } from '../../../shared/mapLayers';
import { BASE_MAPS, type BaseMapId } from './style';
import './map.css';

const GROUPS: {
  title: string;
  items: { key: MapLayerToggle; label: string; count?: 'prd' | 'mil' | 'act' | 'notams' }[];
}[] = [
  {
    title: 'Airspace',
    items: [
      { key: 'fir', label: 'FIR boundary' },
      { key: 'tma', label: 'TMA / MTMA' },
      { key: 'zones', label: 'CTR / ATZ' },
    ],
  },
  {
    title: 'Points and routes',
    items: [
      { key: 'aerodromes', label: 'Aerodromes' },
      { key: 'vfrPoints', label: 'VFR reporting points' },
      { key: 'vfrRoutes', label: 'VFR routes' },
      { key: 'waypoints', label: 'My waypoints' },
    ],
  },
  {
    title: 'Areas',
    items: [
      { key: 'prd', label: 'Prohibited, restricted, danger', count: 'prd' },
      { key: 'mil', label: 'Military training', count: 'mil' },
      { key: 'act', label: 'Local flying', count: 'act' },
      { key: 'notams', label: 'NOTAM areas', count: 'notams' },
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
  onChange(v: MapLayers): void;
  /** Counts shown beside the area toggles (the map). */
  counts?: Partial<Record<'prd' | 'mil' | 'act' | 'notams', number>>;
  /** More toggles at the end (the map's editing tips). */
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
      {GROUPS.map((g) => (
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
                {it.label}
                {n ? <span className="muted">{n}</span> : null}
              </Check>
            );
          })}
        </div>
      ))}
      {extra}
    </div>
  );
}
