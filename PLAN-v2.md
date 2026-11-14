# Navlog v2: a flights app, Google Docs style

## Two screens

### 1. Home: "My flights"
- Top bar: Navlog logo · search box · avatar-less (no accounts).
- **Start a new flight** strip, like Docs' template row, with two big tiles:
  - **Blank flight**: opens an empty navlog.
  - **From Windy**: paste a route-planner link. If the clipboard already holds one, the tile says "Paste route from clipboard".
- **Recent flights** list, sorted by last opened:
  - Each row: title (auto: `LGMG → LGKC → LGMG`, renameable), date, aircraft, total time/fuel, and a small thumbnail of the sheet.
  - Row ⋮ menu: Open, Rename, Duplicate (for flying the same route again on another day), Delete (with Undo toast).
- Upcoming flights (date ≥ today) are listed before past ones.

### 2. Flight: the sheet
- Docs-like header:
  - Back arrow to the list, then the **editable title**, then a quiet "Saved" indicator.
  - Below that, a one-line **menu bar** (File · Edit · Flight).
  - On the right: **Print** and the date / block / aircraft controls, compact and always visible.
- The sheet fills the window, as now. Weather / compass-card chips sit beside the title, only when relevant.

## Menus (only things you will use)
- **File**: New flight, Make a copy, Open Windy route, Download PDF / Print (⌘P), Export file, Import file, Delete.
- **Edit**: Undo (⌘Z), Redo (⇧⌘Z), Reverse route, Clear my edits.
- **Flight**: Update route from Windy link…, Refresh weather, Aircraft & compass card…, Settings (fuel flow, taxi minutes, variation, wind model).

Nothing else. AIRAC and data-source details live in Settings → About, not on screen.

## Permalinks
- Every flight has an id and a URL (`/#/f/k3x9q2`) that opens it directly, ready to edit. Back/forward and reload work as expected.
- Flights are stored in the browser (IndexedDB), auto-saved on every change like Docs, and survive reloads.

## Look & feel
- Familiar Docs/Drive patterns: tiles, list rows with thumbnails, ⋮ menus, Undo toasts, a "Saved" indicator, keyboard shortcuts.
- Calm grey chrome around a white sheet, one accent colour, no explanatory text, no disclaimers.

## Migration
- The current flight in localStorage becomes the first item of "My flights".

## Testing
- E2E for: home list, new blank flight, new flight from Windy, rename, duplicate, delete + undo, permalink reload, back/forward, every menu item, and the print path.
- Screenshots of home and flight at laptop sizes, reviewed before hand-off.
- The existing flight-sheet tests keep running against the new shell.
