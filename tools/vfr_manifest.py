"""Fingerprint the VFR chart PDFs of an extracted eAIP, or compare a new eAIP with the recorded ones.

  python3 -I tools/vfr_manifest.py write <eaip pdf dir> tools/vfr_charts/manifest.json
  python3 -I tools/vfr_manifest.py check <eaip pdf dir> tools/vfr_charts/manifest.json
`check` lists charts that are new, changed or gone: those need re-transcribing in tools/vfr_charts/.
"""
import glob, hashlib, json, os, re, sys

cmd, root, manifest = sys.argv[1:4]
found = {}
for f in glob.glob(os.path.join(root, '**', '*VFR*.pdf'), recursive=True):
    m = re.search(r'(LG[A-Z]{2})_VFR', os.path.basename(f))
    if m:
        found[m[1]] = {'file': os.path.relpath(f, root), 'sha256': hashlib.sha256(open(f, 'rb').read()).hexdigest()}
if cmd == 'write':
    json.dump(dict(sorted(found.items())), open(manifest, 'w'), indent=1)
    print(len(found), 'VFR charts recorded')
else:
    old = json.load(open(manifest))
    changed = sorted(k for k in found if k in old and found[k]['sha256'] != old[k]['sha256'])
    new = sorted(set(found) - set(old))
    gone = sorted(set(old) - set(found))
    for k in changed: print(f'CHANGED  {k}  {found[k]["file"]}')
    for k in new: print(f'NEW      {k}  {found[k]["file"]}')
    for k in gone: print(f'REMOVED  {k}')
    if not (changed or new or gone): print('VFR charts unchanged')
