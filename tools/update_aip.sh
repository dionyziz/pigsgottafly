#!/usr/bin/env bash
# Rebuild all AIP-derived data from a new Greek eAIP release. See AIP-UPDATE.md.
#
#   tools/update_aip.sh <dir with aipgr_*.zip.0NN parts> <AIRAC e.g. 2612> "<AIRAC AMDT label, e.g. AIRAC AMDT 10/26 (wef 26 NOV 2026)>"
#
# Needs: unzip, bsdtar, pdftotext, pdftoppm, tesseract, python3 (numpy, Pillow, opencv), node.
set -euo pipefail
PARTS="$1"; CYCLE="$2"; LABEL="$3"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d -t navlog-aip-XXXX)"
echo "work dir: $WORK"

echo "== 1. unpack"
cat "$PARTS"/aipgr_*.zip.0* > "$WORK/aip.zip"
echo "   archive sha256: $(shasum -a 256 "$WORK/aip.zip" | cut -d' ' -f1)   <- compare with the published checksum"
unzip -tq "$WORK/aip.zip"
mkdir -p "$WORK/iso" "$WORK/txt" "$WORK/vfr" "$WORK/charts"
unzip -q "$WORK/aip.zip" -d "$WORK/zip"
bsdtar -xf "$WORK"/zip/*.iso -C "$WORK/iso"
PDF="$WORK/iso/ais/eaip/pdf"

echo "== 2. text of the sections we use"
for f in "$PDF"/AD\ 2/AD2-*/LG_AD_2_LG??_en.pdf "$PDF/AD 1/AD 1.6 CAT B AERODROMES/catb"/*.pdf "$PDF/AD 3"/*/*.pdf "$PDF/ENR 2"/*.pdf "$PDF/ENR 4"/*.pdf "$PDF/ENR 5"/*.pdf "$PDF/GEN 2"/*.pdf; do
  pdftotext -layout "$f" "$WORK/txt/$(basename "$f" .pdf).txt"
done
for f in $(cd "$PDF" && find . -iname '*VFR*.pdf' | tr ' ' '#'); do
  f="$PDF/$(echo "$f" | tr '#' ' ')"; pdftotext -layout "$f" "$WORK/vfr/$(basename "$f" .pdf).txt"
done

echo "== 3. what changed since the last update (review these by hand, see AIP-UPDATE.md)"
python3 -I "$ROOT/tools/vfr_manifest.py" check "$PDF" "$ROOT/tools/vfr_charts/manifest.json"
for s in ENR_2_1 ENR_4_1 GEN_2_7; do
  echo "   $s: $(grep -hoE 'AIRAC AMDT [0-9]+/[0-9]+' "$WORK/txt/LG_${s}_en.txt" | sort -u | tail -1)"
done

echo "== 4. aerodromes, airspace, sunset, AIP links, ENR 5 areas, radio navaids"
sed -i '' "s|^AIRAC = .*|AIRAC = '$LABEL'|" "$ROOT/tools/build_aip.py"
# the online eAIP of this AIRAC (links to the AIP PDFs): .../aipgr_incl_amdt_1026_wef_26nov2026/cd/ais/
AMDT=$(echo "$LABEL" | sed -E 's/.*AMDT ([0-9]{2})\/([0-9]{2}).*/\1\2/')
read -r WD WM WY <<< "$(echo "$LABEL" | sed -E 's/.*wef ([0-9]+) ([A-Z]{3}) ([0-9]{4}).*/\1 \2 \3/')"
WEF=$(printf '%02d%s%s' "$((10#$WD))" "$(echo "$WM" | tr 'A-Z' 'a-z')" "$WY")
sed -i '' "s|^export const AIP_EAIP_BASE = .*|export const AIP_EAIP_BASE = 'https://aisgr.hasp.gov.gr/aipgr_incl_amdt_${AMDT}_wef_${WEF}/cd/ais/';|" "$ROOT/src/data/aipLinks.ts"
grep -n "^export const AIP_EAIP_BASE" "$ROOT/src/data/aipLinks.ts"
(cd "$ROOT" && npx tsx tools/aip_files.ts "$WORK/iso/ais/side.htm" src/data/ref/aip-files.json)
(cd "$ROOT" && npx tsx tools/parse_enr5.ts "$WORK/txt" tools/enr5_areas.json)   # ENR 5.1/5.2/5.3 areas: check what it flags
(cd "$ROOT" && npx tsx tools/parse_navaids.ts "$WORK/txt" src/data/ref/navaids.json)   # ENR 4.1 + AD 2.19 / AD 1.6.N.19 radio navaids: check what it flags
python3 -I "$ROOT/tools/parse_ad.py" "$WORK/txt" "$WORK/ad_raw.json"
python3 -I "$ROOT/tools/build_aip.py" "$WORK/ad_raw.json" "$ROOT/data/aip.js"
python3 -I "$ROOT/tools/parse_sun.py" "$WORK/txt/LG_GEN_2_7_en.txt" "$ROOT/data/sun.js"
python3 -I "$ROOT/tools/parse_runways.py" "$WORK/txt" "$ROOT/tools/runways.json"   # AD 2.12/2.13, AD 1.6.N.12/13 (+ OVR corrections)

echo "== 5. VFR points and routes"
# coordinate tables of the VFR charts (LGAV, LGIR, LGKL, LGTG) and the heliports' AD 3.N.21 reporting points;
# it warns when a table lists more positions than it read
(cd "$ROOT" && npx tsx tools/parse_vfr.ts "$WORK/vfr" "$WORK/txt" tools/vfr_points.json)
python3 -I "$ROOT/tools/fetch_ofm.py" "$CYCLE" "$ROOT/tools/ofm_points.json"
python3 -I "$ROOT/tools/known_points.py" "$ROOT/tools/vfr_points.json" "$ROOT/tools/vfr_charts" "$ROOT/tools/ofm_points.json" "$WORK/known.json"
for f in $(cd "$PDF" && find . -iname '*VFR*.pdf' | tr ' ' '#'); do
  f="$PDF/$(echo "$f" | tr '#' ' ')"; c=$(basename "$f" | sed -E 's/.*(LG[A-Z]{2})_VFR.*/\1/')
  n=$(pdfinfo "$f" | awk '/Pages/{print $2}')
  for p in $(seq 1 "$n"); do
    [ "$(pdftotext -f "$p" -l "$p" "$f" - | wc -w)" -gt 50 ] && continue      # text pages, not the chart
    pdftoppm -f "$p" -l "$p" -r 600 -gray -png "$f" "$WORK/charts/${c}_p$p"
    img=$(ls "$WORK/charts/${c}_p$p"*.png)
    VFR_NO_ROUTES=1 python3 -I "$ROOT/tools/vfr_chart.py" "$img" "$c" "$ROOT/tools/vfr_ocr/${c}_p$p-$p.json" "$WORK/charts/overlay_${c}_p$p.png" "$WORK/known.json" | tail -1
  done
done
python3 -I "$ROOT/tools/build_vfr.py" "$ROOT/tools/vfr_points.json" "$ROOT/tools/vfr_charts" "$ROOT/tools/vfr_ocr" "$ROOT/tools/ofm_points.json" "$ROOT/data/vfr.js"

echo "== 6. reference data"
# The new cycle's reference data goes into NEW migrations: never edit an applied one (002, 005).
# Point MIGRATION / RUNWAY_MIGRATION / HOURS_MIGRATION in tools/build_ref.ts at new files (e.g. 006_ref_<cycle>.ts),
# register them in api/_lib/migrate.ts, then run:  npm run ref && npm test && npm run test:e2e
echo "data/*.js and tools/runways.json updated. Next: new ref migrations in tools/build_ref.ts, then npm run ref && npm test && npm run test:e2e"
echo "After npm run ref, the aerodrome CTR/ATZ map layer (client only, AD 2.17 / AD 1.6.N.17):"
echo "  python3 -I tools/parse_ad_airspace.py $WORK/txt src/data/ref/aerodromes.json src/data/ref/atc-units.json src/data/ref/ad-airspaces.json"
echo "and the operational hours and handling (AD 2.3, AD 1.6.N.3/4), then npm run ref again:"
echo "  npx tsx tools/extract_ad_hours.ts $WORK/txt && npm run ref"
python3 -I "$ROOT/tools/vfr_manifest.py" write "$PDF" "$ROOT/tools/vfr_charts/manifest.json"
echo "done. Chart renders and overlays: $WORK/charts"
