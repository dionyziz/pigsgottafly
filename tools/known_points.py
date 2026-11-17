"""Reference points for georeferencing the chart images (tools/vfr_chart.py):
AIP text tables, AIP coordinates transcribed from the charts, and open flightmaps.

Usage: python3 -I tools/known_points.py tools/vfr_points.json tools/vfr_charts tools/ofm_points.json <out.json>
"""
import glob, json, os, re, sys

table_path, charts_dir, ofm_path, out = sys.argv[1:5]
known = []
for ch, t in json.load(open(table_path)).items():   # tools/parse_vfr.ts: {chart: {ref, points}}
    known += [dict(name=p['name'], lat=p['lat'], lon=p['lon'], src='table', chart=ch) for p in t['points']]
for f in (g for g in glob.glob(os.path.join(charts_dir, '*.json')) if not g.endswith('manifest.json')):
    ch = os.path.basename(f)[:-5]
    for p in json.load(open(f)).get('points', []):
        if 'dms' in p and not p.get('no_symbol'):
            m = re.fullmatch(r'\s*(\d+)\s+(\d+)\s+([\d.]+)\s*N\s+(\d+)\s+(\d+)\s+([\d.]+)\s*E\s*', p['dms'])
            known.append(dict(name=p['name'], lat=int(m[1]) + int(m[2]) / 60 + float(m[3]) / 3600,
                              lon=int(m[4]) + int(m[5]) / 60 + float(m[6]) / 3600, src='table', chart=ch))
for p in json.load(open(ofm_path))['points']:
    known.append(dict(name=p['name'], lat=p['lat'], lon=p['lon'], src='ofm', ad=p['ad']))
json.dump(known, open(out, 'w'))
print(len(known), 'known points')
