// The tools work on the newest AIRAC cycle built so far (src/data/ref/cycles/<id>/ with its aerodromes): a cycle
// being loaded has its folder (AIP links, navaids) before build_ref.ts writes its aerodromes.
import fs from 'node:fs';
import path from 'node:path';

export function newestCycleDir(root: string): string {
  const dir = path.join(root, 'src', 'data', 'ref', 'cycles');
  const ids = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(
      (d) => d.isDirectory() && /^\d{4}$/.test(d.name) && fs.existsSync(path.join(dir, d.name, 'aerodromes.json')),
    )
    .map((d) => d.name)
    .sort();
  if (!ids.length) throw new Error(`no AIRAC cycle in ${dir}`);
  return path.join(dir, ids.at(-1)!);
}
