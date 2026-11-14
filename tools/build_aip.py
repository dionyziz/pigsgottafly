"""Build data/aip.js from parsed aerodrome JSON + hand-curated ENR 2.1 airspace.

Usage: python3 -I tools/build_aip.py <ad_raw.json> data/aip.js

ad_raw.json comes from tools/parse_ad.py run over pdftotext -layout output of the
Greek eAIP (AD 2 and AD 1.6 sections). Airspace below is transcribed by hand from
ENR 2.1 (AIRAC AMDT 09/26) and ENR 4.1 (VOR positions for arc centres).
"""
import json, math, re, sys

SRC, OUT = sys.argv[1], sys.argv[2]
AIRAC = 'AIRAC AMDT 09/26 (wef 29 OCT 2026)'


def c(s):
    """'380956N 0224358E' -> (lat, lon)"""
    m = re.fullmatch(r'\s*(\d{2})(\d{2})(\d{2}(?:\.\d+)?)N\s*(\d{3})(\d{2})(\d{2}(?:\.\d+)?)E\s*', s)
    a = m.groups()
    return (round(int(a[0]) + int(a[1]) / 60 + float(a[2]) / 3600, 6),
            round(int(a[3]) + int(a[4]) / 60 + float(a[5]) / 3600, 6))


def dest(p, brg, nm):
    R = 3440.065
    la, lo, b, d = math.radians(p[0]), math.radians(p[1]), math.radians(brg), nm / R
    la2 = math.asin(math.sin(la) * math.cos(d) + math.cos(la) * math.sin(d) * math.cos(b))
    lo2 = lo + math.atan2(math.sin(b) * math.sin(d) * math.cos(la), math.cos(d) - math.sin(la) * math.sin(la2))
    return (round(math.degrees(la2), 6), round(math.degrees(lo2), 6))


def brg(a, b):
    la1, la2 = math.radians(a[0]), math.radians(b[0])
    dl = math.radians(b[1] - a[1])
    y = math.sin(dl) * math.cos(la2)
    x = math.cos(la1) * math.sin(la2) - math.sin(la1) * math.cos(la2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def arc(center, radius, frm, to, cw, step=5):
    """Points along an arc (excluding the endpoints, which the caller lists)."""
    b0, b1 = brg(center, frm), brg(center, to)
    span = (b1 - b0) % 360 if cw else (b0 - b1) % 360
    n = max(1, int(span / step))
    pts = []
    for i in range(1, n):
        b = b0 + (span * i / n if cw else -span * i / n)
        pts.append(dest(center, b, radius))
    return pts


def circle(center, radius, step=10):
    return [dest(center, b, radius) for b in range(0, 360, step)]


def poly(*items):
    pts = []
    for it in items:
        if isinstance(it, str):
            pts.append(c(it))
        elif isinstance(it, tuple):
            pts.append(it)
        else:
            pts.extend(it)
    if pts[0] == pts[-1]:
        pts.pop()
    return [[round(a, 5), round(b, 5)] for a, b in pts]


# VOR/DME positions (ENR 4.1)
ALX = c('405114.17N 0255724.24E')
IRA = c('352026.68N 0251106.52E')
LSV = c('391352.68N 0262531.16E')
MKN = c('372624.93N 0252040.26E')
SAM = c('374111.85N 0265425.48E')
LGKO_ARP = c('364741N 0270528E')     # KOS / IPPOKRATIS ARP (LGKO AD 2.2)
LGKV_ARP = c('405450N 0243711E')     # KAVALA / MEGAS ALEXANDROS ARP (LGKV AD 2.2)
MAK_C = c('403537N 0225653E')

A = []  # airspace list
FIR_NOTE = ('East edge follows the ATHINAI-ISTANBUL FIR boundary (not given as coordinates); '
            'drawn outside the FIR so the TMA is over- rather than under-approximated.')


def add(name, kind, sector, polygon, lower, upper, cls, units, note=''):
    A.append({'name': name, 'kind': kind, 'sector': sector, 'polygon': polygon,
              'lower': lower, 'upper': upper, 'class': cls, 'units': units,
              'note': note, 'source': 'ENR 2.1'})


def u(callsign, *freqs, hours='', primary=True):
    return {'callsign': callsign, 'freqs': list(freqs), 'hours': hours}


# ---- TMAs (ENR 2.1.5); for VFR only the lower part (b) matters, upper parts noted for completeness.
add('ALEXANDROUPOLIS TMA', 'TMA', '', poly(circle(ALX, 20)), '1000 FT AGL', 'FL 155', 'D',
    [u('ALEXANDROUPOLIS APPROACH', '123.800', hours='HO')],
    'Circle 20 NM on ALX, limited to the East by ATHINAI-ISTANBUL FIR boundary. Above FL 155: MAKEDONIA CONTROL 133.425/133.575.')
add('ATHINAI TMA', 'TMA', '', poly('380956N 0224358E', '380956N 0241058E', '381256N 0241558E', '383656N 0242258E',
                                   '382545N 0243219E', '380956N 0244458E', '375956N 0245158E', '373656N 0250158E',
                                   '371520N 0250158E', '365956N 0240358E', '371656N 0223158E', '373356N 0223158E'),
    '1000 FT AGL', 'FL 245', 'D (C above FL 195)',
    [u('ATHINAI TMA INFORMATION', '124.025', '131.175', hours='H24'),
     u('ATHINAI APPROACH', '126.575', '130.025', '132.975', '128.950', '125.525', '121.400', hours='H24')],
    'VFR flights: ATHINAI TMA INFORMATION 124.025 primary (ENR 1.2.11.1.c note 2, LGAV AD 2.22.5).')
add('CHIOS TMA', 'TMA', '', poly('383600N 0261900E', '383600N 0254300E', '381100N 0254300E', '380300N 0255500E',
                                 '380300N 0260600E', '381000N 0261500E', (38.1667, 26.55), (38.6, 26.55)),
    '1000 FT AGL', 'FL 095', 'D', [u('CHIOS APPROACH', '124.000', hours='HO')],
    FIR_NOTE)
add('IRAKLION TMA', 'TMA', 'North sector - IRAKLION AREA',
    poly('354156N 0244142E', '354156N 0254636E', arc(IRA, 36, c('354156N 0254636E'), c('345956N 0254717E'), True),
         '345956N 0254717E', '345956N 0254438E', '345956N 0244701E', '350656N 0244658E', '352529N 0244337E'),
    '1000 FT AGL', 'FL 155', 'D', [u('IRAKLION APPROACH', '123.975', '118.025', hours='H24')])
add('IRAKLION TMA', 'TMA', 'North sector - SITIA AREA',
    poly('354156N 0254636E', '355045N 0263659E', '353605N 0265352E', '350512N 0264156E', '350208N 0263620E',
         '345956N 0254717E', arc(IRA, 36, c('345956N 0254717E'), c('354156N 0254636E'), False)),
    '2000 FT AGL', 'FL 125', 'D', [u('IRAKLION APPROACH', '123.975', '118.025', hours='H24')])
add('IRAKLION TMA', 'TMA', 'North sector - KARPATHOS AREA',
    poly('355045N 0263659E', '355428N 0264548E', '353607N 0272638E', '350248N 0273027E', '350208N 0263620E',
         '350512N 0264156E', '353605N 0265352E'),
    '2000 FT AGL', 'FL 125', 'D', [u('IRAKLION APPROACH', '123.975', '118.025', hours='During LGKP HO')])
add('IRAKLION TMA', 'TMA', 'South sector',
    poly('345956N 0254438E', '345256N 0253358E', '342356N 0251428E', '342356N 0245958E', '343456N 0244658E',
         '345956N 0244701E'),
    '5500 FT AGL', 'FL 155', 'D', [u('IRAKLION APPROACH', '123.975', '118.025', hours='H24')])
add('KAVALA TMA', 'TMA', 'KAVALA 1',
    poly('411138N 0242439E', '411500N 0245800E', '411000N 0251200E', '405600N 0251200E', '405300N 0250700E',
         arc(LGKV_ARP, 23, c('405300N 0250700E'), c('403800N 0241700E'), True),
         '403800N 0241700E', '404900N 0235300E', '405724N 0235922E', '405353N 0241735E', '405740N 0242252E',
         '410214N 0242441E'),
    '1000 FT AGL', 'FL 165', 'D', [u('KAVALA APPROACH', '124.650', hours='HO')])
add('KAVALA TMA', 'TMA', 'KAVALA 2',
    poly('411138N 0242439E', '410214N 0242441E', '405740N 0242252E', '405353N 0241735E', '405724N 0235922E',
         '411000N 0240900E'),
    '3000 FT AGL', 'FL 165', 'D', [u('KAVALA APPROACH', '124.650', hours='HO')])
add('KERKIRA TMA', 'TMA', '', poly('394300N 0201800E', '392700N 0202910E', '384700N 0195630E', '390500N 0190600E',
                                   '395800N 0193600E', (40.1, 19.9), (39.85, 20.3)),
    '1000 FT AGL', 'FL 245', 'D (C above FL 195)', [u('KERKIRA APPROACH', '122.355', '118.080', hours='H24')],
    'North/NE edge follows the ATHINAI-TIRANA FIR boundary; drawn outside it (over-approximated).')
add('KOS TMA', 'TMA', '', poly(circle(LGKO_ARP, 17)), '1000 FT AGL', 'FL 095', 'D',
    [u('KOS APPROACH', '119.950', hours='H24')], 'Circle 17 NM, limited to the East by the FIR boundary.')
add('LIMNOS TMA', 'TMA', '', poly('401900N 0245400E', '401900N 0250300E', '400800N 0252830E', '394500N 0252830E',
                                  '393000N 0245400E', '394200N 0243500E', '394900N 0243500E'),
    '1000 FT AGL', 'FL 155', 'D', [u('LIMNOS APPROACH', '128.500', hours='HO')])
add('MAKEDONIA TMA', 'TMA', '',
    poly('402801N 0222536E', arc(MAK_C, 25, c('402801N 0222536E'), c('402800N 0232810E'), True), '402800N 0232810E',
         '401124N 0232011E', arc(MAK_C, 30, c('401124N 0232011E'), c('401159N 0223234E'), True), '401159N 0223234E'),
    '1000 FT AGL', 'FL 245', 'D (C above FL 195)', [u('THESSALONIKI APPROACH', '120.800', '118.280', hours='H24')])
add('MIKONOS TMA', 'TMA', '',
    poly('372424N 0250158E', '373400N 0250158E', '373400N 0253700E',
         arc(MKN, 15, c('373400N 0253700E'), c('372424N 0250158E'), True)),
    '1000 FT AGL', 'FL 095', 'D', [u('MIKONOS APPROACH', '118.750', hours='HO')])
add('MITILINI TMA', 'TMA', '',
    poly('392500N 0262600E', '392100N 0255700E', arc(LSV, 23, c('392100N 0255700E'), c('385300N 0263800E'), False),
         '385300N 0263800E', (38.8833, 26.95), (39.4167, 26.95)),
    '1000 FT AGL', 'FL 145', 'D', [u('MITILINI APPROACH', '123.850', hours='HO')],
    FIR_NOTE)
add('RODOS TMA', 'TMA', '',
    poly('362302N 0274354E', '362230N 0273845E', '360956N 0273621E', '354900N 0272300E', '353400N 0281000E',
         '361700N 0283100E', arc(c('362510N 0280820E'), 20, c('361700N 0283100E'), c('362302N 0274354E'), False)),
    '1000 FT AGL', 'FL 155', 'D', [u('RODOS APPROACH', '127.250', '118.250', hours='H24')],
    'North limit: FIR boundary / 20 NM arc (approximated by the arc).')
add('SAMOS TMA', 'TMA', '',
    poly('375300N 0270200E', '375300N 0263700E', arc(SAM, 18, c('375300N 0263700E'), c('372600N 0270700E'), False),
         '372600N 0270700E', (37.4333, 27.35), (37.8833, 27.35)),
    '1000 FT AGL', 'FL 105', 'D', [u('SAMOS APPROACH', '124.100', hours='HO')],
    FIR_NOTE)
add('SANTORINI TMA', 'TMA', '', poly('364500N 0245800E', '364900N 0252400E', '364400N 0254600E', '362400N 0255600E',
                                     '360900N 0254700E', '360000N 0251500E', '362500N 0250600E'),
    '1000 FT AGL', 'FL 155', 'D', [u('SANTORINI APPROACH', '118.050', hours='HO')])
add('SKIATHOS TMA', 'TMA', '', poly('392500N 0232000E', '392500N 0240200E', '385800N 0240000E', '385500N 0231700E',
                                    '391100N 0232600E'),
    '1000 FT AGL', 'FL 115', 'D', [u('SKIATHOS APPROACH', '126.050', hours='HO')])
add('IOANNINA TMA', 'TMA', '', poly('400113N 0204031E', '394059N 0210659E', '392807N 0210615E', '391911N 0210326E',
                                    '391913N 0204436E', '392700N 0202910E', '394219N 0201829E'),
    '1000 FT AGL', 'FL 155', 'D', [u('IOANNINA APPROACH', '118.600', hours='HO')])

# ---- MTMAs (ENR 2.1.6)
add('ANCHIALOS MTMA', 'MTMA', '', poly('394059N 0210659E', '391439N 0221206E', '391747N 0222259E', '392656N 0223458E',
                                       '393428N 0224557E', '393656N 0231458E', '391124N 0232613E', '385556N 0233258E',
                                       '385450N 0231655E', '384800N 0214600E', '391600N 0211600E', '391911N 0210326E',
                                       '392807N 0210615E'),
    '1000 FT AGL', 'UNL', 'E (C above FL 195)', [u('ALMIROS APPROACH', '120.350', hours='HJ')],
    'Part 391124N 0232613E-385556N 0233258E-385450N 0231655E from 1000 FT AGL to FL 145 belongs to SKIATHOS TMA.')
add('ANDRAVIDA MTMA', 'MTMA', 'North sector', poly('380900N 0194130E', '375600N 0211630E', '372730N 0215900E',
                                                   '372800N 0221000E', '381855N 0220109E', '383500N 0194800E'),
    '1000 FT AGL', 'FL 155', 'E', [u('ANDRAVIDA APPROACH', '121.125', hours='HJ')])
add('ANDRAVIDA MTMA', 'MTMA', 'South sector', poly('380900N 0194130E', '375600N 0211630E', '372730N 0215900E',
                                                   '372500N 0213800E', '364100N 0211900E', '373000N 0194000E',
                                                   '380000N 0194000E'),
    '1000 FT AGL', 'UNL', 'E (C above FL 195)', [u('ANDRAVIDA APPROACH', '121.125', '120.650', hours='HJ')])
add('KALAMATA MTMA', 'MTMA', 'West sector', poly('372730N 0215900E', '372800N 0221000E', '371540N 0221600E',
                                                 '370600N 0223000E', '365600N 0230500E', '354000N 0231700E',
                                                 '364100N 0211900E', '372500N 0213800E'),
    '1000 FT AGL', 'FL 245', 'E', [u('KALAMATA APPROACH', '120.750', hours='HJ'),
                                   u('ANDRAVIDA APPROACH', '121.125', '120.650', hours='HJ')],
    'Caution: lack of COM at low levels East of 022 20E.')
add('KALAMATA MTMA', 'MTMA', 'East sector', poly('365600N 0230500E', '363400N 0233000E', '354000N 0231700E'),
    '1000 FT AGL', '8500 FT', 'E', [u('KALAMATA APPROACH', '120.750', hours='HJ')],
    'Caution: lack of COM at low levels East of 022 20E.')
add('LARISSA MTMA', 'MTMA', 'North sector', poly('394056N 0210658E', '402956N 0213958E', '403156N 0221158E',
                                                 '402756N 0222458E', '401056N 0223258E', '400756N 0223958E'),
    '1000 FT AGL', '10500 FT', 'E', [u('LARISSA APPROACH', '120.550', hours='HJ')])
add('LARISSA MTMA', 'MTMA', 'South sector', poly('400756N 0223958E', '394056N 0210658E', '391439N 0221206E',
                                                 '391747N 0222259E', '392656N 0223458E', '393428N 0224557E',
                                                 '393656N 0231458E', '395106N 0230453E', '400252N 0225357E'),
    '1000 FT AGL', 'UNL', 'E (C above FL 195)', [u('LARISSA APPROACH', '120.550', hours='HJ')])
add('PREVEZA MTMA', 'MTMA', '', poly('383500N 0194800E', '392700N 0202910E', '391913N 0204436E', '391911N 0210326E',
                                     '391600N 0211600E', '384800N 0214600E', '382100N 0214500E'),
    '1000 FT AGL', 'FL 125', 'E', [u('AKTION APPROACH', '120.450', hours='Winter HJ, Summer HO')],
    'No ATC COM MSL-5000 FT between R-115 and R-160 AKT beyond 10 NM (see LGPZ AD 2.18 note).')
add('SKIROS MTMA', 'MTMA', 'Northwest sector', poly('383700N 0243100E', '390600N 0244400E', '393000N 0243000E',
                                                     '393000N 0240200E', '385800N 0240000E', '383700N 0241800E'),
    '1000 FT AGL', 'UNL', 'E (C above FL 195)', [u('SKIROS APPROACH', '123.200', hours='HJ')])
add('SKIROS MTMA', 'MTMA', 'Southeast sector', poly('385400N 0245100E', '383700N 0244100E', '383700N 0243100E',
                                                     '390600N 0244400E'),
    '1000 FT AGL', '7500 FT', 'E', [u('SKIROS APPROACH', '123.200', hours='HJ')])
add('SOUDA MTMA', 'MTMA', '', poly('360000N 0233730E', '354400N 0232800E', '352200N 0234930E', '350000N 0242800E',
                                   '350000N 0244800E', '360000N 0243900E'),
    '1000 FT AGL', 'FL 155', 'E', [u('SOUDA APPROACH', '118.125', hours='H24')])
add('TANAGRA MTMA', 'MTMA', '', poly('381300N 0241600E', '381000N 0241100E', '381000N 0225600E', '384800N 0214600E',
                                     '385500N 0231700E', '385600N 0233300E', '385800N 0240000E', '383700N 0241800E',
                                     '383700N 0242300E'),
    '1000 FT AGL', 'UNL', 'E (C above FL 195)', [u('TANAGRA APPROACH', '120.250', hours='H24')])

# FIS (ENR 2.1.3 / 2.1.4): both FICs list the same frequencies; boundary between them is the
# ATHINAI/MAKEDONIA CTA dividing line below (Makedonia to the north).
FIS = {
    'units': [
        {'callsign': 'ATHINAI INFORMATION', 'freqs': ['130.925', '130.700', '119.750'], 'side': 'south'},
        {'callsign': 'MAKEDONIA INFORMATION', 'freqs': ['130.925', '130.700', '119.750'], 'side': 'north'},
    ],
    'boundary': [list(c(s)) for s in ('402630N 0204730E', '374836N 0232724E', '375055N 0241807E',
                                       '375558N 0243920E', '381449N 0261010E')],
    'source': 'ENR 2.1.3, ENR 2.1.4',
}

# ---- Aerodromes
raw = json.load(open(SRC))
OVR = {
    'LGIR': {'freqfix': {('KAZANTZAKIS TOWER', '129.175'): 'Coverage FL 040 / 25 NM',
                         ('KAZANTZAKIS TOWER', '122.100'): 'RGA'}},
    'KALAMATA / TRIODHON': {'runways': ['15/34'], 'notes': 'Runway designators printed as 15 and 34 in AD 1.6.10.12.'},
    'LGKN': {'freqfix_service': {'KOTRONI INFORMATION': 'INFO'}},
}
ads = []
for d in raw:
    icao = d.get('icao') if d.get('icao') not in (None, 'NIL') else None
    name = d['name'].replace('PTOLEMAIDA/ OLYMPIADA', 'PTOLEMAIDA / OLYMPIADA')
    if d['file'].startswith('LG_AD_1_6_28_LGRD'):
        icao = 'LGRD'
    if d['file'].startswith('LG_AD_1_6_17_LGKN'):
        for f in d['freqs']:
            f['callsign'] = f['callsign'].replace('INFO ', '')
    key = icao or name
    o = OVR.get(key, {})
    freqs = []
    for f in d['freqs']:
        if f['service'] == 'TAR' and any(g['mhz'] == f['mhz'] and g['service'] == 'APP' for g in d['freqs']):
            continue  # radar on the same frequency as APP; listed once
        f = dict(f)
        fix = o.get('freqfix', {}).get((f['callsign'], f['mhz']))
        if fix:
            f['remark'] = fix
        if not f['service']:
            f['service'] = 'AFIS' if 'INFORMATION' in f['callsign'] else ''
        freqs.append(f)
    circles = d.get('circles') or []
    sec = re.search(r'AD_(2_LG..|1_6_\d+)', d['file']).group(1)
    ads.append({
        'id': icao or re.sub(r'[^A-Z]+', '-', name).strip('-'),
        'icao': icao,
        'name': name,
        'lat': d['lat'], 'lon': d['lon'],
        'elevFt': d.get('elevFt'),
        'runways': o.get('runways', d['runways']),
        'freqs': freqs,
        'zones': [{'radiusNm': z['radiusNm'], 'lat': z['lat'], 'lon': z['lon']} for z in circles],
        'water': 'PORT' in name or 'HARBOUR' in name or 'LAKE' in name,
        'source': ('AD 2 ' + sec[2:]) if sec.startswith('2_') else 'AD ' + sec.replace('_', '.'),
        'notes': o.get('notes', ''),
    })

data = {'airac': AIRAC, 'aerodromes': ads, 'airspace': A, 'fis': FIS,
        'integrity': 'Archive checksum supplied by user did not match (SHA-256/512, SHA3, BLAKE2 tried); data unverified.'}
with open(OUT, 'w') as fh:
    fh.write('// Generated by tools/build_aip.py from the Greek eAIP, ' + AIRAC + '. Do not edit by hand.\n')
    fh.write('window.AIP = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')
print(len(ads), 'aerodromes,', len(A), 'airspace volumes')
