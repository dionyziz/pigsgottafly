// Firefox driver over WebDriver BiDi, exposing the same page interface the Chrome harness offers
// (eval, waitFor, type, paste, click, select, blur, viewport, screenshot, mockOpenMeteo, requests, errors).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ARTIFACTS } from './harness.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function firefoxPath() {
  const c = [process.env.FIREFOX, '/Applications/Firefox.app/Contents/MacOS/firefox', '/usr/bin/firefox'].filter(
    Boolean,
  );
  return c.find((x) => fs.existsSync(x)) || null;
}

export async function launchFirefox() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'navlog-ff-'));
  const port = 9600 + Math.floor(Math.random() * 300);
  const proc = spawn(
    firefoxPath(),
    ['--headless', '--no-remote', '--profile', profile, `--remote-debugging-port=${port}`],
    { stdio: 'ignore', env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' } },
  );
  let ws;
  for (let i = 0; i < 120 && !ws; i++) {
    try {
      const s = new WebSocket(`ws://127.0.0.1:${port}/session`);
      await new Promise((r, j) => {
        s.onopen = r;
        s.onerror = j;
      });
      ws = s;
    } catch {
      await sleep(250);
    }
  }
  if (!ws) {
    proc.kill();
    throw new Error('Firefox did not start');
  }
  const page = new FirefoxPage(ws);
  try {
    await page.init();
  } catch (e) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    proc.kill();
    throw e;
  }
  page.close = async () => {
    try {
      await Promise.race([page.send('session.end'), sleep(2000)]);
    } catch {
      /* ignore */
    }
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    proc.kill();
    await sleep(300);
    fs.rmSync(profile, { recursive: true, force: true });
  };
  return page;
}

class FirefoxPage {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.errors = [];
    this.requests = [];
    this.handlers = [];
  }
  async init() {
    this.ws.onmessage = (m) => {
      const d = JSON.parse(m.data);
      if (d.id && this.pending.has(d.id)) {
        const { resolve, reject } = this.pending.get(d.id);
        this.pending.delete(d.id);
        d.type === 'error' ? reject(new Error(`${d.error}: ${d.message}`)) : resolve(d.result);
      } else if (d.method) this.handlers.forEach((h) => h(d));
    };
    await this.send('session.new', { capabilities: {} });
    await this.send('session.subscribe', { events: ['log.entryAdded', 'network.beforeRequestSent'] });
    this.handlers.push((d) => {
      if (d.method === 'log.entryAdded' && (d.params.level === 'error' || d.params.type === 'javascript'))
        this.errors.push(`${d.params.type}: ${d.params.text}`);
    });
    // a fresh content tab (the initial context can be privileged when system access is enabled)
    this.ctx = (await this.send('browsingContext.create', { type: 'tab' })).context;
    await this.viewport(1600, 1000);
  }
  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async viewport(width, height) {
    await this.send('browsingContext.setViewport', { context: this.ctx, viewport: { width, height } });
  }
  async eval(fn, ...args) {
    const expression = typeof fn === 'function' ? `(${fn})(...${JSON.stringify(args)})` : fn;
    const r = await this.send('script.evaluate', {
      expression: `Promise.resolve(${expression}).then((v) => JSON.stringify(v === undefined ? null : v))`,
      target: { context: this.ctx },
      awaitPromise: true,
    });
    if (r.type === 'exception') throw new Error('page eval failed: ' + r.exceptionDetails.text);
    return JSON.parse(r.result.value);
  }
  async ready() {
    await this.waitFor(
      () =>
        !document.body.classList.contains('loading') &&
        (!document.querySelector('#flight').hidden ? !!document.querySelector('.sheet') : true),
    );
  }
  async goto(url) {
    const cur = await this.eval(() => location.href).catch(() => '');
    if (cur.startsWith('http') && cur.split('#')[0] === url.split('#')[0]) {
      // same document: hash change only
      await this.eval((u) => {
        location.href = u;
      }, url);
      await sleep(50);
    } else await this.send('browsingContext.navigate', { context: this.ctx, url, wait: 'complete' });
    await this.ready();
  }
  async reload() {
    await this.send('browsingContext.reload', { context: this.ctx, wait: 'complete' });
    await this.ready();
  }
  async waitFor(fn, { timeout = 8000, args = [] } = {}) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < timeout) {
      try {
        last = await this.eval(fn, ...args);
        if (last) return last;
      } catch (e) {
        last = e;
      }
      await sleep(50);
    }
    throw new Error(`waitFor timed out: ${fn}${last instanceof Error ? ' — ' + last.message : ''}`);
  }
  async idle(ms = 250) {
    await sleep(ms);
  }
  // Real keyboard input via BiDi input actions.
  async type(selector, text) {
    await this.eval((s) => {
      const e = document.querySelector(s);
      if (!e) throw new Error('no element ' + s);
      e.focus();
      e.select && e.select();
    }, selector);
    const actions = [
      { type: 'keyDown', value: '' },
      { type: 'keyUp', value: '' },
    ];
    for (const ch of String(text)) actions.push({ type: 'keyDown', value: ch }, { type: 'keyUp', value: ch });
    await this.send('input.performActions', { context: this.ctx, actions: [{ type: 'key', id: 'kb', actions }] });
  }
  async paste(selector, text) {
    await this.eval(
      (s, t) => {
        const e = document.querySelector(s);
        e.focus();
        e.value = t;
        e.dispatchEvent(new Event('input', { bubbles: true }));
      },
      selector,
      text,
    );
  }
  async click(selector) {
    const b = await this.eval((s) => {
      const e = document.querySelector(s);
      if (!e) throw new Error('no element ' + s);
      const r = e.getBoundingClientRect();
      return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
    }, selector);
    await this.send('input.performActions', {
      context: this.ctx,
      actions: [
        {
          type: 'pointer',
          id: 'mouse',
          actions: [
            { type: 'pointerMove', x: b.x, y: b.y },
            { type: 'pointerDown', button: 0 },
            { type: 'pointerUp', button: 0 },
          ],
        },
      ],
    });
  }
  async select(selector, value) {
    await this.eval(
      (s, v) => {
        const e = document.querySelector(s);
        e.value = v;
        e.dispatchEvent(new Event('change', { bubbles: true }));
      },
      selector,
      value,
    );
  }
  async blur() {
    await this.eval(() => document.activeElement && document.activeElement.blur());
  }
  async media() {
    /* print emulation is not available over BiDi; print is covered by the PDF check */
  }
  async screenshot(name) {
    const r = await this.send('browsingContext.captureScreenshot', { context: this.ctx });
    const f = path.join(ARTIFACTS, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    return f;
  }
  async pdf(name) {
    const r = await this.send('browsingContext.print', {
      context: this.ctx,
      orientation: 'landscape',
      page: { width: 29.7, height: 21.0 },
      margin: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 },
      background: true,
    });
    const buf = Buffer.from(r.data, 'base64');
    const f = path.join(ARTIFACTS, name + '.pdf');
    fs.writeFileSync(f, buf);
    return { file: f, pages: (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length };
  }
  async mockOpenMeteo(handler) {
    await this.send('network.addIntercept', {
      phases: ['beforeRequestSent'],
      urlPatterns: [{ type: 'pattern', protocol: 'https', hostname: 'api.open-meteo.com' }],
    });
    this.handlers.push(async (d) => {
      if (d.method !== 'network.beforeRequestSent' || !d.params.isBlocked) return;
      const url = d.params.request.url;
      this.requests.push(url);
      let out;
      try {
        out = handler(new URL(url));
      } catch (e) {
        out = { status: 500, body: { error: true, reason: String(e) } };
      }
      await this.send('network.provideResponse', {
        request: d.params.request.request,
        statusCode: out.status || 200,
        reasonPhrase: 'OK',
        headers: [
          { name: 'Content-Type', value: { type: 'string', value: 'application/json' } },
          { name: 'Access-Control-Allow-Origin', value: { type: 'string', value: '*' } },
        ],
        body: { type: 'string', value: JSON.stringify(out.body) },
      });
    });
  }
}
