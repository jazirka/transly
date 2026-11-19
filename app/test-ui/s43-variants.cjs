// Browser regression check: «Переклади» under the field of the editing view: the translations of the row that were sent, a card for each send of each translator (the newest first, several
// from one translator all there), with a button that puts one into the field; the related things and the discussion stay in the panel on the right (two tabs on its rail).
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s43-variants.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const T = 1700000000000;
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' },
  files: { 'Map001.json': { k0: { target: 'Нокаут', status: 'done', mt: T + 3000, history: [
    { at: T, who: 'Оля', what: 'надіслано', text: 'Удар' },
    { at: T + 1000, who: 'Ви', what: 'правка', text: 'Нокаут!' },
    { at: T + 2000, who: 'Ви', what: 'надіслано', text: 'Нокдаун' },
    { at: T + 3000, who: 'Ви', what: 'надіслано', text: 'Нокаут' },
  ] } } },
  snapshot: { 'Map001.json': ['Knockout', 'Another line here'].map((source, i) => ({ key: 'k' + i, source, speaker: 'Hero', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  await page.locator('#lp-rows .si').first().click(); await sleep(600);

  const cards = () => page.locator('#f-var .var').evaluateAll(els => els.map(e => ({ who: e.querySelector('b').textContent, text: e.querySelector('.var-t').textContent, cur: e.classList.contains('cur'), btn: e.querySelector('button').textContent.trim(), off: e.querySelector('button').disabled })));
  let c = await cards();
  check('«Переклади» stands under the field and lists the sent translations, the newest first (the draft edit is not among them)', c.map(x => `${x.who}:${x.text}`).join('|') === 'Ви:Нокаут|Ви:Нокдаун|Оля:Удар', JSON.stringify(c));
  check('the translation the row holds is marked, and its button says it is in the field', c[0].cur && c[0].off && c[0].btn === 'У полі' && !c[1].cur && !c[1].off && c[1].btn === 'Підставити', JSON.stringify(c));
  check('the card has its title with the count', /Переклади\s*3/i.test(await page.locator('#f-var > .lbl').innerText()));
  await page.locator('#f-var .var').nth(2).locator('button').click(); await sleep(500);
  check('«Підставити» puts that translation into the field', (await page.locator('#i-tr').inputValue()) === 'Удар', await page.locator('#i-tr').inputValue());
  c = await cards();
  check('and now that card says it is in the field, the other one can be put', c[2].btn === 'У полі' && c[2].off && c[0].btn === 'Підставити', JSON.stringify(c));
  check('the row is a draft again: only the list of the translations that were sent stays what it was', c.length === 3 && c.every(x => !x.cur));

  // the related things and the discussion are on the right
  const rail = await page.locator('#stabs [data-p]').evaluateAll(els => els.map(e => e.dataset.p));
  check('the rail of the right panel keeps its two tabs: the row and the discussion', rail.join() === 'row,cm', rail.join());
  check('the related things stand in the right panel, not under the field', (await page.locator('#f-threads').count()) === 0 && (await page.locator('#f-var .thc2, #f-var .thb').count()) === 0 && (await page.locator('.pn-sec[data-sec="th"]').count()) === 1);
  check('the discussion is the second tab of the right panel (not under the field)', (await page.locator('#f-var #cm-in').count()) === 0 && (await page.locator('.fs #cm-in').count()) === 1);
  check('the activity of the row (the earlier translations with what was added and deleted) is in the panel too', (await page.locator('.pn-sub', { hasText: 'Активність у рядку' }).count()) === 1);

  // a row that was not sent has no card
  await page.locator('#lp-rows .si').nth(1).click(); await sleep(500);
  check('a row with nothing sent has no «Переклади»', !(await page.locator('#f-var').isVisible()), JSON.stringify(await page.evaluate(() => { const b = document.querySelector('#f-var'); return { hidden: b.hidden, disp: getComputedStyle(b).display, n: document.querySelector('#f-var-n').textContent, key: document.querySelector('#f-key').textContent, tr: document.querySelector('#i-tr').dataset.key }; })));
  check('no page errors', errors.length === 0, errors.join(' | '));
  if (process.env.SHOT_DIR) { await page.locator('#lp-rows .si').first().click(); await sleep(500); await page.screenshot({ path: process.env.SHOT_DIR + '/s43-variants.png' }); }
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
