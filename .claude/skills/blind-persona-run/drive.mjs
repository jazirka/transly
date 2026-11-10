// Helper for blind personas: a persistent browser profile (so progress survives between scripts), a numbered evidence trail
// (screenshot + accessibility snapshot per step) and an error log. Knows nothing about any particular app.
//
//   import { open } from '<method>/blind-persona-run/drive.mjs';
//   const s = await open({ url, profile, outDir, device: 'Pixel 7' });   // or viewport: { width: 1400, height: 900 }
//   await s.page.getByRole('button', { name: /open/i }).click();
//   await s.snap('after opening the menu', 'I expected a list of files');
//   await s.close();
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium, devices } = require('playwright');

export async function open({ url, profile, outDir, device, viewport, colorScheme = 'dark', locale = 'uk-UA', cpuThrottle = 1, reducedMotion = 'no-preference', forcedColors = 'none', fresh = false }) {
  fs.mkdirSync(outDir, { recursive: true });
  if (fresh) fs.rmSync(profile, { recursive: true, force: true });
  const d = device ? devices[device] : undefined;
  if (device && !d) throw new Error(`unknown device ${device}; try ${Object.keys(devices).slice(0, 8).join(', ')}`);
  const ctx = await chromium.launchPersistentContext(profile, {
    headless: true, args: ['--no-sandbox'], locale, colorScheme, reducedMotion, forcedColors,
    ...(d ? d : { viewport: viewport ?? { width: 1400, height: 900 } }),
  });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push({ t: Date.now(), kind: 'pageerror', text: String(e.message ?? e) }));
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) errors.push({ t: Date.now(), kind: 'console.' + m.type(), text: m.text() }); });
  page.on('requestfailed', r => errors.push({ t: Date.now(), kind: 'requestfailed', text: r.url() + ' ' + (r.failure()?.errorText ?? '') }));
  if (cpuThrottle > 1) { const c = await ctx.newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle }); }
  if (url) await page.goto(url);
  let n = fs.existsSync(path.join(outDir, 'steps.jsonl')) ? fs.readFileSync(path.join(outDir, 'steps.jsonl'), 'utf8').split('\n').filter(Boolean).length : 0;
  const slug = s => s.toLowerCase().replace(/[^a-z0-9а-яіїєґ]+/gi, '-').replace(/^-|-$/g, '').slice(0, 50) || 'step';
  return {
    page, ctx, errors,
    /** One step of the trail: what you expected, what you saw, whether anything confused you. */
    async snap(label, note = '', confusion = '') {
      n++;
      const base = path.join(outDir, String(n).padStart(3, '0') + '-' + slug(label));
      await page.screenshot({ path: base + '.png' });
      let aria = '';
      try { aria = await page.locator('body').ariaSnapshot(); } catch { /* page may be gone */ }
      fs.writeFileSync(base + '.aria.txt', aria);
      fs.appendFileSync(path.join(outDir, 'steps.jsonl'), JSON.stringify({ n, label, note, confusion, url: page.url(), screenshot: path.basename(base) + '.png', errorsSoFar: errors.length }) + '\n');
      return base + '.png';
    },
    /** Choose files through whatever opens the system file dialog. */
    async chooseFiles(trigger, files) {
      const [fc] = await Promise.all([page.waitForEvent('filechooser'), trigger.click()]);
      await fc.setFiles(files);
    },
    async close() { fs.writeFileSync(path.join(outDir, 'errors.json'), JSON.stringify(errors, null, 2)); await ctx.close(); },
  };
}

/** All regular files below a directory, for `setFiles` of a folder-style picker. */
export function filesIn(dir) { return fs.readdirSync(dir).map(f => path.join(dir, f)).filter(f => fs.statSync(f).isFile()); }
