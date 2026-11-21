// Browser regression check: one system of buttons (ui/buttons.css): three sizes (S 24, M 28, L 36), one radius (8; only the chips that filter are pills), the same
// hover everywhere, the same arrow (caret) on the project, branch and build buttons, and the window controls of the same shape as the icons next to them.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s48-buttons.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const T = 1700000000000;
const project = () => ({
  version: 1, name: 'Гра', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' },
  files: { 'Map001.json': { k0: { target: 'Привіт', status: 'draft', mt: T } } },
  snapshot: { 'Map001.json': ['Hello', 'World'].map((source, i) => ({ key: 'k' + i, source, speaker: 'Hero', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });
const box = sel => document => [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').map(e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return { id: e.id || e.className, w: Math.round(r.width), h: Math.round(r.height), r: c.borderTopLeftRadius }; });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);
  const m = (sel) => page.evaluate(box(sel).toString().replace(/^document => /, '') && ((s) => [...document.querySelectorAll(s)].filter(e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed').map(e => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return { id: e.id || String(e.className), w: Math.round(r.width), h: Math.round(r.height), r: c.borderTopLeftRadius }; })), sel);

  const tb = await m('.topbar .tb-ic');
  check('the icons of the top bar are M: 28 × 28, radius 8', tb.length >= 3 && tb.every(b => b.w === 28 && b.h === 28 && b.r === '8px'), JSON.stringify(tb));
  const pills = await m('.topbar .tpill');
  check('the project, branch and build buttons are M (28 high) with radius 8', pills.length >= 3 && pills.every(b => b.h === 28 && b.r === '8px'), JSON.stringify(pills));
  const seg = await m('.topbar #seg button');
  check('the buttons of the mode switch are M too', seg.length === 3 && seg.every(b => b.h === 28 && b.r === '8px'), JSON.stringify(seg));
  const rail = await m('.strip button');
  check('the rail of the panels: M, radius 8', rail.length >= 2 && rail.every(b => b.w === 28 && b.h === 28 && b.r === '8px'), JSON.stringify(rail));
  const carets = await page.evaluate(() => ['#proj-btn', '#br-btn', '#cfg-btn'].map(s => { const r = document.querySelector(s + ' .caret').getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; }));
  check('the arrows of the project, branch and build buttons are the same size', new Set(carets).size === 1, carets.join(' '));
  // the window controls: the same shape as the icons (M, rounded), not a flat slab
  await page.evaluate(() => { document.documentElement.classList.add('chrome-own'); const w = document.getElementById('wctl'); if (w) w.hidden = false; });
  await sleep(200);
  const wc = await m('#wctl button');
  check('the window controls are rounded buttons of the same height as the icons', wc.length === 3 && wc.every(b => b.h === 28 && b.r === '8px'), JSON.stringify(wc));
  // the field of the translation
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  await page.locator('#lp-rows .si').first().click(); await sleep(500);
  const ib = await m('.ebox .ib');
  check('the icon buttons of the field are M', ib.length >= 1 && ib.every(b => b.h === 28 && b.r === '8px'), JSON.stringify(ib));
  const save = await m('#b-save');
  check('the send button is L (36 × 36), radius 8', save.length === 1 && save[0].w === 36 && save[0].h === 36 && save[0].r === '8px', JSON.stringify(save));
  const chips = await m('.chip');
  check('the chips that filter are S (24 high) pills', chips.length >= 1 && chips.every(b => b.h === 24), JSON.stringify(chips));
  // a dialog
  await page.locator('#proj-btn').click(); await sleep(200); await page.locator('#projpop [data-pj="settings"]').click(); await sleep(600);
  const btn = await m('dialog .btn');
  check('the buttons of a dialog are M, radius 8', btn.length >= 1 && btn.every(b => b.h === 28 && b.r === '8px'), JSON.stringify(btn));
  const bad = await page.evaluate(() => [...document.querySelectorAll('button')].filter(e => e.offsetParent !== null).map(e => ({ r: getComputedStyle(e).borderTopLeftRadius, cls: String(e.className) })).filter(b => /(^|\s)(tb-ic|ib|saveb|btn|tpill|strip)\b/.test(b.cls) && !/^(8px|0px)$/.test(b.r)));
  check('no button of these families has another radius', bad.length === 0, JSON.stringify(bad.slice(0, 5)));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
