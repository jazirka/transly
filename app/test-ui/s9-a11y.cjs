// Browser regression checks for the accessibility and input audit (a11y-input). See s0-safety.cjs for how to run:
//   PC_URL=http://localhost:4285/ node test-ui/s9-a11y.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [],
  settings: { tolerancePct: 1000, blockErrors: false, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': ['a', 'b', 'c'].map((k, i) => ({ key: k, source: 'Line number ' + (i + 1), speaker: '', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => {
  const o = indexedDB.open('transly', 3);
  o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
  o.onerror = () => rej(o.error);
});
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  const { snapshot, ...rest } = project();
  await page.evaluate(put, { text: JSON.stringify(rest), snapshot });
  await page.reload(); await sleep(1500);

  // a11y-01: the table is one stop of the Tab key even when no row is selected
  const stop = await page.evaluate(() => document.querySelectorAll('#grid .gr[tabindex="0"]').length);
  check('the table has a row in the Tab order before any row is selected', stop === 1, 'n=' + stop);
  await page.locator('.gr .src').nth(1).click(); await sleep(300);
  const stop2 = await page.evaluate(() => [...document.querySelectorAll('#grid .gr[tabindex="0"]')].map(r => r.dataset.key));
  check('after a click the clicked row is that stop', stop2.length === 1 && stop2[0] === 'b', JSON.stringify(stop2));

  // a11y-02: Enter on a span with role=button presses it
  await page.locator('#sb-sync').focus(); await page.keyboard.press('Enter'); await sleep(600);
  check('Enter on a role=button span (the sync item of the status bar) acts as a click', await page.locator('dialog[open]').count() > 0);
  await page.keyboard.press('Escape'); await sleep(300);

  // a11y-06: a message with an action does not go away under the pointer
  await page.locator('.gr .tr').nth(0).click(); await page.keyboard.type('Один'); await page.keyboard.press('Control+Enter'); await sleep(800);
  const t = page.locator('.toast').filter({ hasText: 'Скасувати' }).first();
  if (await t.count()) {
    await t.hover(); await sleep(8000);
    check('a toast under the pointer stays past its 7 seconds', await page.locator('.toast', { hasText: 'Скасувати' }).count() > 0);
    await page.mouse.move(5, 5); await sleep(8000);
    check('and goes when the pointer leaves', await page.locator('.toast', { hasText: 'Скасувати' }).count() === 0);
  } else check('a toast with an action appeared to test with', false);

  // a11y-08 / a11y-16
  check('original texts carry their language', await page.evaluate(() => !!document.querySelector('#grid .gr .src[lang="en"]')));
  // a11y-09: forced colours keep the status dots
  await page.emulateMedia({ forcedColors: 'active' }); await sleep(300);
  const bg = await page.evaluate(() => { const d = document.querySelector('#grid .gr .sd.draft, #grid .gr .sd.done'); return d ? getComputedStyle(d).backgroundColor : 'none'; });
  check('in forced colours the status dots keep their fill', bg !== 'none' && bg !== 'rgba(0, 0, 0, 0)', bg);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
