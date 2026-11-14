"""Extract VFR reporting points (name + WGS84 coordinates) from the Greek eAIP VFR chart PDFs.

Usage: python3 -I tools/parse_vfr.py <dir with *_VFR_en.txt from `pdftotext -layout`> <out.json>
Each chart has a "COORDINATES ... OF REPORTING POINTS" table, often two points per printed line.
"""
import json, os, re, sys

SRC, OUT = sys.argv[1], sys.argv[2]
Q = r"['’′`]"          # minute marks seen in the charts
QQ = r"(?:[\"”″]|''|’’)"  # second marks
COORD = re.compile(
    r"(?:^|\s{2,})(?P<name>[A-Z][A-Z0-9 ()/.\-Α-Ω]*?)\s{1,}\*?\s*"
    r"(?P<la>\d{2})\s*°\s*(?P<lm>\d{2})\s*" + Q + r"\s*(?P<ls>\d{2}(?:[.,]\d+)?)\s*" + QQ + r"?\s*N[\s,]+"
    r"(?P<lo>\d{2,3})\s*°\s*(?P<om>\d{2})\s*" + Q + r"\s*(?P<os>\d{2}(?:[.,]\d+)?)\s*" + QQ + r"?\s*E")
COMPACT = re.compile(r"(?P<name>[A-Z][A-Z0-9 ()/.\-]*?)\s{2,}(?P<lat>\d{6}(?:\.\d+)?)\s*N\s+(?P<lon>\d{7}(?:\.\d+)?)\s*E")


def clean(n):
    n = re.sub(r'\s*\([A-Z0-9]{2,4}\)\s*$', '', n)  # "EGN (EGN)", "MEGARA (LGMG)" -> name only
    return re.sub(r'\s+', ' ', n).strip(' *-.')


def dec(d, m, s):
    return int(d) + int(m) / 60 + float(s.replace(',', '.')) / 3600


out = {}
for f in sorted(os.listdir(SRC)):
    if not f.endswith('_VFR_en.txt'):
        continue
    chart = re.search(r'(LG[A-Z]{2})_VFR', f).group(1)
    txt = open(os.path.join(SRC, f), encoding='utf-8', errors='replace').read()
    txt = txt.replace('Ν', 'N').replace('Ε', 'E')
    pts = []
    for line in txt.splitlines():
        found = False
        for m in COORD.finditer(line):
            pts.append({'name': clean(m.group('name')),
                        'lat': round(dec(m['la'], m['lm'], m['ls']), 5), 'lon': round(dec(m['lo'], m['om'], m['os']), 5)})
            found = True
        if not found:
            for m in COMPACT.finditer(line):
                la, lo = m['lat'], m['lon']
                pts.append({'name': clean(m.group('name')),
                            'lat': round(dec(la[:2], la[2:4], la[4:]), 5), 'lon': round(dec(lo[:3], lo[3:5], lo[5:]), 5)})
    # de-duplicate by name
    seen, uniq = set(), []
    for p in pts:
        if p['name'] not in seen and 34 < p['lat'] < 42 and 19 < p['lon'] < 30:
            seen.add(p['name']); uniq.append(p)
    out[chart] = uniq
json.dump(out, open(OUT, 'w'), indent=1, ensure_ascii=False)
for k, v in out.items():
    print(k, len(v))
