"""Parse Greek AIP AD 2 and AD 1.6 (CAT B) text files (pdftotext -layout) into JSON.
Usage: python3 -I parse_ad.py TXT_DIR OUT_JSON
"""
import json, os, re, sys

TXT, OUT = sys.argv[1], sys.argv[2]

COORD = re.compile(r'(\d{2})(\d{2})(\d{2}(?:\.\d+)?)\s*N[,\s]*(\d{2,3})(\d{2})(\d{2}(?:\.\d+)?)\s*E')
FREQ = re.compile(r'(?<![\d.])(\d{3}\.\d{1,3})(\s*MHz|\s*kHz|\s*KHZ)?(?![\d.])')
TERMINAL = ('TOWER', 'INFORMATION', 'GROUND', 'DELIVERY', 'APPROACH', 'RADAR', 'RADIO', 'CONTROL',
            'TWR', 'APP', 'OPS', 'EMERGENCY', 'ARRIVAL', 'DEPARTURE', 'DIRECTOR')
SERVICES = {'APP', 'TWR', 'AFIS', 'ATIS', 'G/A/G', 'TAR', 'GND', 'SMC', 'FIS', 'ACC', 'DEL', 'A/A',
            'UNICOM', 'GCA', 'PAR', 'SRA', 'RADAR', 'VDF', 'ATZ'}


def dms(m):
    lat = int(m[0]) + int(m[1]) / 60 + float(m[2]) / 3600
    lon = int(m[3]) + int(m[4]) / 60 + float(m[5]) / 3600
    return round(lat, 5), round(lon, 5)


def strip_page_furniture(lines):
    out = []
    for l in lines:
        s = l.strip()
        if re.match(r'^(AIP|GREECE|HELLENIC AVIATION SERVICE PROVIDER|AIRAC AMDT|AD 2 LG..-\d+|AD 1\.6\.\d+-\d+)\b', s) and len(re.split(r'\s{2,}', s)) <= 2:
            continue
        if re.match(r'^\d{2} [A-Z]{3} \d{4}$', s):
            continue
        out.append(l)
    return out


def section(lines, num):
    """Lines of section `num` (e.g. '18'), works for 'LGKA AD 2.18' and 'AD 1.6.18.18'."""
    start = None
    pat = re.compile(r'AD (?:2|1\.6\.\d+)\.%s\s+[A-Z]' % num)
    nxt = re.compile(r'AD (?:2|1\.6\.\d+)\.(\d+)\s+[A-Z]')
    for i, l in enumerate(lines):
        if start is None and pat.search(l) and l.strip().isupper() or (start is None and pat.search(l) and 'AD' in l and l.strip().startswith(('LG', 'AD'))):
            start = i + 1
            continue
        if start is not None:
            m = nxt.search(l)
            if m and int(m.group(1)) > int(num) and (l.strip().startswith(('LG', 'AD'))):
                return lines[start:i]
    return lines[start:] if start is not None else []


def parse_freqs(sec):
    # Column where frequencies start (median of VHF token positions)
    cols = [m.start() for l in sec for m in FREQ.finditer(l)]
    if not cols:
        return []
    cols.sort()
    fcol = cols[len(cols) // 2]
    groups = []  # {'callsign': [...], 'closed': bool, 'service': str, 'freqs': []}
    cur = None
    service = ''
    for l in sec:
        if re.search(r'Service\s+Call sign|designation|^\s*1\s+2\s+3', l):
            continue
        if re.match(r'^\s*(ATS Communication|All |For |Note|\* ?Note|ATS services outside)', l):
            break
        fm = None
        for m in FREQ.finditer(l):
            if m.start() >= fcol - 8:
                fm = m
                break
        left = l[:fm.start()] if fm else l[:fcol - 2]
        right = l[fm.end():] if fm else ''
        frags = [f for f in re.split(r'\s{2,}', left.strip()) if f]
        callfrags = []
        for f in frags:
            f2 = f.replace('(cont.)', '').strip()
            if not f2 or f2 in ('(ARR / DEP)', '(ARR/DEP)'):
                continue
            if f2 in SERVICES or f2.split(' ')[0] in SERVICES and len(f2.split(' ')) == 1:
                service = f2
                continue
            if re.fullmatch(r'[A-Z][A-Z /\-\.()&]*', f2):
                callfrags.append(f2)
        for f in callfrags:
            if cur is None or cur['closed']:
                cur = {'callsign': [], 'closed': False, 'service': service, 'freqs': []}
                groups.append(cur)
            cur['callsign'].append(f)
            if f.split()[-1] in TERMINAL:
                cur['closed'] = True
        if fm:
            unit = (fm.group(2) or '').strip()
            mhz = fm.group(1)
            rem = re.sub(r'\s+', ' ', right).strip()
            if cur is None:
                cur = {'callsign': [], 'closed': True, 'service': service, 'freqs': []}
                groups.append(cur)
            cur['freqs'].append({'mhz': mhz, 'unit': unit, 'remark': rem})
        elif cur and cur['freqs'] and l[fcol:].strip() and not frags:
            # remark continuation
            cur['freqs'][-1]['remark'] += ' ' + re.sub(r'\s+', ' ', l.strip())
    out = []
    for g in groups:
        cs = ' '.join(g['callsign'])
        civil = []
        for f in g['freqs']:
            v = float(f['mhz'])
            r = f['remark']
            if f['unit'].lower() == 'khz' or not (118.0 <= v <= 136.975):
                continue
            if abs(v - 121.5) < 1e-6 or 'RFFS' in r:
                continue
            civil.append(f)
        for i, f in enumerate(civil):
            r = f['remark']
            if re.search(r'primary', r, re.I):
                role = 'primary'
            elif re.search(r'secondary|alternat|back.?up|stand.?by|standby', r, re.I):
                role = 'secondary'
            elif len(civil) == 1:
                role = 'primary'
            elif i > 0 and any(re.search('primary', c['remark'], re.I) for c in civil[:i]):
                role = 'secondary'
            else:
                role = 'other'
            # strip operational hours from the remark
            r = re.sub(r'^(H24|HJ|HO|HN|HS|HX|NIL|SR\s*-\s*SS|As AD [A-Z ]+|See [A-Z0-9 .]+ hours)\s+', '', r).strip()
            out.append({'service': g['service'], 'callsign': cs, 'mhz': '%.3f' % float(f['mhz']),
                        'role': role, 'remark': r})
    return out


def pair_runways(desigs):
    def num(d):
        return int(d[:2])
    sfx = {'L': 'R', 'R': 'L', 'C': 'C', '': ''}
    used, pairs = set(), []
    for d in desigs:
        if d in used:
            continue
        n, s = num(d), d[2:]
        rn = (n + 18 - 1) % 36 + 1 if n > 18 else n + 18
        rec = '%02d%s' % (rn, sfx[s])
        used.add(d)
        if rec in desigs:
            used.add(rec)
            a, b = sorted([d, rec], key=num)
            pairs.append(a + '/' + b)
        else:
            pairs.append(d)
    return pairs


def parse_runways(sec):
    desigs = []
    for l in sec:
        m = re.match(r'^\s{0,12}(\d{2}[LRC]?)(?:\s{2,}(?:[\d.]+\s*°?|NIL)(?:\s|$)|\s*$)', l)
        if m:
            d = m.group(1)
            if 1 <= int(d[:2]) <= 36 and d not in desigs:
                desigs.append(d)
    return pair_runways(desigs)


def parse_airspace(sec):
    text = '\n'.join(sec)
    res = []
    for m in re.finditer(r'([A-Z][A-Z /\-]+?)\s+(CTR|ATZ|MIL ATZ|RMZ|TIZ)\s*:', text):
        res.append(m.group(1).strip() + ' ' + m.group(2))
    circles = []
    for m in re.finditer(r'(\d+(?:\.\d+)?)\s*NM\s+radius\s+cent(?:red|ered)\s+(?:at|on)\s+(\d{6}(?:\.\d+)?N\s*\d{7}(?:\.\d+)?E)', text, re.S):
        c = COORD.search(m.group(2))
        if c:
            lat, lon = dms(c.groups())
            circles.append({'radiusNm': float(m.group(1)), 'lat': lat, 'lon': lon})
    return res, circles, re.sub(r'[ \t]+', ' ', text).strip()


def parse_file(path, kind):
    raw = open(path, encoding='utf-8', errors='replace').read().replace('\u039d', 'N').replace('\u0395', 'E')
    if 'AERODROME CLOSED' in raw:
        return None
    lines = strip_page_furniture(raw.splitlines())
    d = {'file': os.path.basename(path)}
    s2 = section(lines, '2')
    for l in s2:
        if 'ARP' in l or COORD.search(l):
            m = COORD.search(l)
            if m:
                d['lat'], d['lon'] = dms(m.groups())
                break
    for l in s2:
        if 'Elevation' in l:
            m = re.search(r'\(?\s*([\d.,]+)\s*FT', l)
            if m:
                d['elevFt'] = round(float(m.group(1).replace(',', '')))
            else:
                m = re.search(r'([\d.]+)\s*M\b', l)
                if m:
                    d['elevFt'] = round(float(m.group(1)) / 0.3048)
            break
    s1 = section(lines, '1')
    if kind == 'ad2':
        for l in lines[:12]:
            m = re.search(r'(LG[A-Z]{2})\s+[–-]\s+(.+)$', l.strip())
            if m:
                d['icao'], d['name'] = m.group(1), m.group(2).strip()
                break
    else:
        for i, l in enumerate(s1):
            if 'Location Indicator' in l:
                vals = [v for v in re.split(r'\s{2,}', ' '.join(s1[i + 1:i + 4]).strip()) if v]
                d['icao'] = vals[0] if vals and re.fullmatch(r'LG[A-Z]{2}|NIL', vals[0]) else None
                d['name'] = vals[1] if len(vals) > 1 else None
                d['group'] = vals[2] if len(vals) > 2 else None
                break
    d['runways'] = parse_runways(section(lines, '12'))
    d['freqs'] = parse_freqs(section(lines, '18'))
    names, circles, atext = parse_airspace(section(lines, '17'))
    d['airspaceNames'] = names
    d['circles'] = circles
    d['airspaceText'] = atext
    return d


res = []
for f in sorted(os.listdir(TXT)):
    if re.fullmatch(r'LG_AD_2_LG[A-Z]{2}_en\.txt', f):
        res.append(parse_file(os.path.join(TXT, f), 'ad2'))
    elif re.fullmatch(r'LG_AD_1_6_\d+_[A-Z\-]+_en\.txt', f) and not re.search(r'_(ADC|APDC|IAC|SID|STAR|VFR)', f):
        res.append(parse_file(os.path.join(TXT, f), 'catb'))
res = [r for r in res if r]
json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)
print(len(res), 'aerodromes')
