// Post-deploy smoke test: npm run smoke -- https://pigsgottafly.com
// Checks that /api/health is 200 and ok (database, migrations), the SPA shell is served (also on a
// client route), one of its built assets loads, and /api/session answers JSON. Exits 1 on any failure.
// Read-only: it records nothing and needs no credentials.
const base = (process.argv[2] || process.env.SMOKE_URL || '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('usage: npm run smoke -- https://pigsgottafly.com');
  process.exit(2);
}

let failed = 0;
async function check(name: string, fn: () => Promise<string>): Promise<void> {
  const t = Date.now();
  try {
    const note = await fn();
    console.log(`ok    ${name} (${Date.now() - t} ms)${note ? ` ${note}` : ''}`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${name} (${Date.now() - t} ms): ${(e as Error).message}`);
  }
}

async function get(path: string): Promise<{ res: Response; text: string }> {
  const res = await fetch(base + path, { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'pgf-smoke' } });
  return { res, text: await res.text() };
}
function expect(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

let assetPath: string | null = null;

await check('GET /api/health', async () => {
  const { res, text } = await get('/api/health');
  let body: any = null;
  try { body = JSON.parse(text); } catch { /* reported below */ }
  expect(res.status === 200, `HTTP ${res.status} ${body?.error ?? text.slice(0, 200)}`);
  expect(body?.ok === true, `ok is not true: ${text.slice(0, 200)}`);
  const c = body.checks;
  const warn = [!c?.airac?.ok && `AIRAC ${c?.airac?.id} out of date`, !c?.mail?.ok && 'e-mail not configured'].filter(Boolean);
  return `release ${body.release}, migrations ${c?.migrations?.applied}/${c?.migrations?.expected}${warn.length ? `, WARNING: ${warn.join(', ')}` : ''}`;
});

await check('GET / (SPA)', async () => {
  const { res, text } = await get('/');
  expect(res.status === 200, `HTTP ${res.status}`);
  expect(/<div id="root">/.test(text), 'no #root in the page');
  assetPath = /(?:src|href)="(\/assets\/[^"]+\.js)"/.exec(text)?.[1] ?? null;
  expect(assetPath, 'no /assets/*.js script in the page');
  return assetPath;
});

await check('GET /hangar (client route → SPA)', async () => {
  const { res, text } = await get('/hangar');
  expect(res.status === 200, `HTTP ${res.status}`);
  expect(/<div id="root">/.test(text), 'no #root in the page');
  return '';
});

await check('GET static asset', async () => {
  expect(assetPath, 'no asset found on the page');
  const { res, text } = await get(assetPath);
  expect(res.status === 200, `HTTP ${res.status}`);
  expect(/javascript/.test(res.headers.get('content-type') || ''), `content-type ${res.headers.get('content-type')}`);
  expect(text.length > 1000, `only ${text.length} bytes`);
  return `${Math.round(text.length / 1024)} KB`;
});

await check('GET /api/session', async () => {
  const { res, text } = await get('/api/session');
  expect(res.status === 200, `HTTP ${res.status} ${text.slice(0, 200)}`);
  const body = JSON.parse(text);
  expect(typeof body.authed === 'boolean', 'no authed field');
  return `mode ${body.mode}`;
});

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
