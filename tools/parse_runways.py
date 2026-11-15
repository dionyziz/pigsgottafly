"""Runway physical characteristics and declared distances from the Greek eAIP.

Reads the pdftotext -layout text of the AD 2 aerodrome PDFs (LG_AD_2_LGxx_en.txt, sections
AD 2.12 / AD 2.13) and of the AD 1.6 CAT B aerodrome PDFs (LG_AD_1_6_N_<name>_en.txt, sections
AD 1.6.N.12 / AD 1.6.N.13), and the magnetic variation of AD 2.2 / AD 1.6.N.2 item 5.
Writes tools/runways.json, keyed by the aerodrome `source` used in data/aip.js ('AD 2 LGKR',
'AD 1.6.5'). tools/build_ref.ts joins it onto the reference runways.

Usage: python3 -I tools/parse_runways.py TXT_DIR tools/runways.json

Every value is what the page prints; nothing is invented. A value the AIP does not publish (NIL,
blank, 'see AOC chart') is null (tools/build_ref_runways.ts lists it in each record's `gaps`). The few
values changed after parsing (misprints, or declared distances that a remark of the same table modifies)
are in OVR below, each with its reason, and are listed in `corrections`.

Remarks (declaredRemark) are vertically centred in the PDF cells, so the text gathered next to a row can
include a neighbouring row's remark; they are informative, the numbers are not taken from them.
"""
import json, os, re, sys

TXT, OUT = sys.argv[1], sys.argv[2]

COORD = re.compile(r'(\d{2})(\d{2})(\d{2}(?:\.\d+)?)\s*N[,\s]*(\d{3})(\d{2})(\d{2}(?:\.\d+)?)\s*E')
DESIG_ROW = re.compile(r'^\s{0,20}(\d{2}[LRC]?)(?=\s{2,}|\s*$)')
# Surface keyword -> code; the keyword printed first in the row wins (e.g. 'Asphalt (first 160 concrete)'
# is ASPH, the main surface; the full wording is kept in surfaceText).
SURFACES = [
    (r'\bgrass\b', 'GRASS'), (r'\bgravel\b', 'GRVL'), (r'\b(?:earth|soil|dirt)\b', 'EARTH'),
    (r'\bwater\b', 'WATER'), (r'\b(?:asphalt|asph|bitumen|tarmac)\b', 'ASPH'), (r'\b(?:concrete|conc)\b', 'CONC'),
    (r'\bpsp\b', 'PSP'),
]
SLOPE_TOKEN = re.compile(r'NIL|[+\-–]?\s*\d+(?:[.,]\d+)?\s*%')

# Values changed after parsing, keyed (source, designator) -> {field: value, 'why': reason}: evident
# misprints, and declared distances that the table's own remarks modify.
_LGBL = 'AD 2.13 remark: take-off starts 120 M inwards from the THR (arresting nets), so for both directions TORA = TODA = ASDA = 2639'
OVR = {
    ('AD 2 LGBL', '08'): {'toraM': 2639.0, 'todaM': 2639.0, 'asdaM': 2639.0, 'why': _LGBL},
    ('AD 2 LGBL', '26'): {'toraM': 2639.0, 'todaM': 2639.0, 'asdaM': 2639.0, 'why': _LGBL},
}


def dms(g):
    lat = int(g[0]) + int(g[1]) / 60 + float(g[2]) / 3600
    lon = int(g[3]) + int(g[4]) / 60 + float(g[5]) / 3600
    return round(lat, 6), round(lon, 6)


def num(s):
    return float(s.replace(',', '.'))


def pages_of(raw):
    """[(page label, lines)] - the label is 'AD 2 LGKR-6' / 'AD 1.6.5-3' and the AMDT on the page."""
    out = []
    for p in raw.split('\f'):
        lab = re.search(r'\b(AD 2 LG[A-Z]{2}-\d+|AD 1\.6\.\d+-\d+)\b', p)
        amdt = re.findall(r'AIRAC AMDT (\d+/\d+)', p)
        out.append(((lab.group(1) if lab else '?') + (' (AIRAC AMDT %s)' % amdt[-1] if amdt else ''), p.splitlines()))
    return out


def furniture(s):
    s = s.strip()
    if re.match(r'^(AIP|GREECE|HELLENIC AVIATION SERVICE PROVIDER|AIRAC AMDT|AD 2 LG..-\d+|AD 1\.6\.\d+-\d+)\b', s) and len(re.split(r'\s{2,}', s)) <= 2:
        return True
    return bool(re.match(r'^\d{2} [A-Z]{3} \d{4}(\s+GREECE)?$', s))


def section(pages, num_):
    """(lines, [page labels]) of section `num_` ('12', '13', '2')."""
    pat = re.compile(r'AD (?:2|1\.6\.\d+)\.%s\s+[A-Z]' % num_)
    nxt = re.compile(r'AD (?:2|1\.6\.\d+)\.(\d+)\s+[A-Z]')
    lines, labels, on = [], [], False
    for lab, pl in pages:
        for l in pl:
            if not on and pat.search(l) and l.strip().startswith(('LG', 'AD')):
                on = True
                labels.append(lab)
                continue
            if on:
                m = nxt.search(l)
                if m and int(m.group(1)) > int(num_) and l.strip().startswith(('LG', 'AD')):
                    return lines, labels
                if furniture(l):
                    continue
                if lab not in labels and l.strip():
                    labels.append(lab)
                lines.append(l)
    return lines, labels


def blocks(lines):
    """Split a table into rows: [(designator, [lines])]; a row runs until the next designator row,
    a header ('Designations'/'RWY') or the column-number line."""
    rows, cur, prev = [], None, None
    for l in lines:
        m = DESIG_ROW.match(l)
        if m and 1 <= int(m.group(1)[:2]) <= 36:
            if not l[m.end():].strip() and prev is not None and re.search(r'\d\s*[x×X]\s*\d', prev):
                # the designator is printed below its row (vertically centred cell): merge them
                l = l[:m.end()] + prev[m.end():] if len(prev) > m.end() else l
                if cur is not None and cur[1] and cur[1][-1] is prev:
                    cur[1].pop()
            cur = (m.group(1), [l])
            rows.append(cur)
            prev = None
            continue
        elif re.match(r'^\s*(Designations?|RWY\s*$|RWY\s{2,})', l):
            cur = None
        elif cur is not None:
            cur[1].append(l)
        if l.strip():
            prev = l
    return rows


def split_tables(lines):
    """Section 12 holds two tables (cols 1-6 and cols 7-13) or one combined table (CAT B)."""
    idx = [i for i, l in enumerate(lines) if re.match(r'^\s*Designations?\b', l)]
    if not idx:
        return lines, [], False
    combined = any('Slope' in l for l in lines[idx[0]:idx[0] + 4])
    if combined:
        return lines[idx[0]:], [], True
    second = [i for i, l in enumerate(lines) if i > idx[0] + 5 and re.match(r'^\s*(Designations?\b|Slope of\b)', l)]
    if second:
        return lines[idx[0]:second[0]], lines[second[0]:], False
    return lines[idx[0]:], [], False


def parse_physical(rows, combined):
    out = {}
    for d, bl in rows:
        if d in out:
            continue
        row = bl[0]
        text = ' '.join(bl)
        r = {}
        cells = re.split(r'\s{2,}', row.strip())
        m = (re.search(r'^\s*\d{2}[LRC]?\s+(\d{1,3}(?:\.\d+)?)\s*[°º]', row)
             or (re.fullmatch(r'(\d{1,3}(?:\.\d+)?)\s*[°º]?', cells[1]) if len(cells) > 1 else None))
        r['trueBrg'] = float(m.group(1)) if m and float(m.group(1)) <= 360 else None
        dm = re.search(r'(\d+(?:[.,]\d+)?)\s*[x×X]\s*(\d+(?:[.,]\d+)?)', row)
        r['lengthM'], r['widthM'] = (num(dm.group(1)), num(dm.group(2))) if dm else (None, None)
        coords = [dms(c.groups()) for c in COORD.finditer(text)]
        r['thr'] = list(coords[0]) if coords else None
        r['end'] = list(coords[1]) if len(coords) > 1 else None
        m = re.search(r'THR:?\s*([\d.]+)\s*M\s*/\s*([\d.]+)\s*FT', text) or re.search(r'THR:?\s*()([\d.]+)\s*FT', text)
        r['thrElevFt'] = float(m.group(2)) if m else None
        low = text.lower()
        hits = sorted((mm.start(), code) for pat, code in SURFACES for mm in [re.search(pat, low)] if mm)
        r['surface'] = hits[0][1] if hits else None
        r['surfaceText'] = ' '.join(re.findall(r'(?i)\b(?:asphalt|asph|concrete|conc|grass|gravel|earth|soil|dirt|water|psp|bitumen|first \d+\s*m?\s*\w+)\b', text)) or None
        sm = re.search(r'\b((?:PCN|LCN)\b[^\n]*?)(?=\s{2,}|$)', row) or re.search(r'\b((?:PCN|LCN)\b[^\n]*?)(?=\s{2,}|$)', text)
        r['strength'] = re.sub(r'\s+', ' ', sm.group(1)).strip() if sm else None
        if combined:
            # CAT B combined layout: designator, TRUE BRG, dimensions, strength/surface (own lines), slope, SWY, ...
            after = row[dm.end():] if dm else ''
            toks = re.split(r'\s{2,}', after.strip())
            r['slopeText'] = next((t for t in toks if SLOPE_TOKEN.fullmatch(t)), None)
        out[d] = r
    return out


def parse_slope_text(t):
    if t is None:
        return None
    t = t.strip()
    m = re.fullmatch(r'([+\-–]?)\s*(\d+(?:[.,]\d+)?)\s*%', t)
    if m:
        v = num(m.group(2))
        return -v if m.group(1) in ('-', '–') else v
    return None


def parse_slopes(rows):
    out = {}
    for d, bl in rows:
        if d in out:
            continue
        toks = re.split(r'\s{2,}', bl[0].strip())
        out[d] = (toks[1] if len(toks) > 1 else None, ' '.join(re.sub(r'\s+', ' ', l.strip()) for l in bl))
    return out


def _remark_line(l):
    """A line of the declared-distances table that only carries remark text (no designator, not a header)."""
    t = l.strip()
    if not t or DESIG_ROW.match(l) or re.fullmatch(r'[\d\s]+', t):
        return False
    if re.search(r'\bTORA\b|\(M\)|Designator|Remarks', t):
        return False
    return len(l) - len(l.lstrip()) > 40


def parse_declared(lines):
    """AD 2.13: the first full row (TORA TODA ASDA LDA) per designator; rows with three values are
    intersection take-offs. The remark cell is vertically centred, so its text is gathered from the
    remark-only lines just above and below the row (up to a blank line)."""
    out = {}
    intersections = {}
    for i, row in enumerate(lines):
        m = DESIG_ROW.match(row)
        if not m or not 1 <= int(m.group(1)[:2]) <= 36:
            continue
        d = m.group(1)
        toks = re.split(r'\s{2,}', row.strip())[1:]
        vals = []
        for t in toks:
            t = re.sub(r'^(\d{1,2})[.,](\d{3})\b', r'\1\2', t)       # '1.941' = 1941 m (thousands separator)
            t = re.sub(r'^(\d+)\s*M$', r'\1', t)                      # '1000 M'
            if re.fullmatch(r'\d+(?:[.,]\d+)?', t):
                vals.append(num(t))
            elif re.fullmatch(r'NIL|-|–|N/A', t):
                vals.append(None)
            else:
                break
        if not vals:
            continue
        above, below = [], []
        j = i - 1
        while j >= 0 and _remark_line(lines[j]):
            above.insert(0, lines[j])
            j -= 1
        j = i + 1
        while j < len(lines) and _remark_line(lines[j]):
            below.append(lines[j])
            j += 1
        parts = above + [' '.join(toks[len(vals):])] + below
        remark = ' '.join(re.sub(r'\s+', ' ', l.strip()) for l in parts if l.strip()).strip()
        if remark.upper().rstrip('.') == 'NIL':
            remark = ''
        if len(vals) >= 4 and d not in out:
            out[d] = {'tora': vals[0], 'toda': vals[1], 'asda': vals[2], 'lda': vals[3], 'remark': remark}
        elif len(vals) == 3:
            intersections.setdefault(d, []).append({'toraM': vals[0], 'todaM': vals[1], 'asdaM': vals[2], 'remark': remark})
        elif d not in out:
            out[d] = {'unparsed': row.strip()}
    return out, intersections


def mag_var(pages):
    """AD 2.2 / AD 1.6.N.2 item 5 'MAG VAR/Annual change', e.g.
    '4°01'E (4.017°E) (JAN 2013) / 5' 45''E (0.0908°E)', '5°E (JAN 2025) / 6′ 01″E', 'VAR 4°E / 2014 / 5’53’’E.'.
    Returns ({deg, year, annualDeg}, text) with east positive, or (None, text) when NIL."""
    s2, _ = section(pages, '2')
    for i, l in enumerate(s2):
        if 'MAG VAR' not in l:
            continue
        t = re.sub(r'\s+', ' ', ' '.join(s2[i:i + 2]))
        t = t.split('MAG VAR/Annual change', 1)[-1]
        t = re.split(r'\s\d+\s+AD Administration', t)[0].strip()
        if t.upper().startswith('NIL'):
            return None, t
        q = t.replace('΄', "'").replace('’', "'").replace('′', "'").replace('″', "''").replace('"', "''").replace('º', '°')
        var_part, _, ann_part = q.partition(') /') if ') /' in q else q.rpartition(' / ')
        m = re.search(r'\((\d+(?:\.\d+)?)\s*°\s*E?\)', var_part)
        if m:
            deg = float(m.group(1))
        else:
            m = re.search(r"(\d+)\s*°?\s*(?:(\d+)\s*'+)?\s*E?\b", var_part.replace('VAR', ''))
            deg = int(m.group(1)) + (int(m.group(2)) / 60 if m.group(2) else 0)
        y = re.search(r'(19|20)\d\d', q)
        ann = None
        m = re.search(r'\((\d+(?:\.\d+)?)\s*°\s*E\)', ann_part)
        if m:
            ann = float(m.group(1))
        else:
            m = re.search(r"(\d+(?:\.\d+)?)\s*'\s*(?:(\d+)\s*'')?", ann_part)
            if m:
                ann = (float(m.group(1)) + (int(m.group(2)) / 60 if m.group(2) else 0)) / 60
        return {'deg': round(deg, 4), 'year': int(y.group(0)) if y else None, 'annualDeg': round(ann, 4) if ann is not None else None}, t
    return None, None


def parse_file(path, source):
    raw = open(path, encoding='utf-8', errors='replace').read().replace('Ν', 'N').replace('Ε', 'E')
    if 'AERODROME CLOSED' in raw:
        return None
    pages = pages_of(raw)
    s12, p12 = section(pages, '12')
    s13, p13 = section(pages, '13')
    t1, t2, combined = split_tables(s12)
    phys = parse_physical(blocks(t1), combined)
    slopes = parse_slopes(blocks(t2)) if t2 else {}
    decl, inter = parse_declared(s13)
    mv, mvtext = mag_var(pages)
    sec = '2' if source.startswith('AD 2') else source.split(' ')[1]
    res = {'file': os.path.basename(path), 'magVar': mv, 'magVarText': mvtext,
           'ref12': '%s.12 (%s)' % (source if sec == '2' else 'AD ' + sec, ', '.join(p12)),
           'ref13': '%s.13 (%s)' % (source if sec == '2' else 'AD ' + sec, ', '.join(p13)),
           'runways': {}}
    if source.startswith('AD 2'):
        res['ref12'] = '%s AD 2.12 (%s)' % (source[5:], ', '.join(p12))
        res['ref13'] = '%s AD 2.13 (%s)' % (source[5:], ', '.join(p13))
    for d, r in phys.items():
        st, srow = slopes.get(d, (r.pop('slopeText', None), None))
        r.pop('slopeText', None)
        r['slopeText'] = st
        r['slopePct'] = parse_slope_text(st)
        dd = decl.get(d, {})
        r.update({'toraM': dd.get('tora'), 'todaM': dd.get('toda'), 'asdaM': dd.get('asda'), 'ldaM': dd.get('lda'),
                  'declaredRemark': dd.get('remark') or None})
        if 'unparsed' in dd:
            r['declaredUnparsed'] = dd['unparsed']
        if d in inter:
            r['intersections'] = inter[d]
        res['runways'][d] = r
    for d in decl:
        if d not in res['runways']:
            res.setdefault('declaredOnly', {})[d] = decl[d]
    return res


def source_of(f):
    m = re.fullmatch(r'LG_AD_2_(LG[A-Z]{2})_en\.txt', f)
    if m:
        return 'AD 2 ' + m.group(1)
    m = re.fullmatch(r'LG_AD_1_6_(\d+)_[A-Z\-]+_en\.txt', f)
    if m and not re.search(r'_(ADC|APDC|IAC|SID|STAR|VFR)', f) and m.group(1) != '0':
        return 'AD 1.6.' + m.group(1)
    return None


def main():
    out = {}
    corrections = []
    for f in sorted(os.listdir(TXT)):
        src = source_of(f)
        if not src:
            continue
        r = parse_file(os.path.join(TXT, f), src)
        if r:
            out[src] = r
    for (src, d), fix in OVR.items():
        rw = out[src]['runways'][d]
        for k, v in fix.items():
            if k == 'why':
                continue
            corrections.append({'source': src, 'designator': d, 'field': k, 'printed': rw.get(k), 'used': v, 'why': fix['why']})
            rw[k] = v
    doc = {'_comment': 'Generated by tools/parse_runways.py from the eAIP text (AD 2.12/2.13, AD 1.6.N.12/13). Do not edit by hand; corrections go in OVR.',
           'corrections': corrections, 'aerodromes': out}
    with open(OUT, 'w', encoding='utf-8') as fh:
        json.dump(doc, fh, indent=1, ensure_ascii=False, sort_keys=True)
        fh.write('\n')
    n = sum(len(a['runways']) for a in out.values())
    print(len(out), 'aerodromes,', n, 'runway directions')


main()
