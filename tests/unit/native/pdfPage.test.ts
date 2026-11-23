// The app's PDF page (Resources/pdf/sheets.html) loads nothing in its web view: the images the sheet
// components name by path (the signatures' watermark) are inlined, and the committed page has them.
import fs from 'node:fs';

import { expect, test } from 'vitest';

import { inlinePublicImages, PDF_OUT } from '../../../tools/build_native_pdf';

test('a public image named in the code becomes a data: URL; anything else stays', () => {
  const out = inlinePublicImages('jsx(`img`,{src:`/icon.svg`}); a="/nothing-here.svg"; b="/api/x"');
  expect(out).toMatch(/src:`data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+`/);
  const svg = Buffer.from(/base64,([^`]+)`/.exec(out)![1], 'base64').toString('utf8');
  expect(svg).toBe(fs.readFileSync('public/icon.svg', 'utf8'));
  expect(out).toContain('a="/nothing-here.svg"');
  expect(out).toContain('b="/api/x"');
});

test('the committed page carries the watermark, not a path to it', () => {
  const page = fs.readFileSync(PDF_OUT, 'utf8');
  expect(page).not.toContain('/icon.svg');
  expect(page).toContain('data:image/svg+xml;base64,');
});
