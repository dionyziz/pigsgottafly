// @vitest-environment jsdom
// src/ui: Sortable (pointer and keyboard reorder), Collapsible (header toggle), Dialog/DialogFooter,
// ConfirmDialog, Menu, AsyncView, rowClick, Field, WarningList, useHighlightFields, Icon, Loading.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { useRef, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import {
  AsyncView,
  Collapsible,
  ConfirmDialog,
  Dialog,
  DialogFooter,
  DragHandle,
  Field,
  ICON_NAMES,
  Icon,
  KebabMenu,
  Loading,
  WarningList,
  dropIndex,
  rowClick,
  useHighlightFields,
  useSortable,
} from '../../../src/ui';
import { moveAt } from '../../../src/shared';

// Node's own (flag-gated) localStorage shadows jsdom's: use an in-memory one.
const mem = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => {
    mem.set(k, String(v));
  },
  removeItem: (k: string) => {
    mem.delete(k);
  },
  clear: () => mem.clear(),
  key: () => null,
  get length() {
    return mem.size;
  },
});
// jsdom has no PointerEvent: a MouseEvent with a pointer id and type.
if (typeof window.PointerEvent === 'undefined') {
  class PE extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  vi.stubGlobal('PointerEvent', PE);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  mem.clear();
});

function List({ initial = ['A', 'B', 'C', 'D'] }: { initial?: string[] }) {
  const [rows, setRows] = useState(initial);
  const s = useSortable({ count: rows.length, onMove: (a, b) => setRows((r) => moveAt(r, a, b)) });
  return (
    <ul>
      {rows.map((r, i) => (
        <li key={r} {...s.itemProps(i, 'row')} data-testid={`row-${r}`}>
          <DragHandle {...s.handleProps(i)} label={`Move ${r}`} />
          <input aria-label={`name ${r}`} defaultValue={r} />
        </li>
      ))}
      <output data-testid="order">{rows.join('')}</output>
    </ul>
  );
}

describe('Sortable', () => {
  test('dropIndex', () => {
    const rects = [0, 1, 2, 3].map((i) => ({ top: i * 40, bottom: i * 40 + 40 }));
    expect(dropIndex(10, rects, 2)).toBe(0);
    expect(dropIndex(50, rects, 2)).toBe(1);
    expect(dropIndex(70, rects, 2)).toBe(2);
    expect(dropIndex(90, rects, 2)).toBe(2);
    expect(dropIndex(150, rects, 0)).toBe(3);
    expect(dropIndex(61, rects, 0)).toBe(1);
    expect(dropIndex(59, rects, 0)).toBe(0);
  });

  test('Alt+↓ / Alt+↑ from inside an item moves it; focus follows to its handle', () => {
    const r = render(<List />);
    const input = r.getByLabelText('name B');
    fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true });
    expect(r.getByTestId('order').textContent).toBe('ACBD');
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^Move B/);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(r.getByTestId('order').textContent).toBe('BACD');
    fireEvent.keyDown(r.getByLabelText('name B'), { key: 'ArrowUp', altKey: true });
    expect(r.getByTestId('order').textContent).toBe('BACD');
    fireEvent.keyDown(r.getByLabelText('name A'), { key: 'ArrowDown' });
    expect(r.getByTestId('order').textContent).toBe('BACD');
  });

  test('pointer drag on the handle moves the item where it is dropped', () => {
    const r = render(<List />);
    ['A', 'B', 'C', 'D'].forEach((k, i) => {
      r.getByTestId(`row-${k}`).getBoundingClientRect = () => ({
        top: i * 40,
        bottom: i * 40 + 40,
        left: 0,
        right: 100,
        width: 100,
        height: 40,
        x: 0,
        y: i * 40,
        toJSON: () => ({}),
      });
    });
    const h = r.getByLabelText(/^Move A/);
    fireEvent.pointerDown(h, { pointerId: 1, button: 0, clientY: 20 });
    expect(r.getByTestId('row-A').className).toContain('sort-dragging');
    expect(r.getByTestId('row-A').className).toContain('row');
    fireEvent.pointerMove(h, { pointerId: 1, clientY: 110 });
    expect(r.getByTestId('row-C').className).toContain('sort-over-after');
    fireEvent.pointerUp(h, { pointerId: 1, clientY: 110 });
    expect(r.getByTestId('order').textContent).toBe('BCAD');
    expect(r.getByTestId('row-A').className).not.toContain('sort-dragging');
  });

  test('one item: the handle is disabled', () => {
    const r = render(<List initial={['A']} />);
    expect((r.getByLabelText(/^Move A/) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('Collapsible', () => {
  test('a click anywhere on the header toggles; actions do not; remembered', () => {
    const act1 = vi.fn();
    const r = render(
      <Collapsible
        id="fuel"
        title="Fuel"
        badge={<span>42 L</span>}
        actions={
          <button type="button" onClick={act1}>
            Reset
          </button>
        }
      >
        <p>body</p>
      </Collapsible>,
    );
    const head = r.container.querySelector('.collapsible-head') as HTMLElement;
    expect(head.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(r.getByText('Reset'));
    expect(act1).toHaveBeenCalled();
    expect(r.queryByText('body')).not.toBeNull();
    fireEvent.click(r.getByText('42 L'));
    expect(r.queryByText('body')).toBeNull();
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(r.queryByText('Reset')).toBeNull();
    expect(JSON.parse(localStorage.getItem('pgf.collapsed')!)).toEqual({ fuel: true });
    cleanup();
    const r2 = render(
      <Collapsible id="fuel" title="Fuel">
        <p>body</p>
      </Collapsible>,
    );
    expect(r2.queryByText('body')).toBeNull();
    fireEvent.click(r2.getByText('Fuel'));
    expect(r2.queryByText('body')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('pgf.collapsed')!)).toEqual({});
  });

  test('Enter and Space on the focused header toggle; keys in actions do not', () => {
    const r = render(
      <Collapsible id="x" title="X" actions={<input aria-label="a" />}>
        <p>body</p>
      </Collapsible>,
    );
    const head = r.container.querySelector('.collapsible-head') as HTMLElement;
    fireEvent.keyDown(r.getByLabelText('a'), { key: 'Enter' });
    expect(r.queryByText('body')).not.toBeNull();
    fireEvent.keyDown(head, { key: 'Enter' });
    expect(r.queryByText('body')).toBeNull();
    fireEvent.keyDown(head, { key: ' ' });
    expect(r.queryByText('body')).not.toBeNull();
  });

  test('summary when collapsed; openWhen opens without remembering; custom store', () => {
    localStorage.setItem('pgf.editor.sections', JSON.stringify({ to: true }));
    function H() {
      const [f, setF] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setF(true)}>
            go
          </button>
          <Collapsible id="to" title="Take-off" store="pgf.editor.sections" openWhen={f} summary="OK · 21 · 480/1100 m">
            <p>body</p>
          </Collapsible>
        </>
      );
    }
    const r = render(<H />);
    expect(r.getByText('OK · 21 · 480/1100 m')).toBeTruthy();
    fireEvent.click(r.getByText('go'));
    expect(r.queryByText('body')).not.toBeNull();
    expect(JSON.parse(localStorage.getItem('pgf.editor.sections')!)).toEqual({ to: true });
  });
});

describe('Dialog', () => {
  test('DialogFooter: danger on the left, error, Cancel, primary; busy disables', () => {
    const del = vi.fn(),
      save = vi.fn(),
      cancel = vi.fn();
    const r = render(
      <Dialog
        title="Edit"
        onClose={cancel}
        footer={
          <DialogFooter
            onCancel={cancel}
            error="Weight must be 1–300 kg"
            danger={{ label: 'Delete', onClick: del }}
            primary={{ label: 'Save', onClick: save }}
          />
        }
      >
        <input />
      </Dialog>,
    );
    const buttons = Array.from(r.container.querySelectorAll('.dlg-foot button')).map((b) => b.textContent);
    expect(buttons).toEqual(['Delete', 'Cancel', 'Save']);
    expect(r.getByRole('alert').textContent).toBe('Weight must be 1–300 kg');
    fireEvent.click(r.getByText('Delete'));
    fireEvent.click(r.getByText('Save'));
    expect(del).toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
    cleanup();
    const r2 = render(
      <Dialog
        title="Edit"
        onClose={cancel}
        footer={<DialogFooter busy onCancel={cancel} primary={{ label: 'Save', onClick: save }} />}
      />,
    );
    expect((r2.getByText('Save') as HTMLButtonElement).disabled).toBe(true);
    expect((r2.getByText('Cancel') as HTMLButtonElement).disabled).toBe(true);
  });

  test('Escape and a backdrop click close it, not while busy', () => {
    const close = vi.fn();
    const r = render(
      <Dialog title="T" onClose={close}>
        <p>x</p>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(r.container.querySelector('.dlg-backdrop')!);
    expect(close).toHaveBeenCalledTimes(2);
    cleanup();
    const r2 = render(
      <Dialog title="T" busy onClose={close}>
        <p>x</p>
      </Dialog>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.mouseDown(r2.container.querySelector('.dlg-backdrop')!);
    expect(close).toHaveBeenCalledTimes(2);
  });

  test('ConfirmDialog: title only; a failing confirm shows the error and stays open', async () => {
    const close = vi.fn();
    const r = render(
      <ConfirmDialog
        title="Delete Maria?"
        confirmLabel="Delete"
        onClose={close}
        onConfirm={() => {
          throw new Error('Offline');
        }}
      />,
    );
    expect(r.container.querySelector('.dlg-body')).toBeNull();
    expect(document.activeElement?.textContent).toBe('Delete');
    await act(async () => {
      fireEvent.click(r.getByText('Delete'));
    });
    expect(r.getByRole('alert').textContent).toBe('Offline');
    expect(close).not.toHaveBeenCalled();
  });
});

describe('Menu', () => {
  test('opens, ↓ moves between items, a choice closes it', () => {
    const del = vi.fn();
    const r = render(
      <KebabMenu
        items={[
          { label: 'Edit', onSelect: () => {} },
          { label: 'Delete', onSelect: del, danger: true, separator: true },
        ]}
      />,
    );
    fireEvent.click(r.getByTestId('row-menu'));
    const items = r.getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Edit', 'Delete']);
    items[0].focus();
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.click(items[1]);
    expect(del).toHaveBeenCalled();
    expect(r.queryByRole('menu')).toBeNull();
  });
});

describe('AsyncView', () => {
  const view = (p: Partial<Parameters<typeof AsyncView<string[]>>[0]>) =>
    render(
      <AsyncView<string[]>
        data={undefined}
        isEmpty={(d) => d.length === 0}
        empty={<p>none yet</p>}
        isNoMatch={(d) => d.includes('?')}
        noMatch={<p>no match</p>}
        {...p}
      >
        {(d) => <p>{d.join(',')}</p>}
      </AsyncView>,
    );
  test('error, loading, empty, no match, data', () => {
    const reload = vi.fn();
    let r = view({ error: new Error('Offline'), reload });
    expect(r.getByText('Offline')).toBeTruthy();
    fireEvent.click(r.getByText('Try again'));
    expect(reload).toHaveBeenCalled();
    cleanup();
    r = view({ loading: true });
    expect(r.container.querySelector('div.loading-block .loading')).not.toBeNull();
    cleanup();
    r = view({ data: [] });
    expect(r.getByText('none yet')).toBeTruthy();
    cleanup();
    r = view({ data: ['?'] });
    expect(r.getByText('no match')).toBeTruthy();
    cleanup();
    r = view({ data: ['a', 'b'], error: new Error('stale reload failed') });
    expect(r.getByText('a,b')).toBeTruthy();
  });
});

describe('rowClick', () => {
  test('ignores clicks on controls inside the row', () => {
    const fn = vi.fn();
    const r = render(
      <table>
        <tbody>
          <tr onClick={rowClick(fn)} data-testid="tr">
            <td>Maria</td>
            <td>
              <button type="button">⋮</button>
              <a href="#x">l</a>
            </td>
          </tr>
        </tbody>
      </table>,
    );
    fireEvent.click(r.getByText('Maria'));
    fireEvent.click(r.getByText('⋮'));
    fireEvent.click(r.getByText('l'));
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('Field', () => {
  test('required mark, issues inline, .invalid and aria-invalid on error, data-focus', () => {
    const r = render(
      <Field
        label="Weight"
        req
        focus="weightKg"
        error="Weight must be 1–300 kg"
        issues={[{ level: 'warning', message: 'Heavy' }]}
      >
        <input name="w" />
      </Field>,
    );
    const label = r.container.querySelector('label.field')!;
    expect(label.className).toContain('invalid');
    expect(label.getAttribute('data-focus')).toBe('weightKg');
    expect(label.querySelector('.req')).not.toBeNull();
    expect(r.container.querySelector('input')!.getAttribute('aria-invalid')).toBe('true');
    expect(Array.from(label.querySelectorAll('.issue')).map((e) => e.className)).toEqual([
      'issue error',
      'issue warning',
    ]);
    cleanup();
    const r2 = render(
      <Field label="X" issues={[{ level: 'warning', message: 'w' }]}>
        <input />
      </Field>,
    );
    expect(r2.container.querySelector('label')!.className).not.toContain('invalid');
  });
});

describe('WarningList', () => {
  test('levels, link fix and in-place fix', () => {
    const fix = vi.fn();
    const r = render(
      <MemoryRouter>
        <WarningList
          warnings={[{ level: 'danger', text: 'Over MTOW' }, 'Plain', { level: 'info', text: 'FYI' }]}
          fix={(w) =>
            typeof w === 'string'
              ? { label: 'Fix', to: '/profile?focus=x' }
              : w.level === 'danger'
                ? { label: 'Fix', onFix: fix }
                : null
          }
        />
      </MemoryRouter>,
    );
    const lis = Array.from(r.container.querySelectorAll('li'));
    expect(lis.map((l) => l.className)).toEqual(['danger', 'warn', 'info']);
    expect(lis[1].querySelector('a')!.getAttribute('href')).toBe('/profile?focus=x');
    fireEvent.click(lis[0].querySelector('button')!);
    expect(fix).toHaveBeenCalled();
    expect(lis[2].querySelector('[data-testid=warning-fix]')).toBeNull();
  });
});

describe('useHighlightFields', () => {
  test('highlights every named field and focuses the first', () => {
    vi.useFakeTimers();
    Element.prototype.scrollIntoView = () => {};
    function F() {
      const ref = useRef<HTMLFormElement>(null);
      useHighlightFields(ref, ['idNumber', 'weightKg']);
      return (
        <form ref={ref}>
          <input name="fullName" />
          <input name="weightKg" />
          <input name="idNumber" />
        </form>
      );
    }
    const r = render(<F />);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    const id = r.container.querySelector('[name=idNumber]')!,
      w = r.container.querySelector('[name=weightKg]')!;
    expect(document.activeElement).toBe(id);
    expect(id.classList.contains('attention')).toBe(true);
    expect(w.classList.contains('attention')).toBe(true);
    fireEvent.input(w, { target: { value: '70' } });
    expect(w.classList.contains('attention')).toBe(false);
  });
});

describe('Icon and Loading', () => {
  test('every icon renders a path; a titled icon is an image', () => {
    for (const n of ICON_NAMES) {
      const r = render(<Icon name={n} />);
      expect(r.container.querySelector('path')!.getAttribute('d')).toBeTruthy();
      cleanup();
    }
    const r = render(<Icon name="warn" title="Warning" />);
    expect(r.getByRole('img').getAttribute('aria-label')).toBe('Warning');
  });
  test('Loading is always a div', () => {
    for (const v of ['screen', 'inline', 'sm'] as const) {
      const r = render(<Loading variant={v} />);
      expect(r.container.firstElementChild!.tagName).toBe('DIV');
      expect(r.getByRole('status').textContent).toBe('Loading…');
      cleanup();
    }
  });
});
