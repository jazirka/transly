#!/usr/bin/env node
// Screenshot matrix + mechanical checks.   node matrix.mjs <config.json>
// config: { "url": "http://localhost:4275/", "outDir": "...", "setup": "/abs/path/setup.mjs", "states": ["empty","loaded",...],
//           "viewports": [{ "name": "desktop", "width": 1400, "height": 900 }, { "name": "phone", "device": "Pixel 7" }],
//           "schemes": ["dark","light"], "axe": "/abs/path/axe.min.js" }
// setup.mjs: export default async function (page, state, ctx) { ... bring the page to the named state ... }   (written by the auditor)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { mechanicalChecks, axeContrast } from './checks.mjs';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');
const cfg = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
fs.mkdirSync(cfg.outDir, { recursive: true });
const setup = (await import(cfg.setup)).default;
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const index = [];
for (const vp of cfg.viewports) for (const scheme of cfg.schemes ?? ['dark']) for (const state of cfg.states) {
  const d = vp.device ? devices[vp.device] : null;
  const ctx = await browser.newContext({ colorScheme: scheme, locale: 'uk-UA', ...(d ?? { viewport: { width: vp.width, height: vp.height } }) });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message ?? e)));
  const base = `${vp.name}-${scheme}-${state}`;
  let status = 'ok', checks = null, contrast = null;
  try {
    await page.goto(cfg.url);
    await setup(page, state, { vp, scheme });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(cfg.outDir, base + '.png') });
    checks = await mechanicalChecks(page, { touch: !!(d?.hasTouch || vp.touch) });
    contrast = await axeContrast(page, cfg.axe);
  } catch (e) { status = 'setup-failed: ' + String(e.message ?? e).split('\n')[0]; }
  index.push({ name: base, viewport: vp.name, scheme, state, status, screenshot: base + '.png', errors, checks, contrast });
  fs.writeFileSync(path.join(cfg.outDir, 'matrix-index.json'), JSON.stringify(index, null, 2));
  await ctx.close();
}
await browser.close();
const bad = index.filter(i => i.status !== 'ok').length;
console.log(`matrix: ${index.length} cells, ${bad} failed to set up; see ${path.join(cfg.outDir, 'matrix-index.json')}`);
