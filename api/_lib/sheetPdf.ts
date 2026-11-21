// The W&B and performance sheets e-mailed to an operator, printed by headless Chromium exactly as the
// website prints them (routes/declarations.ts). Chromium opens the PDF page of the built client
// (pdf.html → src/pdf/main.tsx: the export page's own sheet components and CSS), drawn from the
// WbPerfContent the pilot sent, and prints it to PDF with the print CSS (A4, vector text).
//
// Security: the browser never sees a session or the API. It gets the content (already normalized by
// wbPerfContentOf: bounded, no links) as data (window.__PGF_SHEETS__, passed through CDP, never
// spliced into code) and loads nothing from the network: every request goes to a made-up origin
// and is answered from the built client on disk (GET only, known file types, paths inside distDir);
// anything else is aborted. React escapes the text, so the content cannot become markup or script.
//
// Chromium: CHROME (or the executablePath option), else a local Chrome/Chromium, else on Vercel
// (Linux) @sparticuz/chromium (vercel.json ships its bin/ and dist/ with the function). Launched per
// print and closed after it; everything is bounded by timeoutMs. Any failure throws: the caller falls
// back to the server's own PDF writer (declarationPdf.ts) and records the error.
import fs from 'node:fs';
import path from 'node:path';

import type { WbPerfContent } from '../../src/shared/declarations.js';

/** The PIC's e-signature on the sheets (name, when it was signed: epoch ms). */
export interface SheetSignature {
  name: string;
  signedAt: number;
}
/** Prints the sheets to PDF; throws when it cannot. */
export type SheetPdfRenderer = (content: WbPerfContent, signature: SheetSignature | null) => Promise<Buffer>;

export interface ChromiumSheetPdfOptions {
  /** The built client (vite build): holds pdf.html, assets/ and fonts/. */
  distDir: string;
  /** A Chrome or Chromium binary; default CHROME, a local install, or @sparticuz/chromium. */
  executablePath?: string;
  /** The whole print, launch included (default 25 s). */
  timeoutMs?: number;
}

/** The origin the page is served under (answered from disk; never resolved). */
const ORIGIN = 'https://sheets.pdf.invalid';
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};
const LOCAL_BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

/** A local Chrome/Chromium (CHROME first), or null. */
export function localChrome(env: NodeJS.ProcessEnv = process.env): string | null {
  return [env.CHROME, ...LOCAL_BROWSERS].find((p): p is string => !!p && fs.existsSync(p)) ?? null;
}

/** The file of distDir a request URL names, or null when it is not one we serve. */
export function servedFile(distDir: string, url: string): string | null {
  if (!url.startsWith(`${ORIGIN}/`)) return null;
  let rel: string;
  try {
    rel = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
  } catch {
    return null;
  }
  if (!rel || rel.includes('\0') || !TYPES[path.extname(rel).toLowerCase()]) return null;
  const root = path.resolve(distDir);
  const file = path.resolve(root, rel);
  if (!file.startsWith(root + path.sep)) return null;
  return fs.existsSync(file) && fs.statSync(file).isFile() ? file : null;
}

async function browserBinary(opts: ChromiumSheetPdfOptions): Promise<{ path: string; args: string[]; shell: boolean }> {
  const local = opts.executablePath ?? localChrome();
  if (local)
    return { path: local, args: ['--no-first-run', '--no-default-browser-check', '--hide-scrollbars'], shell: false };
  // serverless Linux (Vercel): Chromium unpacked to /tmp from the package's bin/ (cached there)
  const chromium = (await import('@sparticuz/chromium')).default;
  chromium.setGraphicsMode = false;
  return { path: await chromium.executablePath(), args: chromium.args, shell: true };
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** The renderer: headless Chromium printing src/pdf/ from distDir. */
export function chromiumSheetPdf(opts: ChromiumSheetPdfOptions): SheetPdfRenderer {
  const timeoutMs = opts.timeoutMs ?? 25_000;
  return async (content, signature) => {
    if (!fs.existsSync(path.join(opts.distDir, 'pdf.html')))
      throw new Error(`the PDF page is not built (${path.join(opts.distDir, 'pdf.html')})`);
    const started = Date.now();
    const left = () => Math.max(1000, timeoutMs - (Date.now() - started));
    const { default: puppeteer } = await import('puppeteer-core');
    const bin = await withTimeout(browserBinary(opts), left(), 'unpacking Chromium');
    const browser = await puppeteer.launch({
      executablePath: bin.path,
      args: bin.args,
      headless: bin.shell ? 'shell' : true,
      timeout: left(),
    });
    try {
      return await withTimeout(
        (async () => {
          const page = await browser.newPage();
          const problems: string[] = [];
          page.on('pageerror', (e) => problems.push(String((e as Error)?.message ?? e)));
          await page.setBypassServiceWorker(true);
          await page.setRequestInterception(true);
          page.on('request', (req) => {
            const file = req.method() === 'GET' ? servedFile(opts.distDir, req.url()) : null;
            if (!file) {
              if (!req.url().startsWith('data:')) problems.push(`blocked ${req.method()} ${req.url().slice(0, 120)}`);
              void req.abort('blockedbyclient').catch(() => {});
              return;
            }
            void req
              .respond({
                status: 200,
                contentType: TYPES[path.extname(file).toLowerCase()],
                body: fs.readFileSync(file),
              })
              .catch(() => {});
          });
          await page.evaluateOnNewDocument(
            (snap) => {
              (window as unknown as { __PGF_SHEETS__: unknown }).__PGF_SHEETS__ = snap;
            },
            { content, signature },
          );
          await page.goto(`${ORIGIN}/pdf.html`, { waitUntil: 'load', timeout: left() });
          try {
            await page.waitForSelector('html[data-pdf-ready="true"]', { timeout: left() });
          } catch (e) {
            throw new Error(`the sheets did not render: ${problems.slice(0, 3).join('; ') || (e as Error).message}`, {
              cause: e,
            });
          }
          const pdf = Buffer.from(await page.pdf({ printBackground: true, preferCSSPageSize: true, timeout: left() }));
          if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw new Error('Chromium printed no PDF');
          return pdf;
        })(),
        left(),
        'printing the sheets',
      );
    } finally {
      await browser.close().catch(() => {});
    }
  };
}
