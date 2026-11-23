// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import type { LayerSpecification } from 'maplibre-gl';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DEFAULT_MAP_LAYERS, MAP_LAYER_TOGGLES } from '../../../../shared/mapLayers';
import { drawLegendSample, type LegendSample } from '../legend';
import { LAYER_TOGGLE_GROUPS, MapLayerToggles } from '../MapLayerToggles';
import { LayersControl } from '../MapToolbar';
import { notamLayers } from '../notamLayer';
import { buildStyle, CHART, LINE_STYLES } from '../style';
import { SYMBOLS } from '../symbols';

// jsdom has no canvas: the samples render as empty canvases (and jsdom would log each getContext call)
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(cleanup);

const layers: LayerSpecification[] = [...buildStyle('light', false, null).style.layers, ...notamLayers()];
const paint = (id: string) => (layers.find((l) => l.id === id) as { paint: Record<string, unknown> }).paint;
/** The value a paint property has at zoom 10+, not hovered (a zoom curve's last stop; a case's default). */
const at10 = (v: unknown): unknown => {
  if (!Array.isArray(v)) return v;
  if (v[0] === 'interpolate') return at10(v[v.length - 1]);
  if (v[0] === 'case') return at10(v[v.length - 1]);
  return v;
};

describe('the legend beside each layer toggle', () => {
  it('every toggle but the overlay has its samples, each a line style or symbol the map has', () => {
    const items = LAYER_TOGGLE_GROUPS.flatMap((g) => g.items);
    expect(items.map((i) => i.key).sort()).toEqual([...MAP_LAYER_TOGGLES].sort());
    for (const it of items) {
      if (it.key === 'ofm') continue;
      expect(it.legend?.length, it.key).toBeGreaterThan(0);
      for (const s of it.legend!) {
        if ('symbol' in s) expect(SYMBOLS[s.symbol], s.symbol).toBeDefined();
        else expect(LINE_STYLES['line' in s ? s.line : s.area]).toBeDefined();
      }
    }
  });

  it('the line styles are the ones the map layers draw with', () => {
    const line = (id: string, st: (typeof LINE_STYLES)[keyof typeof LINE_STYLES]) => {
      const p = paint(id);
      expect(at10(p['line-width']), id).toBe(st.width);
      expect(at10(p['line-opacity'] ?? 1), id).toBe(st.opacity);
      expect(p['line-dasharray'], id).toEqual('dash' in st ? st.dash : undefined);
    };
    line('fir-line', LINE_STYLES.fir);
    line('airspace-line', LINE_STYLES.tma);
    line('airspace-line-m', LINE_STYLES.mtma);
    line('zone-line', LINE_STYLES.ctr);
    line('zone-line-atz', LINE_STYLES.atz);
    line('vfr-route-line', LINE_STYLES.vfrRoute);
    line('notam-line', LINE_STYLES.notam);
    line('route-line', LINE_STYLES.route);
    expect(paint('route-line')['line-color']).toBe(CHART.route);
    expect(paint('route-casing')['line-width']).toBe(LINE_STYLES.route.casing);
    expect(paint('airspace-line-m')['line-color']).toBe(CHART.mtma);
    expect(JSON.stringify(paint('zone-line')['line-color'])).toContain(CHART.zoneG);
    expect(paint('area-hatch')['fill-pattern']).toBe(LINE_STYLES.restricted.hatch);
    // the ENR 5 area outlines: a width per kind, dashed as the legend draws them
    expect(paint('area-line-d')['line-dasharray']).toEqual(LINE_STYLES.danger.dash);
    expect(paint('area-line-mil')['line-dasharray']).toEqual(LINE_STYLES.mil.dash);
    expect(paint('area-line-act')['line-dasharray']).toEqual(LINE_STYLES.act.dash);
    expect(paint('area-line-act')['line-opacity']).toBe(LINE_STYLES.act.opacity);
    expect(JSON.stringify(paint('area-fill')['fill-opacity'])).toContain(`"P",${LINE_STYLES.prohibited.fill}`);
  });

  it('shows the samples by their names in each toggle, and the rest below the toggles', () => {
    const r = render(
      <LayersControl
        open
        onOpen={() => {}}
        layers={{ ...DEFAULT_MAP_LAYERS }}
        onLayers={() => {}}
        tips
        onTips={() => {}}
        airac="2609"
        areaCount={{ prd: 110, mil: 14, act: 11 }}
        notamCount={0}
      />,
    );
    const samples = (testId: string) =>
      [...r.getByTestId(testId).closest('label')!.querySelectorAll('canvas')].map((c) => [
        c.dataset.legend,
        c.getAttribute('aria-label'),
      ]);
    expect(samples('map-tma')).toEqual([
      ['line:tma', 'TMA'],
      ['line:mtma', 'MTMA'],
    ]);
    expect(samples('map-areas-prd')).toEqual([
      ['area:prohibited', 'Prohibited'],
      ['area:restricted', 'Restricted'],
      ['area:danger', 'Danger'],
    ]);
    expect(samples('map-vfr-points')[0]).toEqual(['symbol:pgf-vfr', 'VFR reporting point (AIP)']);
    expect(samples('map-ofm')).toEqual([]);
    // the count stays last, after the samples
    const prd = r.getByTestId('map-areas-prd').closest('label')!;
    expect(prd.querySelector(':scope > span > :last-child')!.textContent).toBe('110');
    expect(r.getByTestId('map-legend').textContent).toBe('Class G zoneYour route');
  });

  it('the profile’s toggles have the samples too', () => {
    const r = render(<MapLayerToggles value={{ ...DEFAULT_MAP_LAYERS }} onChange={() => {}} />);
    expect(r.container.querySelectorAll('canvas[data-legend]').length).toBe(
      LAYER_TOGGLE_GROUPS.flatMap((g) => g.items).reduce((n, i) => n + (i.legend?.length ?? 0), 0),
    );
  });
});

/** A 2D context that records what is drawn. */
function recorder() {
  const calls: [string, unknown[]][] = [];
  const state: Record<string, unknown> = {};
  let dash: number[] = [];
  const g = new Proxy(state, {
    get(_, k: string) {
      if (k === 'setLineDash') return (d: number[]) => (dash = d);
      if (k === 'stroke' || k === 'strokeRect' || k === 'fillRect')
        return (...a: unknown[]) =>
          calls.push([
            k,
            [...a, { dash, width: state.lineWidth, alpha: state.globalAlpha, stroke: state.strokeStyle }],
          ]);
      if (k in state) return state[k];
      return () => null;
    },
    set(_, k: string, v) {
      state[k] = v;
      return true;
    },
  });
  return { g: g as unknown as CanvasRenderingContext2D, calls };
}

describe('drawLegendSample', () => {
  it('draws a line in its colour, width and opacity, with its dashes in line widths', () => {
    const { g, calls } = recorder();
    drawLegendSample(g, { line: 'mtma', title: 'MTMA' }, 2);
    expect(calls).toEqual([['stroke', [{ dash: [8, 4], width: 2, alpha: 0.75, stroke: CHART.mtma }]]]);
  });
  it('the route over its white casing', () => {
    const { g, calls } = recorder();
    drawLegendSample(g, { line: 'route', title: 'Your route' }, 2);
    expect(calls.map(([, a]) => (a[0] as { stroke: string; width: number }).stroke)).toEqual([
      CHART.paper,
      CHART.route,
    ]);
    expect(calls.map(([, a]) => (a[0] as { width: number }).width)).toEqual([7.5, 3.5]);
  });
  it('an area: its tint, then its outline', () => {
    const { g, calls } = recorder();
    const s: LegendSample = { area: 'danger', title: 'Danger' };
    drawLegendSample(g, s, 2);
    expect(calls.map(([k]) => k)).toEqual(['fillRect', 'strokeRect']);
    expect((calls[0][1][4] as { alpha: number }).alpha).toBe(LINE_STYLES.danger.fill);
    expect(calls[1][1][4]).toMatchObject({
      dash: LINE_STYLES.danger.dash.map((d) => d * 1.8),
      width: 1.8,
      stroke: CHART.danger,
    });
  });
});
