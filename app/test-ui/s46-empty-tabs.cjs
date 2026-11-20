// Browser regression check: a tab of the right panel with nothing in it says so, in the middle of the panel («Брак коментарів», «Брак пов’язаного», «Брак активності»),
// not in a corner of an empty dark panel; the field for a new comment stays at the foot. See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s46-empty-tabs.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });

const T = 1700000000000;
const project = () => ({ version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [], settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' }, files: { 'Map001.json': { k0: { target: 'Нокаут', status: 'done', mt: T + 3000 } } }, snapshot: { 'Map001.json': ['Knockout', 'Another line here'].map((source, i) => ({ key: 'k' + i, source, speaker: 'Hero', kind: 'dialogue', context: '' })) } });
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage();
  const errors = []; page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(500);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  await page.locator('#lp-rows .si').nth(1).click(); await sleep(500); // a row with no history, no comments, nothing related
  const where = async () => page.evaluate(() => { const m = [...document.querySelectorAll('#s-pn .pn-mid')].find(e => e.getBoundingClientRect().width > 0); if (!m) return null; const pane = document.querySelector('#s-pn').getBoundingClientRect(), r = m.getBoundingClientRect(); return { txt: m.textContent, cx: (r.left + r.right) / 2 - (pane.left + pane.right) / 2, cy: ((r.top + r.bottom) / 2 - pane.top) / pane.height, align: getComputedStyle(m).textAlign }; });
  for (const [tab, txt, lo, hi] of [['act', 'Брак активності', .3, .7], ['rel', 'Брак пов’язаного', .3, .7], ['cm', 'Брак коментарів', .2, .8]]) {
    await page.locator(`#stabs [data-p="${tab}"]`).click(); await sleep(400);
    const w = await where();
    check(`${tab}: says «${txt}»`, !!w && w.txt === txt, JSON.stringify(w));
    check(`${tab}: the message stands in the middle of the panel (across and down)`, !!w && Math.abs(w.cx) <= 10 && w.cy > lo && w.cy < hi && w.align === 'center', JSON.stringify(w));
  }
  const foot = await page.evaluate(() => { const f = document.querySelector('#s-pn .cm-new').getBoundingClientRect(), pane = document.querySelector('#s-pn').getBoundingClientRect(); return pane.bottom - f.bottom; });
  check('the field for a new comment stays at the foot of the panel', foot < 40, String(foot));
  check('no page errors', errors.length === 0, errors.join(' | '));
  if (process.env.SHOT_DIR) { for (const t of ['rel', 'cm']) { await page.locator(`#stabs [data-p="${t}"]`).click(); await sleep(300); await page.screenshot({ path: process.env.SHOT_DIR + '/s46-' + t + '.png', clip: { x: 1000, y: 36, width: 400, height: 440 } }); } }
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
