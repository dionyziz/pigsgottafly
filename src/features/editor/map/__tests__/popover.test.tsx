// @vitest-environment jsdom
// The map's shared popover frame (MapPopover, PopItem, useAccordion), the point menu, the layers
// control (SegmentedControl base map, layer toggles), tooltip placement near the map's edges and the
// hint's close button.
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_MAP_LAYERS, type MapLayers } from '../../../../shared/mapLayers';
import { SegmentedControl } from '../../../../ui';
import { MapLayerToggles } from '../MapLayerToggles';
import { MapPopover, MapTip, placeBeside, PopItem, useAccordion } from '../MapPopover';
import { LayersControl, MapHint } from '../MapToolbar';
import { PointMenu } from '../PointMenu';

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
    ] as const) {
      fireEvent.click(r.getByTestId(id));
      expect(layers[key]).toBe(false);
      layers = { ...DEFAULT_MAP_LAYERS };
    }
    expect(r.getByRole('group', { name: 'Airspace' })).toBeTruthy();
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
