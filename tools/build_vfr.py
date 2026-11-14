"""Build data/vfr.js: VFR reporting points and VFR route segments with altitudes for every chart,
with independent checks.

Usage: python3 -I tools/build_vfr.py tools/vfr_points.json tools/vfr_charts tools/vfr_ocr tools/ofm_points.json data/vfr.js

Sources:
  vfr_points.json    points from charts that tabulate coordinates as text (LGAV, LGTG, LGIR; parse_vfr.py)
  vfr_charts/*.json  per-chart transcription of the AIP VFR chart: points (printed coordinates, or a
                     reference to openflightmaps / the chart's map position) and route segments
  vfr_ocr/*.json     per-chart image analysis (vfr_chart.py): georeferenced reporting-point symbols
  ofm_points.json    open flightmaps VFR reporting points (fetch_ofm.py)
Checks (any failure aborts the build):
  - a printed coordinate must sit on a reporting-point symbol of the georeferenced chart image (0.5 NM)
    when the image analysis georeferenced that chart, and within 1.5 NM of openflightmaps if OFM has it
  - a route's printed distance must match its endpoints' coordinates (within max(1.5 NM, 8 %))
  - route endpoints must exist, altitude bands must be sane
"""
import glob, json, math, os, re, sys

table_path, charts_dir, ocr_dir, ofm_path, out_path = sys.argv[1:6]
table = json.load(open(table_path))
ofm = json.load(open(ofm_path))['points']


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


norm = lambda n: re.sub(r'[^A-Z]', '', n.upper()).replace('AGIOS', 'AG')
ocr = {}
for f in glob.glob(os.path.join(ocr_dir, '*.json')):
    d = json.load(open(f))
    if 'points' in d and d.get('georef', {}).get('n', 0) >= 4:
        ocr.setdefault(d['chart'], []).append(d)

errors, warnings, points, routes = [], [], [], []
for f in sorted(g for g in glob.glob(os.path.join(charts_dir, '*.json')) if not g.endswith('manifest.json')):
    ch = os.path.basename(f)[:-5]
    spec = json.load(open(f))
    P = {p['name']: dict(p, src='table') for p in table.get(ch, [])}
    syms = [q for d in ocr.get(ch, []) for q in d['points'] if not q['src'].endswith('nosymbol')]
    for p in spec.get('points', []):
        name = p['name']
        if 'dms' in p:
            lat, lon = dms(p['dms'])
            q = {'name': name, 'lat': lat, 'lon': lon, 'src': 'chart'}
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
            x = min(o, key=lambda x: 0 if x['ad'] == ch else 1)
            q = {'name': name, 'lat': x['lat'], 'lon': x['lon'], 'src': 'ofm'}
            if syms and 0.6 < min(nm(q, s) for s in syms) <= 3:   # >3 NM: its symbol was not detected
                warnings.append(f"{ch} {name}: openflightmaps position {min(nm(q, s) for s in syms):.2f} NM from the chart symbol")
        elif p.get('from') == 'map':   # position of the chart symbol (georeferenced image analysis)
            near = p['near']
            s = min(syms, key=lambda s: nm(s, {'lat': near[0], 'lon': near[1]})) if syms else None
            if not s or nm(s, {'lat': near[0], 'lon': near[1]}) > 1.0:
                errors.append(f"{ch} {name}: no chart symbol near {near}"); continue
            q = {'name': name, 'lat': round(s['lat'], 5), 'lon': round(s['lon'], 5), 'src': 'map'}
        else:
            errors.append(f"{ch} {name}: no coordinates"); continue
        P[name] = q
    for r in spec.get('routes', []):
        A, B = P.get(r['a']), P.get(r['b'])
        if not A or not B:
            errors.append(f"{ch}: unknown point in {r['a']}–{r['b']}"); continue
        if r.get('nm') is not None and abs(nm(A, B) - r['nm']) > max(1.5, 0.08 * r['nm']):
            errors.append(f"{ch}: {r['a']}–{r['b']} chart says {r['nm']} NM, coordinates give {nm(A, B):.1f} NM")
        if not (300 <= r['min'] <= r['max'] <= 12500):
            errors.append(f"{ch}: bad altitude band {r['a']}–{r['b']}")
        routes.append({'chart': ch, 'a': r['a'], 'b': r['b'], 'min': r['min'], 'max': r['max'], 'oneway': bool(r.get('oneway'))})
    points += [dict(p, chart=ch) for p in P.values()]

# every other published reporting point (open flightmaps) helps name clicked waypoints
for q in ofm:
    if not any(norm(p['name']) == norm(q['name']) and nm(p, q) < 1.5 for p in points):
        points.append({'name': q['name'], 'lat': q['lat'], 'lon': q['lon'], 'chart': q['ad'] or 'LGGG', 'src': 'ofm'})

print('\n'.join('warning: ' + w for w in warnings))
if errors:
    print('\n'.join('ERROR: ' + e for e in errors)); sys.exit(1)
with open(out_path, 'w') as fh:
    fh.write('// Generated by tools/build_vfr.py from the eAIP VFR route charts and open flightmaps. Do not edit by hand.\n')
    fh.write('window.VFR = ' + json.dumps({'points': [{k: p[k] for k in ('name', 'lat', 'lon', 'chart', 'src')} for p in points],
                                           'routes': routes}, ensure_ascii=False, separators=(',', ':')) + ';\n')
from collections import Counter
print(len(points), 'points', dict(Counter(p['src'] for p in points)), len(routes), 'route segments', dict(Counter(r['chart'] for r in routes)))
