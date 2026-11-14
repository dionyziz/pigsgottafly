"""Georeferencing and symbol detection for the eAIP VFR route charts (600 dpi grey renders)."""
import re
import numpy as np
import cv2


def border_words(img, ocr):
    """OCR the four border strips upscaled, returning words in full-image pixel coordinates."""
    from PIL import Image
    W, H = img.size
    strips = [(0, 0, W, int(0.13 * H)), (0, int(0.86 * H), W, H), (0, 0, int(0.09 * W), H), (int(0.91 * W), 0, W, H)]
    out = []
    for (x0, y0, x1, y1) in strips:
        crop = img.crop((x0, y0, x1, y1))
        k = 3
        big = crop.resize((crop.width * k, crop.height * k), Image.LANCZOS)
        a = np.asarray(big)
        big = Image.fromarray(np.where(a < 140, 0, 255).astype(np.uint8))
        for w in ocr(big, psm=11):
            w = dict(w)
            w['x'] = x0 + w['x'] / k; w['y'] = y0 + w['y'] / k; w['w'] = w['w'] / k; w['h'] = w['h'] / k
            out.append(w)
    return out


def georef(words, W, H):
    """Fit x = a*lon + c and y = d*lat + f from the graticule labels printed along the chart border."""
    lon_pts, lat_pts = [], []
    def tenmin(digs):
        """minutes printed at a 10' graticule label: last two digits, a multiple of 10"""
        if len(digs) >= 2 and digs[-1] == '0' and int(digs[-2:]) < 60:
            return int(digs[-2:])
        return None
    for w in words:
        t = w['text'].replace('º', '°').replace('’', "'")
        cx, cy = w['x'] + w['w'] / 2, w['y'] + w['h'] / 2
        m = re.fullmatch(r".?(\d{2})°(.{1,5}?)'?E.?", t)
        if m and (cy < 0.2 * H or cy > 0.8 * H) and 19 <= int(m[1]) <= 29:
            mi = tenmin(re.sub(r'\D', '', m[2]))
            if mi is not None:
                lon_pts.append((int(m[1]) + mi / 60, cx))
            continue
        m = re.fullmatch(r"(\d{2})°?", t)
        if m and (cx < 0.12 * W or cx > 0.88 * W) and 34 <= int(m[1]) <= 42:
            below = [o for o in words if 0 < o['y'] - w['y'] < 2.5 * w['h'] and abs(o['x'] - w['x']) < 2 * w['h']
                     and re.fullmatch(r".?(\d{2})['’]?N?", o['text'])]
            if below:
                mi = tenmin(re.sub(r'\D', '', below[0]['text']))
                if mi is not None:
                    lat_pts.append((int(m[1]) + mi / 60, (w['y'] + below[0]['y'] + below[0]['h']) / 2))
            continue
        m = re.fullmatch(r"(\d{2})°(\d{2})'?N?", t)
        if m and (cx < 0.12 * W or cx > 0.88 * W) and 34 <= int(m[1]) <= 42 and tenmin(m[2]) is not None:
            lat_pts.append((int(m[1]) + int(m[2]) / 60, cy))

    def robust_fit(pts):
        if len(pts) < 2:
            return None
        P = np.array(pts, float)
        best = None
        for i in range(len(P)):
            for j in range(i + 1, len(P)):
                if abs(P[i, 0] - P[j, 0]) < 1e-6:
                    continue
                a = (P[j, 1] - P[i, 1]) / (P[j, 0] - P[i, 0])
                c = P[i, 1] - a * P[i, 0]
                inl = np.abs(P[:, 0] * a + c - P[:, 1]) < 25
                if best is None or inl.sum() > best[0].sum():
                    best = (inl, a, c)
        inl = best[0]
        if inl.sum() < 2:
            return None
        A = np.vstack([P[inl, 0], np.ones(inl.sum())]).T
        (a, c), *_ = np.linalg.lstsq(A, P[inl, 1], rcond=None)
        res = np.abs(P[inl, 0] * a + c - P[inl, 1])
        return {'a': a, 'c': c, 'n': int(inl.sum()), 'resid': float(res.max())}

    fx, fy = robust_fit(lon_pts), robust_fit(lat_pts)
    if not fx or not fy:
        return None
    # a conformal chart at Greek latitudes: the lat/lon scale ratio must be about 1/cos(lat)
    lat_mid = (-fy['c'] / fy['a'] + (H - fy['c']) / fy['a']) / 2 if fy['a'] else 0
    ratio = abs(fy['a'] / fx['a'])
    expect = 1 / np.cos(np.radians(min(42, max(34, lat_mid))))
    if not 0.93 * expect < ratio < 1.07 * expect:
        return None
    return {'x': fx, 'y': fy, 'ratio': ratio, 'expect': expect,
            'to_px': lambda lat, lon: (fx['a'] * lon + fx['c'], fy['a'] * lat + fy['c']),
            'to_ll': lambda x, y: ((y - fy['c']) / fy['a'], (x - fx['c']) / fx['a'])}


def find_triangles(gray, dpi=600):
    """Filled black triangles (reporting points). Returns list of (cx, cy, size_px)."""
    dark = (gray < 90).astype(np.uint8) * 255
    k = max(3, int(dpi / 600 * 27))
    opened = cv2.morphologyEx(dark, cv2.MORPH_OPEN, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k)))
    cnts, _ = cv2.findContours(opened, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    out = []
    for c in cnts:
        area = cv2.contourArea(c)
        if not (dpi / 600) ** 2 * 1500 < area < (dpi / 600) ** 2 * 30000:
            continue
        x, y, w, h = cv2.boundingRect(c)
        if not 0.6 < w / h < 1.8:
            continue
        hull = cv2.convexHull(c)
        tri_area, tri = cv2.minEnclosingTriangle(hull)
        if tri_area <= 0 or area / tri_area < 0.8:
            continue
        # apex roughly up: the reporting-point triangles stand on their base
        pts = tri.reshape(3, 2)
        cx, cy = pts[:, 0].mean(), pts[:, 1].mean()
        out.append((float(cx), float(cy), float(max(w, h))))
    return out
