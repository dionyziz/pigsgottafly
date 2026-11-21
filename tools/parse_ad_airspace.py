"""Aerodrome ATS airspace (CTR / ATZ, AD 2.17 and AD 1.6.N.17) from the Greek eAIP text.

Usage: python3 -I tools/parse_ad_airspace.py TXT_DIR src/data/ref/aerodromes.json src/data/ref/atc-units.json OUT_JSON

TXT_DIR holds `pdftotext -layout` output of the AD 2 and AD 1.6 aerodrome PDFs (tools/update_aip.sh step 2).
Writes src/data/ref/ad-airspaces.json: one record per CTR / ATZ with its exact lateral limits (circles as
centre + radius; polygons and arcs as [lat, lon] vertices), vertical limits, class, ATS units with their
frequencies (from the ATC units of the reference data) and the AIP text it came from.

Most aerodromes publish "<NAME> [MIL] CTR|ATZ:" followed by "A circle, R NM radius centred at <coord>" or
a list of coordinates. The few lateral limits made of arcs are written out in ARCS below from the AIP text
(quoted next to each), and checked by tests/unit/data/adAirspaces.test.ts against the published radii.
"""
import json, math, os, re, sys

TXT, ADS, UNITS, OUT = sys.argv[1:5]

COORD = re.compile(r'(\d{2})(\d{2})(\d{2}(?:\.\d+)?)\s*N[,\s]*(\d{3})(\d{2})(\d{2}(?:\.\d+)?)\s*E')
R_NM = 3440.065


def dms(g):
    lat = int(g[0]) + int(g[1]) / 60 + float(g[2]) / 3600
    lon = int(g[3]) + int(g[4]) / 60 + float(g[5]) / 3600
    return round(lat, 6), round(lon, 6)


def coord(s):
    m = COORD.search(s)
    if not m:
        raise ValueError('no coordinate in ' + s)
    return dms(m.groups())


def bearing(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def dist_nm(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R_NM * math.asin(min(1, math.sqrt(h)))


def dest(c, brg, nm):
    d, b = nm / R_NM, math.radians(brg)
    p1, l1 = math.radians(c[0]), math.radians(c[1])
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(b))
    l2 = l1 + math.atan2(math.sin(b) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return round(math.degrees(p2), 6), round(math.degrees(l2), 6)


def arc(centre, radius, start, end, cw):
    """Vertices strictly between start and end along the circle (every ~3°)."""
    b0, b1 = bearing(centre, start), bearing(centre, end)
    sweep = (b1 - b0) % 360 if cw else -((b0 - b1) % 360)
    n = max(2, int(abs(sweep) / 3))
    return [dest(centre, b0 + sweep * i / n, radius) for i in range(1, n)]


# Navaids the arcs are centred on (ENR 4.1).
IRA = coord('352026.68N 0251106.52E')   # IRAKLION VOR/DME
SHT = coord('351307.04N 0260624.35E')   # SITIA VOR/DME SHT 112.90


def build(spec):
    """spec: list of ('pt', coord) | ('arc', centre, radiusNm, 'cw'|'ccw', endCoord). Closed ring."""
    ring = []
    for item in spec:
        if item[0] == 'pt':
            ring.append(item[1])
        else:
            _, c, r, d, end = item
            ring += arc(c, r, ring[-1], end, d == 'cw')
            ring.append(end)
    if ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


# Lateral limits with arcs, by record id, transcribed from the AIP text quoted.
ARCS = {
    # LGEL AD 2.17: "380224.16N 0232714.69E - 375238.15N 0232337.91E - 375238.15N 0233727.91E -
    # 380316.89N 0233928.56E - and north of the aerodrome: by an arc of a circle, 5 NM radius centred
    # from 380406.17N 0233312.91E which coincides with the north limits of ELEFSIS MIL ATZ."
    'LGEL-CTR': [('pt', coord('380224.16N 0232714.69E')), ('pt', coord('375238.15N 0232337.91E')),
                 ('pt', coord('375238.15N 0233727.91E')), ('pt', coord('380316.89N 0233928.56E')),
                 ('arc', coord('380406.17N 0233312.91E'), 5, 'ccw', coord('380224.16N 0232714.69E'))],
    # LGIR AD 2.17: "a) 351240N 0250400E b) 352430N 0252220E c) 351140N 0252900E d) 350410N 0251740E.
    # Points (a) and (b) are joined by an arc of circle lying East, radius 10 NM centred on IRA VOR/DME.
    # Points (b) and (c), (c) and (d), (d) and (a) are joined by straight lines."
    'LGIR-CTR': [('pt', coord('351240N 0250400E')),
                 ('arc', IRA, 10, 'ccw', coord('352430N 0252220E')),
                 ('pt', coord('351140N 0252900E')), ('pt', coord('350410N 0251740E'))],
    # LGKV AD 2.17: "410214N 0242441E, then clockwise on arc of circle 12 NM radius centred on LGKV ARP
    # until 405325N 0242127E, then to 405353N 0241735E, then to 405740N 0242252E then to 410214N 0242441E."
    'LGKV-CTR': [('pt', coord('410214N 0242441E')),
                 ('arc', coord('405450N 0243711E'), 12, 'cw', coord('405325N 0242127E')),
                 ('pt', coord('405353N 0241735E')), ('pt', coord('405740N 0242252E'))],
    # LGPA AD 2.17: "a) 365400N 0245400E b) 370000N 0244900E c) 371800N 0244900E d) 371330N 0251100E.
    # Last (d) and first (a) points are joined by an arc of circle 13 NM radius centre at (370037N 0250741E)."
    'LGPA-CTR': [('pt', coord('365400N 0245400E')), ('pt', coord('370000N 0244900E')),
                 ('pt', coord('371800N 0244900E')), ('pt', coord('371330N 0251100E')),
                 ('arc', coord('370037N 0250741E'), 13, 'cw', coord('365400N 0245400E'))],
    # LGST AD 2.17: "a) 351447N 0255421E b) 353501N 0255129E c) 351823N 0263618E d) 350833N 0261717E
    # Points (b) and (c) are joined by an arc of circle with radius 25 NM centered on SHT VOR/DME.
    # Points (d) and (a) are joined by an arc of circle with radius 10 NM centered on SHT VOR/DME."
    'LGST-CTR': [('pt', coord('351447N 0255421E')), ('pt', coord('353501N 0255129E')),
                 ('arc', SHT, 25, 'cw', coord('351823N 0263618E')),
                 ('pt', coord('350833N 0261717E')),
                 ('arc', SHT, 10, 'cw', coord('351447N 0255421E'))],
    # AD 1.6.12.17: "KAVALA LYDIA ATZ. 405353N 0241735E, then follow clockwise on arc of circle, 5 NM radius
    # centred on AMIGDALEON ARP up to 410214N 0242441E, 405740N 0242252E, 405353N 0241735E."
    'LGKM-ATZ': [('pt', coord('405353N 0241735E')),
                 ('arc', 'ARP', 5, 'cw', coord('410214N 0242441E')),
                 ('pt', coord('405740N 0242252E'))],
}

LABELS = [('lat', r'Designation and lateral limits'), ('vert', r'Vertical limits'), ('cls', r'Airspace classification'),
          ('units', r'ATS unit call sign'), ('lang', r'Language\(s\)'), ('ta', r'Transition altitude'),
          ('hours', r'Hours of applicability'), ('rem', r'Remarks')]
FURNITURE = re.compile(r'^\s*(AIP|GREECE|HELLENIC AVIATION SERVICE PROVIDER|AIRAC AMDT \d+/\d+|AD 2 LG..-\d+|AD 1\.6\.\d+-\d+|\d{2} [A-Z]{3} \d{4}\b)')
DESIG = re.compile(r'^([A-Z][A-Z /\-]+?)\s+((?:MIL\s+)?(?:CTR|ATZ))\s*[:.]?$')


def section17(lines):
    out, on = [], False
    for l in lines:
        if re.search(r'AD (?:2|1\.6\.\d+)\.17\s+ATS AIRSPACE', l):
            on = True
            continue
        if on and re.search(r'AD (?:2|1\.6\.\d+)\.18\s+[A-Z]', l):
            break
        if on:
            out.append(l)
    return out


def items(lines):
    """Split the section into its numbered items; returns {key: [right-column lines]}."""
    res, cur = {}, None
    for raw in lines:
        if not raw.strip() or FURNITURE.match(raw) and len(re.split(r'\s{2,}', raw.strip())) <= 2:
            continue
        l = raw
        for key, lab in LABELS:
            m = re.search(r'^\s*(?:\d\s+)?' + lab + r'\s*', l)
            if m:
                cur = 'units' if key == 'lang' else key
                l = l[m.end():]
                break
        l = re.sub(r'^\s*\d\s*$', '', l)  # a lone item number
        t = re.sub(r'\s+', ' ', l).strip()
        if cur and t:
            res.setdefault(cur, []).append(t)
    return res


def kind_of(prefix, desigs):
    """Designation addressed by a 'MIL CTR:' / 'ATZ :' prefix (or the only one)."""
    if prefix:
        p = re.sub(r'\s+', ' ', prefix.strip())
        for d in desigs:
            if d['kind'] == ('CTR' if 'CTR' in p else 'ATZ'):
                return d
    return desigs[0] if len(desigs) == 1 else None


PREFIX = re.compile(r'^((?:MIL\s+)?(?:CTR|ATZ))\s*:\s*')


def by_prefix(lines, desigs):
    """{record id: [lines]} for items written as 'CTR: …' / 'ATZ: …' blocks."""
    out, cur = {}, desigs[0] if len(desigs) == 1 else None
    for l in lines:
        m = PREFIX.match(l)
        if m:
            cur = kind_of(m.group(1), desigs)
            l = l[m.end():]
        if cur and l:
            out.setdefault(cur['id'], []).append(l)
    return out


def norm_limit(s):
    s = s.strip().rstrip('.').strip()
    s = re.sub(r'\bFL\s*(\d+)(\s*MSL)?', lambda m: 'FL ' + m.group(1), s)
    s = re.sub(r'(\d+)\s*FT\s*(ALT|MSL|AMSL)\b', r'\1 FT', s)
    return s


def callsigns(text):
    out = []
    for m in re.finditer(r'([A-Z][A-Z]+(?: [A-Z]+)*?) (APPROACH|TOWER|TWR|INFORMATION|CONTROL|RADAR|RADIO)\b', text):
        cs = m.group(1).replace('FROM ', '') + ' ' + ('TOWER' if m.group(2) == 'TWR' else m.group(2))
        cs = re.sub(r'^(?:AND|OR|WHEN|DURING) ', '', cs)
        if cs not in out:
            out.append(cs)
    return out


def main():
    aerodromes = json.load(open(ADS))
    units = json.load(open(UNITS))
    by_source = {a['source']: a for a in aerodromes}

    def freqs_of(callsign, ad_id):
        own = [u for u in units if u['callsign'] == callsign and u['owner'] == ad_id]
        anyu = own or [u for u in units if u['callsign'] == callsign]
        seen, out = set(), []
        for u in anyu[:1]:
            for f in u['freqs']:
                if f['mhz'] not in seen:
                    seen.add(f['mhz'])
                    out.append(f['mhz'])
        return out

    recs = []
    for f in sorted(os.listdir(TXT)):
        m2 = re.fullmatch(r'LG_AD_2_(LG[A-Z]{2})_en\.txt', f)
        m1 = re.fullmatch(r'LG_AD_1_6_(\d+)_[A-Z\-]+_en\.txt', f)
        if not (m2 or m1) or re.search(r'_(ADC|APDC|IAC|SID|STAR|VFR)', f):
            continue
        src = ('AD 2 ' + m2.group(1)) if m2 else 'AD 1.6.' + m1.group(1)
        ad = by_source.get(src)
        if not ad:
            continue
        raw = open(os.path.join(TXT, f), encoding='utf-8', errors='replace').read()
        raw = raw.replace('Ν', 'N').replace('Ε', 'E').replace('Ο', 'O').replace('Τ', 'T')
        it = items(section17(raw.splitlines()))
        lat_lines = it.get('lat', [])
        if not lat_lines or lat_lines[0].startswith('NIL'):
            continue
        section_ref = (f"{m2.group(1)} AD 2.17" if m2 else f"AD 1.6.{m1.group(1)}.17")
        desigs = []
        for l in lat_lines:
            dm = DESIG.match(l)
            if dm and not l.startswith(('A CIRCLE', 'CIRCLE')):
                kind = 'CTR' if 'CTR' in dm.group(2) else 'ATZ'
                name = re.sub(r'\s+', ' ', dm.group(1) + ' ' + dm.group(2)).strip()
                desigs.append({'id': f"{ad['id']}-{kind}", 'kind': kind, 'name': name, 'mil': 'MIL' in dm.group(2), 'text': []})
            elif desigs:
                desigs[-1]['text'].append(l)
        if not desigs:
            print('no designation:', f, lat_lines[:2], file=sys.stderr)
            continue
        vert = by_prefix(it.get('vert', []), desigs)
        unit_lines = by_prefix([l for l in it.get('units', []) if not re.match(r'^(Greek|English)', l)], desigs)
        cls_text = ' '.join(it.get('cls', []))
        cm = re.search(r'(?:CLASS|Class)\s+([A-G])', cls_text) or re.match(r'^([A-G])\b', cls_text)
        cls = cm.group(1) if cm else ''
        remarks = ' '.join(it.get('rem', []) + it.get('hours', []))
        remarks = '' if remarks.strip() in ('NIL', 'NIL.') else re.sub(r'\s+', ' ', remarks).strip()
        afis = '*' in cls_text and 'RMZ' in remarks
        for d in desigs:
            text = re.sub(r'\s+', ' ', ' '.join(d['text'])).strip()
            # The Kopaida separation-line note is not part of the lateral limits.
            text = re.split(r'\s*N\s*O\s*T\s*E\s*:', text)[0].strip()
            rec = {'id': d['id'], 'aerodromeId': ad['id'], 'name': d['name'], 'kind': d['kind'], 'mil': d['mil'],
                   'class': cls, 'lower': '', 'upper': '', 'lateral': text}
            if d['id'] in ARCS:
                arp = (ad['lat'], ad['lon'])
                spec = [('arc', arp, *s[2:]) if s[0] == 'arc' and s[1] == 'ARP' else s for s in ARCS[d['id']]]
                rec['polygon'] = [[a, b] for a, b in build(spec)]
            else:
                cm2 = re.search(r'(\d+(?:\.\d+)?)\s*NM\s+radius,?\s+cent\s?(?:red|ered|re)\s+(?:at|on|from)\s+(ARP|\(?' + COORD.pattern + ')', text)
                if cm2:
                    c = (ad['lat'], ad['lon']) if cm2.group(2) == 'ARP' else dms(cm2.groups()[2:8])
                    rec['circle'] = {'lat': c[0], 'lon': c[1], 'radiusNm': float(cm2.group(1))}
                else:
                    pts = [dms(m.groups()) for m in COORD.finditer(text)]
                    if len(pts) < 3:
                        print('no geometry:', d['id'], text[:80], file=sys.stderr)
                        continue
                    if pts[0] != pts[-1]:
                        pts.append(pts[0])
                    rec['polygon'] = [[a, b] for a, b in pts]
            lm = re.search(r'(limited to [^.]*?by [^.]*?(?:boundar(?:y|ies)|MTMA|ATZ))', text, re.I)
            if lm:
                rec['lateralNote'] = lm.group(1)[0].upper() + lm.group(1)[1:]
            vl = ' '.join(vert.get(d['id'], []))
            vm = re.match(r'^(SFC|GND)\s*(?:to|-|–)\s*(.+?)(?:\.\s+(.*))?$', vl)
            if vm:
                rec['lower'] = vm.group(1)
                rec['upper'] = norm_limit(vm.group(2))
                if vm.group(3):
                    rec['verticalNote'] = vm.group(3).strip()
            else:
                print('no vertical limits:', d['id'], vl, file=sys.stderr)
            utext = re.sub(r'\s+', ' ', ' '.join(unit_lines.get(d['id'], []))).strip()
            rec['units'] = [{'callsign': cs, 'freqs': freqs_of(cs, ad['id'])} for cs in callsigns(utext)]
            rec['unitsText'] = utext
            if afis:
                rec['afis'] = True
            rec['remarks'] = remarks
            rec['source'] = section_ref
            recs.append(rec)
    with open(OUT, 'w') as fh:
        json.dump(recs, fh, ensure_ascii=False, separators=(',', ':'))
    print(len(recs), 'aerodrome airspaces')


main()
