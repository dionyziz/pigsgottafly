// Minimal end-to-end harness: static server + headless Chrome driven over the DevTools protocol.
// No dependencies. Set CHROME=/path/to/chrome to override the browser location.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ARTIFACTS = path.join(ROOT, 'tests', 'e2e', 'artifacts');
fs.mkdirSync(ARTIFACTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Serves the built client (dist/: run `vite build` first; npm run test:e2e does) and the API on
// in-memory PGlite. Run with tsx loaded (node --import tsx), since the server is TypeScript.
export async function startServer(opts = {}) {
  const { createServer } = await import('../../server/server.ts');
  const server = createServer({ db: 'memory://', ...opts });
  await server.ready;
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

function chromePath() {
  const c = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const p = c.find((x) => fs.existsSync(x));
  if (!p) throw new Error('Chrome not found; set CHROME=/path/to/chrome');
  return p;
}

export async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'navlog-e2e-'));
  const proc = spawn(chromePath(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  const portFile = path.join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !fs.existsSync(portFile); i++) await sleep(100);
  const port = fs.readFileSync(portFile, 'utf8').split('\n')[0].trim();
  const base = `http://127.0.0.1:${port}`;
  return {
    async newPage() {
      const t = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
      const p = new Page(t.webSocketDebuggerUrl, t.id, base);
      await p.init();
      return p;
    },
    async close() {
      // Wait for Chrome to exit before removing its profile: it keeps writing there while shutting
      // down (ENOTEMPTY on a busy machine). A profile that still cannot be removed is left in tmp.
      const exited = proc.exitCode !== null ? Promise.resolve() : new Promise((r) => proc.once('exit', r));
      proc.kill();
      await Promise.race([exited, sleep(5000)]);
      try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (e) { console.warn(`e2e: could not remove ${profile}: ${e.message}`); }
    },
  };
}

export class Page {
  constructor(wsUrl, id, base) { this.wsUrl = wsUrl; this.id = id; this.base = base; this.seq = 0; this.pending = new Map(); this.handlers = new Map(); this.errors = []; this.requests = []; }
  async init() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((r, j) => { this.ws.addEventListener('open', r); this.ws.addEventListener('error', j); });
    this.ws.addEventListener('message', (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) { const { resolve, reject } = this.pending.get(d.id); this.pending.delete(d.id); d.error ? reject(new Error(d.error.message)) : resolve(d.result); }
      else if (d.method) (this.handlers.get(d.method) || []).forEach((h) => h(d.params));
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
    this.on('Runtime.exceptionThrown', (p) => this.errors.push('exception: ' + (p.exceptionDetails.exception?.description || p.exceptionDetails.text)));
    this.on('Runtime.consoleAPICalled', (p) => { if (p.type === 'error') this.errors.push('console.error: ' + p.args.map((a) => a.value ?? a.description).join(' ')); });
    // Content-Security-Policy violations (the built client is served with vercel.json's policy) are
    // browser log entries, not console calls: count them as page errors too.
    await this.send('Log.enable');
    this.on('Log.entryAdded', (p) => { if (/Content Security Policy/i.test(p.entry.text || '')) this.errors.push('csp: ' + p.entry.text); });
    this.on('Page.javascriptDialogOpening', () => this.send('Page.handleJavaScriptDialog', { accept: true }));
    await this.viewport(1600, 1300);
  }
  on(method, h) { if (!this.handlers.has(method)) this.handlers.set(method, []); this.handlers.get(method).push(h); }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); });
  }
  async viewport(width, height) { await this.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }); }
  async eval(fn, ...args) {
    const expression = typeof fn === 'function' ? `(${fn})(...${JSON.stringify(args)})` : fn;
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result.value;
  }
  // ready = the React app rendered something other than a loading screen
  async ready() { await this.waitFor(() => document.readyState === 'complete' && !!document.querySelector('#root > *') && !document.querySelector('.loading-screen')); }
  async goto(url) {
    // a URL that differs only after '#' is a same-document navigation: no load event fires
    const cur = await this.eval(() => location.href).catch(() => '');
    if (cur.split('#')[0] === url.split('#')[0] && cur.startsWith('http')) {
      await this.eval((u) => { location.href = u; }, url);
      await new Promise((r) => setTimeout(r, 50));
      await this.ready();
      return;
    }
    const loaded = new Promise((r) => { const h = () => { r(); }; this.on('Page.loadEventFired', h); });
    await this.send('Page.navigate', { url });
    await loaded;
    await this.ready();
  }
  async reload() {
    const loaded = new Promise((r) => this.on('Page.loadEventFired', r));
    await this.send('Page.reload');
    await loaded;
    await this.ready();
  }
  async waitFor(fn, { timeout = 8000, args = [] } = {}) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeout) {
      try { last = await this.eval(fn, ...args); if (last) return last; } catch (e) { last = e; }
      await sleep(50);
    }
    throw new Error(`waitFor timed out: ${fn}${last instanceof Error ? ' — ' + last.message : ''}`);
  }
  async idle(ms = 250) { await sleep(ms); }
  // Real keyboard input: focus, select all, delete, then insert text character by character.
  async type(selector, text, { clear = true } = {}) {
    await this.eval((s) => { const e = document.querySelector(s); if (!e) throw new Error('no element ' + s); e.scrollIntoView({ block: 'center' }); e.focus(); if (e.select) e.select(); }, selector);
    if (clear) await this.key('Backspace');
    for (const ch of String(text)) await this.send('Input.insertText', { text: ch });
  }
  async paste(selector, text) {
    await this.eval((s) => { const e = document.querySelector(s); e.focus(); e.select && e.select(); }, selector);
    await this.send('Input.insertText', { text });
  }
  // modifiers: 1 Alt, 2 Ctrl, 4 Meta, 8 Shift
  async key(key, modifiers = 0) {
    const codes = { Backspace: 8, Enter: 13, Tab: 9, Escape: 27 };
    const single = key.length === 1;
    const vk = codes[key] || (single ? key.toUpperCase().charCodeAt(0) : 0);
    const code = single ? 'Key' + key.toUpperCase() : key;
    // Enter carries text '\r' like a real keypress, so forms submit implicitly
    if (key === 'Enter') await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers, text: '\r', unmodifiedText: '\r' });
    else await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers });
  }
  async insert(text) { await this.send('Input.insertText', { text }); }
  async blur() { await this.eval(() => document.activeElement && document.activeElement.blur()); }
  // Real mouse click at the element's centre.
  async click(selector) {
    const box = await this.eval((s) => { const e = document.querySelector(s); if (!e) throw new Error('no element ' + s); e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; }, selector);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await this.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
  async select(selector, value) {
    await this.eval((s, v) => { const e = document.querySelector(s); e.value = v; e.dispatchEvent(new Event('change', { bubbles: true })); }, selector, value);
  }
  async screenshot(name, { fullPage = true } = {}) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage });
    const f = path.join(ARTIFACTS, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return f;
  }
  async pdf(name) {
    const r = await this.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
    const buf = Buffer.from(r.data, 'base64');
    const f = path.join(ARTIFACTS, name + '.pdf');
    fs.writeFileSync(f, buf);
    const s = buf.toString('latin1');
    const pages = (s.match(/\/Type\s*\/Page[^s]/g) || []).length;
    const box = s.match(/\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/);
    return { file: f, pages, width: box ? +box[1] : NaN, height: box ? +box[2] : NaN };
  }
  async media(m) { await this.send('Emulation.setEmulatedMedia', { media: m || '' }); }

  // Intercept requests matching a URL pattern and answer from handler(url) -> {status, body, contentType}
  async intercept(urlPattern, handler) {
    if (!this.routes) {
      this.routes = [];
      this.on('Fetch.requestPaused', async (p) => {
        const r = this.routes.find((x) => x.re.test(p.request.url));
        let out;
        try { out = r.handler(new URL(p.request.url), p.request); } catch (e) { out = { status: 500, body: { error: true, reason: String(e) } }; }
        if (out == null) { await this.send('Fetch.continueRequest', { requestId: p.requestId }); return; }   // let it through
        const text = typeof out.body === 'string' ? out.body : JSON.stringify(out.body);
        await this.send('Fetch.fulfillRequest', {
          requestId: p.requestId, responseCode: out.status || 200,
          responseHeaders: [{ name: 'Content-Type', value: out.contentType || 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }],
          body: Buffer.from(text).toString('base64'),
        });
      });
    }
    const re = new RegExp('^' + urlPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
    this.routes.push({ re, handler, urlPattern });
    await this.send('Fetch.enable', { patterns: this.routes.map((r) => ({ urlPattern: r.urlPattern, requestStage: 'Request' })) });
  }
  // Intercept Open-Meteo and answer from `handler(url) -> {status, body}`.
  async mockOpenMeteo(handler) {
    await this.intercept('*api.open-meteo.com*', (u) => { this.requests.push(u.href); return handler(u); });
  }
  async close() { try { await fetch(`${this.base}/json/close/${this.id}`); } catch { /* ignore */ } this.ws.close(); }
}
