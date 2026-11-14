"""Visual check: mark where given coordinates fall on a georeferenced chart image.

Usage: python3 -I tools/vfr_verify.py <chart.png> <vfr_ocr/CHART.json> <out.png> NAME=LAT,LON [NAME=LAT,LON ...]
Draws a red crosshair at each projected position on a crop of the chart, labelled with the name.
"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None
img_path, geo_path, out = sys.argv[1:4]
M = np.array(json.load(open(geo_path))['georef']['M'])
A = M[:, :2]
img = Image.open(img_path).convert('RGB')
tiles = []
for arg in sys.argv[4:]:
    name, ll = arg.rsplit('=', 1)
    lat, lon = map(float, ll.split(','))
    x, y = np.linalg.solve(A, np.array([lat, lon]) - M[:, 2])
    R = 700
    c = img.crop((int(x - R), int(y - R), int(x + R), int(y + R)))
    d = ImageDraw.Draw(c)
    d.line((R - 120, R, R + 120, R), fill=(255, 0, 0), width=8)
    d.line((R, R - 120, R, R + 120), fill=(255, 0, 0), width=8)
    d.ellipse((R - 80, R - 80, R + 80, R + 80), outline=(255, 0, 0), width=6)
    d.text((20, 20), name, fill=(255, 0, 0))
    tiles.append(c.resize((R, R)))
W = 3
sheet = Image.new('RGB', (W * 700, ((len(tiles) + W - 1) // W) * 700), 'white')
for i, t in enumerate(tiles):
    sheet.paste(t, ((i % W) * 700, (i // W) * 700))
sheet.save(out)
