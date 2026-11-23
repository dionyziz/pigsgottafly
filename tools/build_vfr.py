"""Build data/vfr.js: VFR reporting points and VFR route segments with altitudes for every chart,
with independent checks.

Usage: python3 -I tools/build_vfr.py tools/vfr_points.json tools/vfr_charts tools/vfr_ocr tools/ofm_points.json data/vfr.js

Sources:
  vfr_points.json    reporting points printed as text (tools/parse_vfr.ts): the coordinate tables of the
                     VFR charts LGAV, LGIR, LGKL, LGTG and the heliports' AD 3.N.21 reporting points, and the
                     AIP reference of every VFR chart ('AD 2-LGKV-VFR', 'AD 1.6.29-LGTG-VFR')
  vfr_charts/*.json  per-chart transcription of the AIP VFR chart image: points (printed coordinates as `dms`,
                     a reference to openflightmaps `"from": "ofm"`, the chart's map position `"from": "map"`, or
                     `"same_as": "<ICAO>"` for a point another chart prints with coordinates) and route segments.
                     A point printed in a table is taken from the table; its spec entry only adds checks.
  vfr_ocr/*.json     per-chart image analysis (vfr_chart.py): georeferenced reporting-point symbols
  ofm_points.json    open flightmaps VFR reporting points (fetch_ofm.py)
Checks (any failure aborts the build):
  - a printed coordinate must sit on a reporting-point symbol of the georeferenced chart image (0.5 NM)
    when the image analysis georeferenced that chart, and within 1.5 NM of openflightmaps if OFM has it
  - every point lies inside the FIR (src/data/ref/fir.json; up to 3 NM outside its drawn border is a warning)
    and within 120 NM of its chart's aerodrome
  - a route's printed distance must match its endpoints' coordinates (within max(1.5 NM, 8 %))
  - route endpoints must exist, altitude bands must be sane (min = max = null: the chart draws the segment
    but prints no altitude for it), `kind` absent or hel / mil / jet (a segment marked HEL ONLY, MIL ONLY or
    JET ONLY on the chart)
Points published in several places (same name within 1 NM: e.g. ABLONAS on the LGAV and LGTG charts, KEA on
the LGAV chart and the AD 3.19 / AD 3.70 heliport tables) become one point listing every chart and AIP source.
Its `chart` is the chart whose VFR routes use it; a point that is a route end on two charts is kept once per
chart (route segments are looked up by chart and name).
"""
import glob, json, math, os, re, sys

table_path, charts_dir, ocr_dir, ofm_path, out_path = sys.argv[1:6]
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
tables = json.load(open(table_path))
ofm = json.load(open(ofm_path))['points']
FIR = json.load(open(os.path.join(ROOT, 'src', 'data', 'ref', 'fir.json')))['boundary']
ARP = {a['icao']: a for a in json.load(open(os.path.join(ROOT, 'src', 'data', 'ref', 'aerodromes.json'))) if a.get('icao')}
MAX_FROM_AD_NM = 120
MERGE_NM = 1.0


def nm(a, b):
    la1, la2 = math.radians(a['lat']), math.radians(b['lat'])
    dl = math.radians(b['lon'] - a['lon'])
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dl / 2) ** 2
    return 2 * 3440.065 * math.asin(math.sqrt(h))


def dms(s):
    m = re.fullmatch(r'\s*(\d+)\s+(\d+)\s+([\d.]+)\s*([NS])\s+(\d+)\s+(\d+)\s+([\d.]+)\s*([EW])\s*', s)
    lat = int(m[1]) + int(m[2]) / 60 + float(m[3]) / 3600
    lon = int(m[5]) + int(m[6]) / 60 + float(m[7]) / 3600
    return round(lat * (1 if m[4] == 'N' else -1), 6), round(lon * (1 if m[8] == 'E' else -1), 6)


def in_fir(p):
    inside, ring = False, FIR
    for i in range(len(ring)):
        (y1, x1), (y2, x2) = ring[i], ring[i - 1]
        if (y1 > p['lat']) != (y2 > p['lat']) and p['lon'] < (x2 - x1) * (p['lat'] - y1) / (y2 - y1) + x1:
            inside = not inside
    return inside


def nm_to_fir(p):
    """Distance (NM) from p to the FIR boundary (flat-earth, fine at a few NM)."""
    k = math.cos(math.radians(p['lat']))
    best = float('inf')
    for i in range(len(FIR)):
        (y1, x1), (y2, x2) = FIR[i - 1], FIR[i]
        ax, ay, bx, by = (x1 - p['lon']) * k * 60, (y1 - p['lat']) * 60, (x2 - p['lon']) * k * 60, (y2 - p['lat']) * 60
        dx, dy = bx - ax, by - ay
        t = max(0.0, min(1.0, -(ax * dx + ay * dy) / (dx * dx + dy * dy or 1)))
        best = min(best, math.hypot(ax + t * dx, ay + t * dy))
    return best


def lev(a, b):
    d = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, d[0] = d[0], i
        for j, cb in enumerate(b, 1):
            prev, d[j] = d[j], min(d[j] + 1, d[j - 1] + 1, prev + (ca != cb))
    return d[-1]


norm = lambda n: re.sub(r'[^A-Z0-9]', '', n.upper()).replace('AGIOS', 'AG')


def similar(a, b):
    """Same point name in another spelling: 'OSCARA'/'OSCAR', 'GONNOI'/'GONNI', 'FLABOURO'/'A/F FLABOURO'."""
    a, b = norm(a), norm(b)
    return a == b or (min(len(a), len(b)) >= 4 and (a in b or b in a or lev(a, b) <= 2))


ocr = {}
for f in glob.glob(os.path.join(ocr_dir, '*.json')):
    d = json.load(open(f))
    if 'points' in d and d.get('georef', {}).get('n', 0) >= 4:
        ocr.setdefault(d['chart'], []).append(d)

errors, warnings, routes = [], [], []
specs = {os.path.basename(f)[:-5]: json.load(open(f))
         for f in sorted(glob.glob(os.path.join(charts_dir, '*.json'))) if not f.endswith('manifest.json')}
charts = sorted(set(specs) | {k for k, t in tables.items() if t['points']})
REF = {k: t['ref'] for k, t in tables.items()}
P = {}          # chart -> name -> point
deferred = []   # (chart, spec point) printed with coordinates on another chart
for ch in charts:
    if ch not in REF:
        errors.append(f"{ch}: no AIP reference (not in {table_path}; rerun tools/parse_vfr.ts)"); continue
    spec = specs.get(ch, {})
    ref = REF[ch]
    P[ch] = {p['name']: dict(p, src='table', sources=[ref]) for p in tables.get(ch, {'points': []})['points']}
    syms = [q for d in ocr.get(ch, []) for q in d['points'] if not q['src'].endswith('nosymbol')]
    for p in spec.get('points', []):
        name = p['name']
        extra = [p['ref']] if p.get('ref') else []
        if 'same_as' in p:
            deferred.append((ch, p)); continue
        if name in P[ch] and 'dms' not in p:
            # printed in the chart's table: the table wins; open flightmaps only checks it
            o = [x for x in ofm if norm(x['name']) == norm(p.get('ofm_name', name))]
            d_ofm = min((nm(P[ch][name], x) for x in o), default=None)
            if d_ofm is not None and d_ofm > 1.5:
                warnings.append(f"{ch} {name}: table position {d_ofm:.1f} NM from openflightmaps (AIP value used)")
            continue
        if 'dms' in p:
            lat, lon = dms(p['dms'])
            q = {'name': name, 'lat': lat, 'lon': lon, 'src': 'chart', 'sources': [ref] + extra}
            # independent checks of the transcribed coordinates: a reporting-point symbol on the
            # georeferenced chart image, or the same point in open flightmaps
            # nearest symbol not better explained by another transcribed point of this chart
            others = [x for x in spec['points'] if 'dms' in x and x['name'] != name]
            free = [s for s in syms if not any(nm(dict(zip(('lat', 'lon'), dms(x['dms']))), s) < nm(q, s) for x in others)]
            d_sym = min((nm(q, s) for s in free), default=None)
            if syms and d_sym is not None and d_sym > 3:
                d_sym = None   # its symbol was not detected (e.g. on a boundary line or under a holding)
            o = [x for x in ofm if norm(x['name']) == norm(p.get('ofm_name', name))]
            d_ofm = min((nm(q, x) for x in o), default=None)
            on_sym = d_sym is not None and d_sym <= 0.6
            on_ofm = d_ofm is not None and d_ofm <= 1.0
            if p.get('reviewed'):
                warnings.append(f"{ch} {name}: reviewed by hand — {p['reviewed']}")
            elif not on_sym and not on_ofm and not p.get('no_symbol'):
                if d_sym is None and d_ofm is None:
                    warnings.append(f"{ch} {name}: no independent check available (chart image not georeferenced, not in openflightmaps)")
                else:
                    errors.append(f"{ch} {name}: printed coordinates are {d_sym if d_sym is not None else float('nan'):.2f} NM from the nearest chart symbol and {d_ofm if d_ofm is not None else float('nan'):.2f} NM from openflightmaps")
            elif d_ofm is not None and d_ofm > 1.5:
                warnings.append(f"{ch} {name}: {d_ofm:.1f} NM from openflightmaps (AIP value used)")
        elif p.get('from') == 'ofm':
            o = [x for x in ofm if norm(x['name']) == norm(p.get('ofm_name', name))]
            if not o:
                errors.append(f"{ch} {name}: not in openflightmaps"); continue
            mine = [x for x in o if x['ad'] == ch]
            if not mine and len(o) > 1 and max(nm(o[0], x) for x in o) > MERGE_NM:
                errors.append(f"{ch} {name}: several openflightmaps points of that name, none on {ch}: use same_as"); continue
            x = (mine or o)[0]
            q = {'name': name, 'lat': x['lat'], 'lon': x['lon'], 'src': 'ofm', 'sources': [ref] + extra}
            if syms and 0.6 < min(nm(q, s) for s in syms) <= 3:   # >3 NM: its symbol was not detected
                warnings.append(f"{ch} {name}: openflightmaps position {min(nm(q, s) for s in syms):.2f} NM from the chart symbol")
        elif p.get('from') == 'map':   # position of the chart symbol (georeferenced image analysis)
            near = p['near']
            s = min(syms, key=lambda s: nm(s, {'lat': near[0], 'lon': near[1]})) if syms else None
            if not s or nm(s, {'lat': near[0], 'lon': near[1]}) > 1.0:
                errors.append(f"{ch} {name}: no chart symbol near {near}"); continue
            q = {'name': name, 'lat': round(s['lat'], 5), 'lon': round(s['lon'], 5), 'src': 'map', 'sources': [ref] + extra}
        else:
            errors.append(f"{ch} {name}: no coordinates"); continue
        P[ch][name] = q

# points printed (with coordinates) on another chart
for ch, p in deferred:
    other = P.get(p['same_as'], {}).get(p.get('as', p['name']))
    if not other:
        errors.append(f"{ch} {p['name']}: not on the {p['same_as']} chart"); continue
    P[ch][p['name']] = dict(other, name=p['name'], sources=[REF[ch]], copied=True)

for ch in P:
    for name, q in P[ch].items():
        if not in_fir(q):
            # points on the FIR / TMA boundary may fall just outside the drawn border
            (errors if nm_to_fir(q) > 3 else warnings).append(
                f"{ch} {name}: {q['lat']:.4f}, {q['lon']:.4f} is {nm_to_fir(q):.1f} NM outside the FIR boundary")
        if ch in ARP and nm(q, ARP[ch]) > MAX_FROM_AD_NM:
            errors.append(f"{ch} {name}: {nm(q, ARP[ch]):.0f} NM from {ch}")
    for r in specs.get(ch, {}).get('routes', []):
        A, B = P[ch].get(r['a']), P[ch].get(r['b'])
        if not A or not B:
            errors.append(f"{ch}: unknown point in {r['a']}–{r['b']}"); continue
        if r.get('nm') is not None and abs(nm(A, B) - r['nm']) > max(1.5, 0.08 * r['nm']):
            errors.append(f"{ch}: {r['a']}–{r['b']} chart says {r['nm']} NM, coordinates give {nm(A, B):.1f} NM")
        if (r['min'] is None) != (r['max'] is None):
            errors.append(f"{ch}: {r['a']}–{r['b']} has only one of min/max (both null when the chart prints no altitude)")
        elif r['min'] is not None and not (300 <= r['min'] <= r['max'] <= 12500):
            errors.append(f"{ch}: bad altitude band {r['a']}–{r['b']}")
        if r.get('kind') not in (None, 'hel', 'mil', 'jet'):
            errors.append(f"{ch}: {r['a']}–{r['b']} kind {r['kind']!r} is not hel, mil or jet")
        routes.append({'chart': ch, 'a': r['a'], 'b': r['b'], 'min': r['min'], 'max': r['max'], 'oneway': bool(r.get('oneway')),
                       **({'kind': r['kind']} if r.get('kind') else {})})

# one point per place: the same name within MERGE_NM on several charts / AIP pages
RANK = {'table': 0, 'chart': 1, 'map': 2, 'ofm': 3}
on_route = {(r['chart'], n) for r in routes for n in (r['a'], r['b'])}
flat = sorted(((ch, q) for ch in P for q in P[ch].values()),
              key=lambda cq: (RANK[cq[1]['src']], bool(cq[1].get('copied')), cq[0].startswith('AD 3'), cq[0]))
groups = []
for ch, q in flat:
    g = next((g for g in groups if norm(g[0][1]['name']) == norm(q['name']) and nm(g[0][1], q) <= MERGE_NM), None)
    if g is None:
        groups.append([(ch, q)])
    else:
        best = g[0][1]
        if q['src'] in ('table', 'chart') and best['src'] in ('table', 'chart') and nm(best, q) > 0.2:
            warnings.append(f"{q['name']}: {g[0][0]} and {ch} print positions {nm(best, q):.2f} NM apart ({g[0][0]} used)")
        g.append((ch, q))
points = []
for g in groups:
    best = g[0][1]
    all_charts = list(dict.fromkeys(ch for ch, _ in g))
    sources = list(dict.fromkeys(s for _, q in g for s in q['sources']))
    route_charts = [ch for ch, q in g if (ch, q['name']) in on_route]
    for ch in route_charts or [g[0][0]]:
        name = next(q['name'] for c, q in g if c == ch)
        points.append({'name': name, 'lat': best['lat'], 'lon': best['lon'], 'chart': ch, 'src': best['src'],
                       'charts': all_charts, 'sources': sources})

# every other published reporting point (open flightmaps) helps name clicked waypoints; another spelling of
# a point the AIP prints nearby ('OSCAR' for 'OSCARA', KATERO 2.6 NM from the LGTS table position) is left out
for q in ofm:
    if any(similar(p['name'], q['name']) and nm(p, q) < 5 for p in points):
        continue
    points.append({'name': q['name'], 'lat': q['lat'], 'lon': q['lon'], 'chart': q['ad'] or 'LGGG', 'src': 'ofm',
                   'charts': [], 'sources': []})

print('\n'.join('warning: ' + w for w in warnings))
if errors:
    print('\n'.join('ERROR: ' + e for e in errors)); sys.exit(1)
with open(out_path, 'w') as fh:
    fh.write('// Generated by tools/build_vfr.py from the eAIP VFR route charts and open flightmaps. Do not edit by hand.\n')
    fh.write('window.VFR = ' + json.dumps({'points': [{k: p[k] for k in ('name', 'lat', 'lon', 'chart', 'src', 'charts', 'sources')} for p in points],
                                           'routes': routes}, ensure_ascii=False, separators=(',', ':')) + ';\n')
from collections import Counter
print(len(points), 'points', dict(Counter(p['src'] for p in points)), len(routes), 'route segments', dict(Counter(r['chart'] for r in routes)))
for ch in charts:
    print(f"   {ch} ({REF.get(ch)}): {len(P.get(ch, {}))} points")
