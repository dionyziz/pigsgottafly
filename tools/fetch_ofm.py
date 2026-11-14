"""Download the open flightmaps (OFMX) data set for Greece and extract the VFR reporting points.

Usage: python3 -I tools/fetch_ofm.py <AIRAC, e.g. 2611> tools/ofm_points.json

Data: open flightmaps (https://www.openflightmaps.org), region LGGG. Used here to name VFR reporting
points that the AIP charts show only graphically. Where the AIP prints coordinates, those win.
"""
import io, json, re, sys, urllib.request, zipfile

airac, out = sys.argv[1], sys.argv[2]
url = f'https://snapshots.openflightmaps.org/live/{airac}/ofmx/lggg/latest/ofmx_lg.zip'
data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'navlog-builder'})).read()
z = zipfile.ZipFile(io.BytesIO(data))
name = next(n for n in z.namelist() if n.endswith('isolated/ofmx_lg.ofmx'))
s = z.read(name).decode('utf-8')
pts = []
for d in re.findall(r'<Dpn\b.*?</Dpn>', s, re.S):
    if '<codeType>VFR-MRP</codeType>' not in d:
        continue
    g = lambda t: re.search(r'<%s>([^<]*)</%s>' % (t, t), d)[1]
    la, lo = g('geoLat'), g('geoLong')
    ad = re.search(r'<AhpUidAssoc[^>]*>\s*<codeId>([^<]*)', d)
    nm = g('txtName').strip()
    nm = re.sub(r'^AG ', 'AGIOS ', nm)
    pts.append({'name': nm, 'lat': round(float(la[:-1]) * (1 if la[-1] == 'N' else -1), 6),
                'lon': round(float(lo[:-1]) * (1 if lo[-1] == 'E' else -1), 6), 'ad': ad[1] if ad else None})
json.dump({'airac': airac, 'source': url, 'points': pts}, open(out, 'w'), indent=0, ensure_ascii=False)
print(len(pts), 'VFR reporting points from open flightmaps', airac)
