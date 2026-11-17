"""Build public/terrain/greece.bin: the highest ground in each 0.01° cell over Greece.

Usage: python3 -I tools/build_terrain.py <tile cache dir> public/terrain/greece.bin

Source: AWS Terrain Tiles (Mapzen terrarium encoding, public, no key;
https://registry.opendata.aws/terrain-tiles/), zoom 10 (pixels ~120 m at 38°N). Every pixel's
height goes into the cell holding its centre; a cell keeps the highest. The tiles have spikes (single
pixels and blocks of up to 3×3, hundreds of metres high, some at sea): a pixel more than SPIKE_M
above every pixel two steps away (the ring around its 3×3 block, ~240 m off) is taken down to the
highest of that ring. A real summit has a ridge or slope reaching the ring on some side.
Taller blocks survive that, so every cell still more than CHECK_M above all eight neighbouring cells
is checked against a second model, the Copernicus 90 m DEM (Open-Meteo elevation API, 5 × 5 points
in the cell): when that says lower, the cell takes the second model's highest point + SAMPLE_PAD_M
(25 points can miss the top by ~20 m).

Format (src/calc/terrain.ts TERRAIN_GRID): rows from SOUTH to north, columns from west to east, one
byte per cell = ceil(metres / 12) (0 for sea and ground at or below sea level), so a cell never
says lower than the tiles do.
"""
import json, math, os, sys, time, urllib.error, urllib.request

import numpy as np
from PIL import Image

CACHE, OUT = sys.argv[1], sys.argv[2]
SOUTH, NORTH, WEST, EAST = 34.0, 42.0, 19.0, 30.0
STEP = 0.01
UNIT_M = 12
Z = 10
SPIKE_M = 300
CHECK_M = 150
SAMPLE_PAD_M = 30
ELEVATION = 'https://api.open-meteo.com/v1/elevation?latitude={lat}&longitude={lon}'
URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'

ROWS = round((NORTH - SOUTH) / STEP)
COLS = round((EAST - WEST) / STEP)
n = 2 ** Z


def tile_x(lon):
    return int((lon + 180) / 360 * n)


def tile_y(lat):
    r = math.radians(lat)
    return int((1 - math.log(math.tan(r) + 1 / math.cos(r)) / math.pi) / 2 * n)


def tile(x, y):
    f = os.path.join(CACHE, f'{Z}-{x}-{y}.png')
    if not os.path.exists(f):
        with urllib.request.urlopen(URL.format(z=Z, x=x, y=y), timeout=60) as r:
            data = r.read()
        with open(f + '.tmp', 'wb') as fh:
            fh.write(data)
        os.replace(f + '.tmp', f)
    a = np.asarray(Image.open(f).convert('RGB'), dtype=np.float64)
    return despike(a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768)


def despike(h):
    p = np.pad(h, 2, mode='edge')
    ring = [(dy, dx) for dy in range(-2, 3) for dx in range(-2, 3) if max(abs(dy), abs(dx)) == 2]
    around = np.max([p[2 + dy : p.shape[0] - 2 + dy, 2 + dx : p.shape[1] - 2 + dx] for dy, dx in ring], axis=0)
    spikes = h > around + SPIKE_M
    despike.count += int(spikes.sum())
    return np.where(spikes, around, h)


despike.count = 0


os.makedirs(CACHE, exist_ok=True)
grid = np.zeros(ROWS * COLS, dtype=np.float64)
xs = range(tile_x(WEST), tile_x(EAST) + 1)
ys = range(tile_y(NORTH), tile_y(SOUTH) + 1)
pix = (np.arange(256) + 0.5) / 256
for x in xs:
    lon = (x + pix) / n * 360 - 180
    for y in ys:
        lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (y + pix) / n))))
        h = tile(x, y)
        lat2, lon2 = np.meshgrid(lat, lon, indexing='ij')
        r = np.floor((lat2 - SOUTH) / STEP).astype(int)
        c = np.floor((lon2 - WEST) / STEP).astype(int)
        ok = (r >= 0) & (r < ROWS) & (c >= 0) & (c < COLS)
        np.maximum.at(grid, r[ok] * COLS + c[ok], h[ok])
    print(f'column {x - xs.start + 1}/{len(xs)}', file=sys.stderr)


def copernicus_max(r, c):
    f = os.path.join(CACHE, f'copernicus-{r}-{c}.json')
    if not os.path.exists(f):
        ts = (np.arange(5) + 0.5) / 5
        pts = [(SOUTH + (r + a) * STEP, WEST + (c + b) * STEP) for a in ts for b in ts]
        url = ELEVATION.format(
            lat=','.join(f'{la:.5f}' for la, _ in pts), lon=','.join(f'{lo:.5f}' for _, lo in pts)
        )
        for attempt in range(5):
            try:
                with urllib.request.urlopen(url, timeout=60) as resp:
                    data = resp.read()
                break
            except urllib.error.HTTPError as e:
                if e.code != 429 or attempt == 4:
                    raise
                time.sleep(65)  # its per-minute limit counts each point
        time.sleep(3)
        with open(f, 'wb') as fh:
            fh.write(data)
    with open(f) as fh:
        return max(json.load(fh)['elevation'])


g2 = grid.reshape(ROWS, COLS)
p = np.pad(g2, 1, mode='edge')
around = np.max([p[1 + dy : ROWS + 1 + dy, 1 + dx : COLS + 1 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx], axis=0)
checked = fixed = 0
for r, c in np.argwhere(g2 > around + CHECK_M):
    checked += 1
    other = copernicus_max(int(r), int(c))
    if other < g2[r, c] - CHECK_M:
        fixed += 1
        g2[r, c] = max(other, 0) + SAMPLE_PAD_M
print(f'{checked} lone high cells checked against Copernicus, {fixed} lowered', file=sys.stderr)

units = np.clip(np.ceil(np.maximum(grid, 0) / UNIT_M), 0, 255).astype(np.uint8)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
with open(OUT, 'wb') as fh:
    fh.write(units.tobytes())
print(f'{OUT}: {ROWS}x{COLS}, highest {grid.max():.0f} m, {despike.count} spikes removed', file=sys.stderr)
