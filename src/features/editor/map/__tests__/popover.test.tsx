// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { NAVAIDS } from '../../../../data/ref';
import { DEFAULT_MAP_LAYERS, type MapLayers } from '../../../../shared/mapLayers';
import { SegmentedControl } from '../../../../ui';
import { MapLayerToggles } from '../MapLayerToggles';
import { MapPopover, MapTip, placeBeside, PopItem, useAccordion } from '../MapPopover';
import { LayersControl, MapHint } from '../MapToolbar';
import { NavaidDetails, NavaidTipRows } from '../NavaidPopover';
import { PointMenu } from '../PointMenu';

// jsdom has no canvas (the layer toggles' legend samples): no drawing, and no "not implemented" log
beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(cleanup);

function List({ onClose }: { onClose: () => void }) {
  const acc = useAccordion('a');
  return (
    <MapPopover x={10} y={10} label="Things" testId="pop" onClose={onClose}>
      {['a', 'b'].map((k) => (
        <PopItem
          key={k}
          open={acc.isOpen(k)}
          onToggle={() => acc.toggle(k)}
          testId="item"
          data={{ id: k }}
          head={<span>{k.toUpperCase()}</span>}
        >
          <p data-testid={'body-' + k}>body {k}</p>
        </PopItem>
      ))}
    </MapPopover>
  );
}

describe('MapPopover + PopItem', () => {
  it('opens the first item, one at a time, and closes from the close button', () => {
    const onClose = vi.fn();
    const r = render(<List onClose={onClose} />);
    expect(r.getByRole('dialog', { name: 'Things' })).toBeTruthy();
    expect(r.queryByTestId('body-a')).toBeTruthy();
    expect(r.queryByTestId('body-b')).toBeNull();
    const heads = r.getAllByRole('button', { expanded: false });
    fireEvent.click(heads.find((b) => b.textContent === 'B')!);
    expect(r.queryByTestId('body-a')).toBeNull();
    expect(r.queryByTestId('body-b')).toBeTruthy();
    expect(r.container.querySelector('[data-id=b]')?.classList.contains('is-open')).toBe(true);
    fireEvent.click(r.getByRole('button', { name: 'B' }));
    expect(r.queryByTestId('body-b')).toBeNull();
    fireEvent.click(r.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('a single item without a toggle has a plain header', () => {
    const r = render(
      <MapPopover x={0} y={0} label="One" testId="pop" onClose={() => {}}>
        <PopItem open head={<b>AD</b>}>
          x
        </PopItem>
      </MapPopover>,
    );
    expect(r.container.querySelector('div.pgf-air-h')).toBeTruthy();
    expect(r.container.querySelector('button.pgf-air-h')).toBeNull();
  });
});

describe('PointMenu', () => {
  it('lists the items, runs a choice, moves with the arrow keys', () => {
    const remove = vi.fn();
    const r = render(
      <PointMenu
        x={0}
        y={0}
        title="LGMG"
        detail="aerodrome"
        error="Could not save the waypoint."
        items={[
          { label: 'Rename…', onSelect: () => {} },
          { label: 'Saving…', onSelect: () => {}, disabled: true },
          { label: 'Remove point', onSelect: remove, danger: true },
        ]}
      />,
    );
    const items = r.getAllByRole('menuitem');
    expect(items.map((b) => b.textContent)).toEqual(['Rename…', 'Saving…', 'Remove point']);
    expect(items[2].className).toBe('danger');
    items[0].focus();
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.click(items[2]);
    expect(remove).toHaveBeenCalledOnce();
    expect(r.getByText('Could not save the waypoint.')).toBeTruthy();
  });
});

describe('layers control', () => {
  it('switches the base map and the layer toggles', () => {
    let layers: MapLayers = { ...DEFAULT_MAP_LAYERS };
    const onLayers = vi.fn((l: MapLayers) => {
      layers = l;
    });
    const onOpen = vi.fn(),
      onTips = vi.fn();
    const r = render(
      <LayersControl
        open
        onOpen={onOpen}
        layers={layers}
        onLayers={onLayers}
        tips
        onTips={onTips}
        airac="2609"
        areaCount={{ prd: 110, mil: 14, act: 11 }}
        notamCount={0}
      />,
    );
    fireEvent.click(r.getByRole('button', { name: 'Terrain' }));
    expect(layers.base).toBe('terrain');
    expect(r.getByRole('button', { name: 'Light' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(r.getByTestId('map-areas-mil'));
    expect(layers.mil).toBe(false);
    fireEvent.click(r.getByTestId('map-tips'));
    expect(onTips).toHaveBeenCalledWith(false);
    expect(r.getByText('AIRAC 2609')).toBeTruthy();
    // a press outside closes it
    act(() => {
      document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    });
    expect(onOpen).toHaveBeenCalledWith(false);
  });
  it('the hint closes with its button', () => {
    const onClose = vi.fn();
    const r = render(<MapHint text="Drag points to move" away={false} onClose={onClose} hintRef={null} />);
    fireEvent.click(r.getByTestId('map-hint-close'));
    expect(onClose).toHaveBeenCalledOnce();
    expect(r.getByTestId('map-hint-close').getAttribute('aria-label')).toBe('Hide tips');
  });
});

describe('MapLayerToggles', () => {
  it('has a separate toggle per layer', () => {
    let layers: MapLayers = { ...DEFAULT_MAP_LAYERS };
    const r = render(
      <MapLayerToggles
        value={layers}
        onChange={(l) => {
          layers = l;
        }}
      />,
    );
    for (const [id, key] of [
      ['map-fir', 'fir'],
      ['map-tma', 'tma'],
      ['map-zones', 'zones'],
      ['map-aerodromes', 'aerodromes'],
      ['map-vfr-points', 'vfrPoints'],
      ['map-vfr-routes', 'vfrRoutes'],
      ['map-navaids', 'navaids'],
    ] as const) {
      fireEvent.click(r.getByTestId(id));
      expect(layers[key]).toBe(false);
      layers = { ...DEFAULT_MAP_LAYERS };
    }
    expect(r.getByRole('group', { name: 'Airspace' })).toBeTruthy();
  });
});

describe('radio navaid tooltip and details', () => {
  const atv = NAVAIDS.find((n) => n.id === 'ATV VOR/DME')!;
  it('the tooltip shows type, ident, name and frequency', () => {
    const r = render(<NavaidTipRows n={atv} />);
    expect(r.getByTestId('navaid-tip').textContent).toBe('VOR/DMEATV · ATHINAI114.40 MHz');
  });
  it('the details add channel, hours, coverage and links to every AIP section that publishes it', () => {
    const r = render(<NavaidDetails n={atv} airac="2609" />);
    const text = r.getByTestId('navaid-detail').textContent;
    expect(text).toContain('114.40 MHz · CH 91X');
    expect(text).toContain('H24');
    expect(text).toContain('FL 500 / 120 NM');
    expect(text).toContain('2378 ft');
    expect(text).toContain('5°E (2025) · declination 5°E');
    const links = r.getAllByTestId('aip-link');
    expect(links.map((a) => a.textContent)).toEqual(['AIP Greece ENR 4.1', 'AIP Greece LGAV AD 2.19']);
    expect(links[0].getAttribute('href')).toMatch(/LG_ENR_4_1_en\.pdf$/);
    expect(links[1].getAttribute('href')).toMatch(/LG_AD_2_LGAV_en\.pdf$/);
    const loc = NAVAIDS.find((n) => n.type === 'L')!;
    r.rerender(<NavaidDetails n={loc} airac="2609" />);
    expect(r.getByTestId('navaid-detail').textContent).toMatch(/Locator \(L\).*\d+ kHz/);
  });
});

describe('tooltips near the map edges', () => {
  it('flips left / up and stays inside the map', () => {
    expect(placeBeside(100, 100, 200, 80, 1000, 600, { x: 16, y: 14 })).toEqual({ left: 116, top: 114 });
    // right edge: to the left of the cursor
    expect(placeBeside(950, 100, 200, 80, 1000, 600, { x: 16, y: 14 })).toEqual({ left: 734, top: 114 });
    // bottom edge: above the cursor
    expect(placeBeside(100, 590, 200, 80, 1000, 600, { x: 16, y: 14 })).toEqual({ left: 116, top: 496 });
    // taller / wider than the room on either side: clamped inside
    expect(placeBeside(500, 300, 300, 590, 1000, 600, { x: 16, y: 14 })).toEqual({ left: 516, top: 8 });
    expect(placeBeside(20, 20, 990, 50, 1000, 600, { x: 16, y: 14 })).toEqual({ left: 8, top: 34 });
  });
  it('MapTip renders at its placed position', () => {
    const r = render(
      <MapTip x={10} y={20} testId="tip">
        x
      </MapTip>,
    );
    const el = r.getByTestId('tip');
    expect(el.style.left).toBe('26px');
    expect(el.style.top).toBe('34px');
  });
});

describe('SegmentedControl', () => {
  it('marks the value pressed and moves with ←/→', () => {
    const onChange = vi.fn();
    const r = render(
      <SegmentedControl
        label="Unit"
        value="kg"
        onChange={onChange}
        options={[
          { value: 'kg', label: 'kg' },
          { value: 'lb', label: 'lb' },
        ]}
      />,
    );
    expect(r.getByRole('group', { name: 'Unit' })).toBeTruthy();
    expect(r.getByRole('button', { name: 'kg' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.keyDown(r.getByRole('button', { name: 'kg' }), { key: 'ArrowRight' });
    expect(onChange).toHaveBeenLastCalledWith('lb');
    fireEvent.keyDown(r.getByRole('button', { name: 'kg' }), { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenLastCalledWith('lb');
    fireEvent.click(r.getByRole('button', { name: 'lb' }));
    expect(onChange).toHaveBeenCalledTimes(3);
  });
});
