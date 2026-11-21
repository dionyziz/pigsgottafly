"""Extract reporting points, VFR route segments and route altitudes from one eAIP VFR chart image.

Usage: python3 -I tools/vfr_chart.py <chart-600dpi-gray.png> <CHART-ID> <out.json> <overlay.png> [known_points.json]

Pipeline: OCR text -> detect reporting-point triangles -> georeference (point anchors, else graticule)
-> name triangles -> coordinates (printed if present, else from the map) -> route lines between
triangles -> OCR a strip along each route for its altitude and distance. Writes an overlay image
for visual verification.
"""
import json, math, os, re, sys
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageFont

sys.path.insert(0, os.path.dirname(__file__))
from ocr_vfr import tesseract_tsv, lines_of, parse_dms, prep, extract_from_lines  # noqa: E402
from vfr_geo import border_words, georef, find_triangles  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
STOP = set('''TMA CTR ATZ MTMA MATZ FIR UIR LGR LGD LGP AND ABOVE BELOW SFC MSL GND FT FL NM APP TWR INFO VOR DME NDB
AIRFIELD AIRPORT CLASS OF AIRSPACE THE HOLDING SEE PAGE NOT TO SCALE ROUTE ROUTES VFR AT OR AREA TRAINING
HELIPORT MIL SECTOR WEST EAST NORTH SOUTH TOWER ARRIVAL DEPARTURE ATIS FIC SCALE LEGEND CONTOUR ELEVATIONS
ALTITUDES BEARINGS TRACKS RADIALS MAGNETIC DISTANCES IN FEET NAUTICAL MILES VAR ANNUAL CHANGE ATHINAI
MAKEDONIA BRINDISI TIRANA ISTANBUL HEL'''.split())


def nm(a, b):
    return 60 * math.hypot(a[0] - b[0], (a[1] - b[1]) * math.cos(math.radians((a[0] + b[0]) / 2)))


GRAY = None
_aip = None
AD = {}


def load_ad():
    """aerodrome reference points from data/aip.js (to pick reporting points near each chart)"""
    p = os.path.join(os.path.dirname(__file__), '..', 'data', 'aip.js')
    s = open(p).read()
    d = json.loads(s[s.index('{'):s.rindex('}') + 1])
    for a in d['aerodromes']:
        if a.get('icao'):
            AD[a['icao']] = (a['lat'], a['lon'])


def ink(o):
    """darkest print inside a box: black labels ~0-40, grey place names ~90+"""
    reg = GRAY[int(o['y0']):int(o['y1']) + 1, int(o['x0']):int(o['x1']) + 1]
    txt = reg[reg < 200]
    return float(np.median(txt)) if txt.size else 255


def phrases(words):
    """Upper-case name phrases: words of one OCR line, then vertically stacked lines joined (EAST / POROS)."""
    L = []
    for ln in lines_of(words):
        t = re.sub(r"[^A-Z .'\-]", '', ln['text']).strip(" .-'")
        toks = [x for x in t.split() if len(x) >= 2]
        if not toks or all(x in STOP for x in toks) or len(t.replace(' ', '')) < 3:
            continue
        if ln['h'] < 30:          # tiny print: place names on the topography, not reporting points
            continue
        if ink(ln) > 60:          # grey print: islands / places, not reporting points
            continue
        L.append(dict(ln, name=' '.join(toks)))
    L.sort(key=lambda o: o['y0'])
    used, out = set(), []
    for i, a in enumerate(L):
        if i in used:
            continue
        cur = dict(a)
        for j in range(i + 1, len(L)):
            b = L[j]
            if j in used:
                continue
            if 0 <= b['y0'] - cur['y1'] < 0.7 * cur['h'] and abs(b['h'] - cur['h']) < 0.35 * cur['h'] and \
               min(cur['x1'], b['x1']) - max(cur['x0'], b['x0']) > 0.3 * min(cur['x1'] - cur['x0'], b['x1'] - b['x0']):
                cur = dict(cur, name=cur['name'] + ' ' + b['name'], y1=b['y1'], x0=min(cur['x0'], b['x0']), x1=max(cur['x1'], b['x1']))
                used.add(j)
        out.append(cur)
    return out


def box_dist(px, py, o):
    dx = max(o['x0'] - px, 0, px - o['x1'])
    dy = max(o['y0'] - py, 0, py - o['y1'])
    return math.hypot(dx, dy)


def fit_affine(pairs):
    """RANSAC affine pixel->(lat, lon) from (x, y, lat, lon) pairs."""
    P = np.array(pairs, float)
    if len(P) < 3:
        return None
    best = None
    rng = np.random.default_rng(1)
    for _ in range(400):
        idx = rng.choice(len(P), 3, replace=False)
        A = np.c_[P[idx, 0], P[idx, 1], np.ones(3)]
        try:
            ca = np.linalg.solve(A, P[idx, 2]); cb = np.linalg.solve(A, P[idx, 3])
        except np.linalg.LinAlgError:
            continue
        Af = np.c_[P[:, 0], P[:, 1], np.ones(len(P))]
        err = np.array([nm((Af[k] @ ca, Af[k] @ cb), (P[k, 2], P[k, 3])) for k in range(len(P))])
        inl = err < 0.25
        if best is None or inl.sum() > best.sum():
            best = inl
    if best is None or best.sum() < 3:
        return None
    Af = np.c_[P[best, 0], P[best, 1], np.ones(best.sum())]
    ca, *_ = np.linalg.lstsq(Af, P[best, 2], rcond=None)
    cb, *_ = np.linalg.lstsq(Af, P[best, 3], rcond=None)
    err = [nm((np.r_[x, y, 1] @ ca, np.r_[x, y, 1] @ cb), (la, lo)) for x, y, la, lo in P[best]]
    inv = np.linalg.inv(np.array([[ca[0], ca[1]], [cb[0], cb[1]]]))
    return {'to_ll': lambda x, y: (float(np.r_[x, y, 1] @ ca), float(np.r_[x, y, 1] @ cb)),
            'to_px': lambda lat, lon: tuple(inv @ (np.array([lat, lon]) - np.array([ca[2], cb[2]]))),
            'n': int(best.sum()), 'rms_nm': float(np.sqrt(np.mean(np.square(err))))}


def georef_by_points(tris, known, dpi=600):
    """North-up chart: x = s*E + tx, y = -s*N + ty with E, N in NM. Match triangle pairs to known-point
    pairs with the same bearing and a plausible scale; keep the transform that lands most triangles on
    known points; then refine with a full affine fit on those matches."""
    if len(tris) < 3 or len(known) < 3:
        return None
    lat0 = np.mean([k['lat'] for k in known])
    cosr = math.cos(math.radians(lat0))
    K = np.array([[k['lon'] * 60 * cosr, k['lat'] * 60] for k in known])
    T = np.array([[t[0], t[1]] for t in tris])
    smin, smax = dpi / 25.4 * 1852 / 700000 * 1000, dpi / 25.4 * 1852 / 180000 * 1000   # px per NM
    ti, tj = np.triu_indices(len(T), 1)
    tv = T[tj] - T[ti]
    tl = np.hypot(tv[:, 0], tv[:, 1])
    ta = np.degrees(np.arctan2(-tv[:, 1], tv[:, 0]))
    ki, kj = np.triu_indices(len(K), 1)
    kv = K[kj] - K[ki]
    kl = np.hypot(kv[:, 0], kv[:, 1])
    ka = np.degrees(np.arctan2(kv[:, 1], kv[:, 0]))
    best = (0, None)
    for a in range(len(ti)):
        if tl[a] < 150:
            continue
        for sign in (1, -1):        # pair orientation
            ang = (ka - ta[a] + (0 if sign == 1 else 180) + 540) % 360 - 180
            sc = tl[a] / np.maximum(kl, 1e-6)
            ok = np.where((np.abs(ang) < 2.0) & (sc > smin) & (sc < smax))[0]
            for b in ok[:400]:
                s_ = sc[b]
                k1 = ki[b] if sign == 1 else kj[b]
                tx = T[ti[a], 0] - s_ * K[k1, 0]
                ty = T[ti[a], 1] + s_ * K[k1, 1]
                # project known points, count triangles within 0.4 NM of one
                P = np.c_[s_ * K[:, 0] + tx, -s_ * K[:, 1] + ty]
                d = np.min(np.hypot(T[:, None, 0] - P[None, :, 0], T[:, None, 1] - P[None, :, 1]), axis=1) / s_
                n = int((d < 0.4).sum())
                if n > best[0]:
                    best = (n, (s_, tx, ty))
    if best[0] < 3:
        return None
    s_, tx, ty = best[1]
    P = np.c_[s_ * K[:, 0] + tx, -s_ * K[:, 1] + ty]
    pairs = []
    for t in T:
        d = np.hypot(P[:, 0] - t[0], P[:, 1] - t[1]) / s_
        j = int(np.argmin(d))
        if d[j] < 0.4:
            pairs.append((t[0], t[1], known[j]['lat'], known[j]['lon']))
    g = fit_affine(pairs)
    if g:
        g['matches'] = len(pairs)
    return g


def coordinate_entries(img, words):
    """Printed coordinates (boxes or tables) with their position."""
    COORD_FRAG = re.compile(r"\d{1,3}\s*[°º*o]\s*\d{2}|\d{2}\s*['’]\s*\d{2}")
    frags = [w for w in words if COORD_FRAG.search(w['text'])]
    seen, out = [], []
    for w in sorted(frags, key=lambda w: (w['y'], w['x'])):
        h = max(25, w['h'])
        x0, y0 = max(0, int(w['x'] - 5 * h)), max(0, int(w['y'] - 3.2 * h))
        x1, y1 = min(img.width, int(w['x'] + 14 * h)), min(img.height, int(w['y'] + 3.2 * h))
        if any(abs(x0 - a) < 3 * h and abs(y0 - b) < 1.2 * h for a, b in seen):
            continue
        seen.append((x0, y0))
        got = {}
        for thr in (150, 110, 190):
            for p in extract_from_lines(lines_of(tesseract_tsv(prep(img.crop((x0, y0, x1, y1)), 2.0, thr), psm=6))):
                k = (round(p['lat'], 4), round(p['lon'], 4))
                got.setdefault(k, []).append(p['name'])
        for (lat, lon), names in got.items():
            names = [n for n in names if n]
            out.append({'lat': lat, 'lon': lon, 'name': max(set(names), key=names.count) if names else None,
                        'votes': len(got[(lat, lon)]), 'cx': (x0 + x1) / 2, 'cy': (y0 + y1) / 2, 'h': h})
    # keep the best-supported reading per spot
    out.sort(key=lambda e: -e['votes'])
    keep = []
    for e in out:
        if any(math.hypot(e['cx'] - k['cx'], e['cy'] - k['cy']) < 4 * e['h'] and nm((e['lat'], e['lon']), (k['lat'], k['lon'])) < 3 for k in keep):
            continue
        keep.append(e)
    return keep


def dark_line_ratio(gray, p, q, skip, halfw=14, thr=110):
    L = math.hypot(q[0] - p[0], q[1] - p[1])
    if L < 3 * skip:
        return 0
    ux, uy = (q[0] - p[0]) / L, (q[1] - p[1]) / L
    nx, ny = -uy, ux
    n = int(L / 12)
    hits = tot = 0
    H, W = gray.shape
    for k in range(n):
        t = skip + (L - 2 * skip) * k / max(1, n - 1)
        x, y = p[0] + ux * t, p[1] + uy * t
        ok = False
        for o in range(-halfw, halfw + 1, 3):
            xx, yy = int(x + nx * o), int(y + ny * o)
            if 0 <= xx < W and 0 <= yy < H and gray[yy, xx] < thr:
                ok = True
                break
        hits += ok; tot += 1
    return hits / max(1, tot)


ALT = re.compile(r"^\(?(\d{3,5})['’`\"]?\)?$")
DIST = re.compile(r"^\((\d{1,2}(?:[.,]\d)?)\)$|^(\d{1,3}(?:[.,]\d)?)NM$")


def strip_text(img, p, q, skip):
    """OCR a strip along the segment p->q (rotated to horizontal), both orientations."""
    L = math.hypot(q[0] - p[0], q[1] - p[1])
    ang = math.degrees(math.atan2(q[1] - p[1], q[0] - p[0]))
    cx, cy = (p[0] + q[0]) / 2, (p[1] + q[1]) / 2
    half = int(L / 2 - skip)
    pad = 330
    big = int(math.hypot(half, pad)) + 20
    x0, y0 = int(cx - big), int(cy - big)
    crop = img.crop((x0, y0, x0 + 2 * big, y0 + 2 * big))
    rot = crop.rotate(ang, resample=Image.BICUBIC, fillcolor=255)
    c = big
    strip = rot.crop((c - half, c - pad, c + half, c + pad))
    res = []
    for flip in (False, True):
        s = strip.rotate(180) if flip else strip
        a = np.asarray(s)
        s2 = Image.fromarray(np.where(a < 120, 0, 255).astype(np.uint8))
        toks = [w['text'] for w in tesseract_tsv(s2, psm=11) if w['conf'] > 40]
        alts, dists = [], []
        heli = any(re.match(r'^\(?HEL', t.upper()) for t in toks)
        for i, t in enumerate(toks):
            if re.fullmatch(r'\d{1,3}', t) and i + 1 < len(toks) and toks[i + 1].upper() in ('NM', 'NM.'):
                dists.append(float(t))
                continue
            t = t.replace('O', '0').replace('o', '0').replace(' ', '')
            if '°' in t:
                continue
            m = DIST.match(t)
            if m:
                dists.append(float((m[1] or m[2]).replace(',', '.')))
                continue
            if re.fullmatch(r'\d{1,2}', t):
                dists.append(float(t))
                continue
            m = ALT.match(t)
            if m and not t.startswith('('):
                v = int(m[1])
                if 500 <= v <= 12000 and v % 100 == 0:
                    alts.append(v)
        res.append({'alts': alts, 'dists': dists, 'toks': toks, 'heli': heli})
    return max(res, key=lambda r: len(r['alts']) * 2 + len(r['dists']))


def main():
    path, chart, out_path, overlay_path = sys.argv[1:5]
    # known points: [{name, lat, lon, src}] from the AIP coordinate tables and openflightmaps (all of Greece)
    known = json.load(open(sys.argv[5])) if len(sys.argv) > 5 and os.path.exists(sys.argv[5]) else []
    global GRAY
    load_ad()
    img = Image.open(path).convert('L')
    gray = np.asarray(img)
    GRAY = gray
    W, H = img.size
    words = tesseract_tsv(img, psm=11)
    tris = find_triangles(gray)
    entries = coordinate_entries(img, words)
    phr = phrases(words)

    # names of triangles: nearest name phrase (reviewed afterwards; see tools/vfr_overrides.json)
    pts = []
    for (x, y, s) in tris:
        cand = sorted(((box_dist(x, y, o), o) for o in phr), key=lambda t: t[0])
        name = cand[0][1]['name'] if cand and cand[0][0] < 9 * s else None
        pts.append({'x': x, 'y': y, 's': s, 'name': name, 'name_d': cand[0][0] / s if cand else None})

    # anchors: printed coordinates next to a triangle, and known (tabulated) points by name
    pairs = []
    for e in entries:
        near = min(pts, key=lambda p: math.hypot(p['x'] - e['cx'], p['y'] - e['cy']), default=None)
        if near and math.hypot(near['x'] - e['cx'], near['y'] - e['cy']) < 22 * e['h']:
            pairs.append((near['x'], near['y'], e['lat'], e['lon']))
    # known points around this chart: same aerodrome in OFM / AIP tables, else within 70 NM of the chart's aerodrome
    local = [k for k in known if k.get('ad') == chart or k.get('chart') == chart]
    if len(local) < 6 and AD.get(chart):
        a0 = AD[chart]
        local = [k for k in known if nm((k['lat'], k['lon']), a0) < 70]
    geo = georef_by_points(tris, local)
    method = 'points'
    if not geo or geo['n'] < 4:
        g2 = fit_affine(pairs)
        if g2 and g2['n'] >= 4:
            geo, method = g2, 'anchors'
    if not geo or geo['n'] < 4:
        g = georef(border_words(img, tesseract_tsv), W, H)
        if g:
            geo = {'to_ll': g['to_ll'], 'to_px': g['to_px'], 'n': g['x']['n'] + g['y']['n'], 'rms_nm': None}
            method = 'graticule'
    # refine: snap triangles to known reporting points and refit (twice)
    if geo and known:
        for _ in range(2):
            m = []
            for p in pts:
                ll = geo['to_ll'](p['x'], p['y'])
                q = min(known, key=lambda k: nm(ll, (k['lat'], k['lon'])))
                if nm(ll, (q['lat'], q['lon'])) < 1.2:
                    m.append((p['x'], p['y'], q['lat'], q['lon']))
            g2 = fit_affine(m) if len(m) >= 3 else None
            if g2 and g2['n'] >= 3:
                geo, method = g2, method + '+snap'
    if not geo:
        json.dump({'chart': chart, 'error': 'could not georeference'}, open(out_path, 'w'))
        print(chart, 'could not georeference'); return

    # coordinates: printed value if one sits by the triangle and agrees with the map, else the map position
    for p in pts:
        lat, lon = geo['to_ll'](p['x'], p['y'])
        p['map'] = (round(lat, 5), round(lon, 5))
        best = None
        for e in entries:
            d = nm((e['lat'], e['lon']), (lat, lon))
            if d < 0.6 and (best is None or d < best[0]):
                best = (d, e)
        near = sorted(known, key=lambda k: nm((k['lat'], k['lon']), (lat, lon)))
        near = [k for k in near if nm((k['lat'], k['lon']), (lat, lon)) < 0.9]
        kn = min(near, key=lambda k: ({'table': 0, 'ofm': 1}.get(k['src'], 2), nm((k['lat'], k['lon']), (lat, lon)))) if near else None
        if kn:
            p['ocr_name'] = p['name']
            p['name'], p['lat'], p['lon'], p['src'] = kn['name'], kn['lat'], kn['lon'], kn['src']
            if kn['src'] == 'ofm' and best:   # the AIP chart's printed name/coordinates beat openflightmaps
                p['lat'], p['lon'], p['src'] = best[1]['lat'], best[1]['lon'], 'printed'
                if best[1]['name']:
                    p['name'] = best[1]['name']
        elif best:
            p['lat'], p['lon'], p['src'] = best[1]['lat'], best[1]['lon'], 'printed'
            if not p['name'] and best[1]['name']:
                p['name'] = best[1]['name']
        else:
            p['lat'], p['lon'], p['src'] = p['map'][0], p['map'][1], 'map'

    # points the AIP prints (tables/boxes) or that are known nearby, but whose symbol was not detected
    # (e.g. hidden under a holding pattern), become nodes at their projected position
    extra = [dict(name=e['name'], lat=e['lat'], lon=e['lon'], src='printed') for e in entries if e['name']]
    extra += [dict(k) for k in local]
    for k in extra:
        x, y = geo['to_px'](k['lat'], k['lon'])
        if not (0 < x < W and 0 < y < H):
            continue
        if any(nm((p['lat'], p['lon']), (k['lat'], k['lon'])) < 0.6 for p in pts):
            continue
        pts.append({'x': float(x), 'y': float(y), 's': float(np.median([t[2] for t in tris])) if tris else 90.0,
                    'name': k['name'], 'lat': k['lat'], 'lon': k['lon'], 'src': k['src'] + '-nosymbol', 'map': (k['lat'], k['lon'])})

    # routes: solid dark lines between points, with no other point in between
    segs = []
    for i in (range(0) if os.environ.get('VFR_NO_ROUTES') else range(len(pts))):
        for j in range(i + 1, len(pts)):
            a, b = pts[i], pts[j]
            d = math.hypot(a['x'] - b['x'], a['y'] - b['y'])
            skip = 0.9 * max(a['s'], b['s'])
            if d < 3 * skip:
                continue
            between = False
            for c in pts:
                if c is a or c is b:
                    continue
                t = ((c['x'] - a['x']) * (b['x'] - a['x']) + (c['y'] - a['y']) * (b['y'] - a['y'])) / (d * d)
                if 0.05 < t < 0.95:
                    px, py = a['x'] + t * (b['x'] - a['x']), a['y'] + t * (b['y'] - a['y'])
                    if math.hypot(c['x'] - px, c['y'] - py) < 1.3 * c['s']:
                        between = True
                        break
            if between:
                continue
            r = dark_line_ratio(gray, (a['x'], a['y']), (b['x'], b['y']), skip)
            if r >= 0.8:
                st = strip_text(img, (a['x'], a['y']), (b['x'], b['y']), skip)
                if (not st['alts'] and not st['dists']) or st['heli']:
                    continue  # unlabelled (airspace boundaries etc.) or helicopter-only routes
                gnm = nm((a['lat'], a['lon']), (b['lat'], b['lon']))
                segs.append({'a': i, 'b': j, 'ratio': round(r, 3), 'alts': st['alts'], 'dists': st['dists'], 'nm': round(gnm, 1),
                             'dist_ok': any(abs(x - gnm) <= max(1.5, 0.1 * gnm) for x in st['dists']) if st['dists'] else None})

    # the pixel -> (lat, lon) map as an affine matrix (exact for both fitting methods)
    o, ex, ey = geo['to_ll'](0, 0), geo['to_ll'](1000, 0), geo['to_ll'](0, 1000)
    M = [[(ex[0] - o[0]) / 1000, (ey[0] - o[0]) / 1000, o[0]], [(ex[1] - o[1]) / 1000, (ey[1] - o[1]) / 1000, o[1]]]
    out = {'chart': chart, 'georef': {'method': method, 'n': geo['n'], 'rms_nm': geo['rms_nm'], 'M': M},
           'points': [{k: p[k] for k in ('name', 'lat', 'lon', 'src', 'x', 'y')} for p in pts],
           'segments': segs, 'entries': entries}
    json.dump(out, open(out_path, 'w'), indent=1, default=float)

    # overlay for visual verification
    ov = Image.open(path).convert('RGB')
    dr = ImageDraw.Draw(ov)
    try:
        font = ImageFont.truetype('/System/Library/Fonts/Supplemental/Arial Bold.ttf', 70)
    except OSError:
        font = ImageFont.load_default()
    for s in segs:
        a, b = pts[s['a']], pts[s['b']]
        col = (0, 170, 0) if s['dist_ok'] else (230, 120, 0) if s['dist_ok'] is None else (220, 0, 0)
        dr.line((a['x'], a['y'], b['x'], b['y']), fill=col, width=18)
        mx, my = (a['x'] + b['x']) / 2, (a['y'] + b['y']) / 2
        dr.text((mx + 20, my + 20), f"{'/'.join(map(str, s['alts'])) or '?'} {s['dists'] or ''}~{s['nm']}", fill=(200, 0, 200), font=font)
    for p in pts:
        dr.ellipse((p['x'] - 45, p['y'] - 45, p['x'] + 45, p['y'] + 45), outline=(0, 0, 255), width=12)
        dr.text((p['x'] + 60, p['y'] - 100), f"{p['name']} [{p['src']}]", fill=(0, 0, 255), font=font)
    ov.resize((ov.width // 3, ov.height // 3)).save(overlay_path)
    print(chart, method, f"anchors={geo['n']} rms={geo['rms_nm']}", len(pts), 'points', len(segs), 'segments')


if __name__ == '__main__':
    main()
