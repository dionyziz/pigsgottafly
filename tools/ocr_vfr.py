"""OCR the Greek eAIP VFR route charts (raster images) into reporting points and route altitudes.

Usage:
  python3 -I tools/ocr_vfr.py points <chart.png> <out.json>         # reporting points (name + WGS84)
  python3 -I tools/ocr_vfr.py routes <chart.png> <points.json> <out.json> [debug.png]

Requires the `tesseract` CLI. Charts are rendered with `pdftoppm -r 600 -gray -png`.
"""
import json, math, re, subprocess, sys, os, tempfile
from PIL import Image, ImageDraw
import numpy as np

Image.MAX_IMAGE_PIXELS = None


def tesseract_tsv(img, psm=11, extra=()):
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'in.png')
        img.save(p)
        out = subprocess.run(['tesseract', p, 'stdout', '--psm', str(psm), *extra, 'tsv'], capture_output=True, text=True).stdout
    rows = []
    for ln in out.splitlines()[1:]:
        f = ln.split('\t')
        if len(f) < 12 or not f[11].strip():
            continue
        rows.append({'block': int(f[2]), 'par': int(f[3]), 'line': int(f[4]), 'x': int(f[6]), 'y': int(f[7]),
                     'w': int(f[8]), 'h': int(f[9]), 'conf': float(f[10]), 'text': f[11]})
    return rows


def lines_of(words):
    groups = {}
    for w in words:
        groups.setdefault((w['block'], w['par'], w['line']), []).append(w)
    out = []
    for ws in groups.values():
        ws.sort(key=lambda w: w['x'])
        x0 = min(w['x'] for w in ws); y0 = min(w['y'] for w in ws)
        x1 = max(w['x'] + w['w'] for w in ws); y1 = max(w['y'] + w['h'] for w in ws)
        out.append({'text': ' '.join(w['text'] for w in ws), 'x0': x0, 'y0': y0, 'x1': x1, 'y1': y1, 'h': y1 - y0,
                    'conf': min(w['conf'] for w in ws)})
    return out


# --- coordinates: tolerate OCR noise in the degree/minute/second marks -----------------------------
def parse_dms(s, hemi, deg_digits):
    """'39°35'37.00"N' / '019°57'17.00°E' / '393516.4N' -> decimal degrees, or None."""
    m = re.search(r'([0-9][0-9°º*o\'’`"”.,: ]{5,20})\s*' + hemi + r'\b', s.replace('|', ' '))
    if not m:
        return None
    raw = m.group(1)
    # keep digits and the decimal separator of the seconds
    parts = re.findall(r'\d+(?:[.,]\d+)?', raw)
    digits = ''.join(parts)
    cands = []
    if len(parts) >= 3:
        cands.append((parts[0], parts[1], parts[2]))
    plain = re.sub(r'[.,]\d+$', '', digits)
    dec = re.search(r'[.,](\d+)$', digits)
    frac = ('.' + dec.group(1)) if dec else ''
    for dd in (deg_digits, deg_digits - 1):
        if len(plain) >= dd + 4:
            cands.append((plain[:dd], plain[dd:dd + 2], plain[dd + 2:dd + 4] + frac))
    for d, mi, se in cands:
        try:
            d, mi, se = int(d), int(mi), float(se.replace(',', '.'))
        except ValueError:
            continue
        if mi < 60 and se < 60:
            v = d + mi / 60 + se / 3600
            if (hemi == 'N' and 34 <= v <= 42) or (hemi == 'E' and 19 <= v <= 30):
                return round(v, 5)
    return None


NAME = re.compile(r"^[A-Z][A-Z .'\-/()]{1,30}$")


def clean_name(t):
    t = re.sub(r'[^A-Z .\-/()]', '', t.upper()).strip(' .-')
    t = re.sub(r'\s*\([A-Z0-9]{2,4}\)$', '', t)
    return re.sub(r'\s+', ' ', t)


def extract_points(img):
    words = tesseract_tsv(img, psm=11)
    L = lines_of(words)
    found = []
    for i, ln in enumerate(L):
        lat = parse_dms(ln['text'], 'N', 2)
        if lat is None:
            continue
        lon = parse_dms(ln['text'], 'E', 3)
        lon_box = ln
        if lon is None:  # the longitude on the line just below
            below = [o for o in L if 0 < o['y0'] - ln['y0'] < 2.6 * ln['h'] and abs(o['x0'] - ln['x0']) < 4 * ln['h']]
            below.sort(key=lambda o: o['y0'])
            for o in below:
                lon = parse_dms(o['text'], 'E', 3)
                if lon is not None:
                    lon_box = o
                    break
        if lon is None:
            continue
        # the name: nearest upper-case line just above, overlapping horizontally
        above = [o for o in L if 0 < ln['y0'] - o['y1'] < 2.2 * ln['h'] and o['x1'] > ln['x0'] - 2 * ln['h'] and o['x0'] < ln['x1'] + 2 * ln['h']]
        above.sort(key=lambda o: ln['y0'] - o['y1'])
        name = None
        for o in above:
            t = clean_name(o['text'])
            if len(t) >= 3 and NAME.match(t) and not re.search(r'\d', o['text']):
                name = t
                break
        if not name:  # name on the same line, left of the latitude (tables)
            m = re.match(r"\s*([A-Z][A-Z .'\-]{2,})\s+\d", ln['text'])
            if m:
                name = clean_name(m.group(1))
        found.append({'name': name, 'lat': lat, 'lon': lon,
                      'box': [min(ln['x0'], lon_box['x0']), ln['y0'] - (int(1.6 * ln['h']) if name else 0), max(ln['x1'], lon_box['x1']), lon_box['y1']]})
    return found, L


def prep(img, scale=2.0, thr=150):
    """Upscale and binarize: keeps dark print, drops tints/terrain shading."""
    g = img.resize((int(img.width * scale), int(img.height * scale)), Image.LANCZOS)
    a = np.asarray(g)
    return Image.fromarray(np.where(a < thr, 0, 255).astype(np.uint8))


COORD_FRAG = re.compile(r"\d{1,3}\s*[°º*o]\s*\d{2}|\d{2}\s*['’]\s*\d{2}|\d{4,}.*[NE]\b")


def extract_points_refined(img):
    """Locate coordinate fragments on the whole chart, then re-read each spot from a clean crop."""
    words = tesseract_tsv(img, psm=11)
    frags = [w for w in words if COORD_FRAG.search(w['text'])]
    seen_regions, found = [], []
    for w in sorted(frags, key=lambda w: (w['y'], w['x'])):
        h = max(20, w['h'])
        x0, y0 = max(0, w['x'] - 6 * h), max(0, w['y'] - 3 * h)
        x1, y1 = min(img.width, w['x'] + 16 * h), min(img.height, w['y'] + 4 * h)
        if any(abs(x0 - a) < 3 * h and abs(y0 - b) < 1.5 * h for a, b in seen_regions):
            continue
        seen_regions.append((x0, y0))
        crop = img.crop((x0, y0, x1, y1))
        for thr in (150, 110):
            sub = tesseract_tsv(prep(crop, 2.0, thr), psm=6)
            for p in extract_from_lines(lines_of(sub)):
                p['box'] = [x0, y0, x1, y1]
                found.append(p)
    return found


def extract_from_lines(L):
    out = []
    L = sorted(L, key=lambda o: o['y0'])
    for i, ln in enumerate(L):
        lat = parse_dms(ln['text'], 'N', 2)
        if lat is None:
            continue
        lon = parse_dms(ln['text'], 'E', 3)
        if lon is None:
            for o in L[i + 1:i + 3]:
                lon = parse_dms(o['text'], 'E', 3)
                if lon is not None:
                    break
        if lon is None:
            continue
        name = None
        m = re.match(r"\s*([A-Z][A-Z .'\-]{2,})\s+\d", ln['text'])
        if m:
            name = clean_name(m.group(1))
        for o in reversed(L[max(0, i - 2):i]):
            if name:
                break
            t = clean_name(o['text'])
            if len(t) >= 3 and NAME.match(t) and not re.search(r'\d', o['text']):
                name = t
        out.append({'name': name, 'lat': lat, 'lon': lon})
    return out


def merge(found):
    """Same name seen in the table and next to the point: keep it once; flag disagreements."""
    by = {}
    for p in found:
        if not p['name']:
            continue
        by.setdefault(p['name'], []).append(p)
    out, issues = [], []
    for name, ps in by.items():
        ref = ps[0]
        agree = [q for q in ps if abs(q['lat'] - ref['lat']) < 0.003 and abs(q['lon'] - ref['lon']) < 0.003]
        if len(agree) < len(ps):
            issues.append({'name': name, 'variants': [(q['lat'], q['lon']) for q in ps]})
        out.append({'name': name, 'lat': ref['lat'], 'lon': ref['lon'], 'seen': len(ps), 'boxes': [q['box'] for q in ps]})
    return out, issues


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'points':
        img = Image.open(sys.argv[2]).convert('L')
        found = extract_points_refined(img)
        pts, issues = merge(found)
        unnamed = [p for p in found if not p['name']]
        json.dump({'points': pts, 'issues': issues, 'unnamed': unnamed}, open(sys.argv[3], 'w'), indent=1)
        for p in pts:
            print(f"{p['name']:<22} {p['lat']:.5f} {p['lon']:.5f}  x{p['seen']}")
        print('issues:', issues)
        print('unnamed coordinates:', [(p['lat'], p['lon']) for p in unnamed])
