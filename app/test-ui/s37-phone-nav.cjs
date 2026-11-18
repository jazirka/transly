// Browser regression check (phone): the chosen destination of the bottom navigation is its icon on a filled pill; there is no box round the
// whole button, and the icons of the other destinations keep the same size, so nothing jumps when the tab changes.
// See s0-safety.cjs for how to run:   PHONE_URL=http://localhost:4284/ node test-ui/s37-phone-nav.cjs
const { chromium } = require('playwright');
const PHONE = process.env.PHONE_URL || 'http://localhost:4284/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': ['First line', 'Second line'].map((src, i) => ({ key: 'k' + i, source: src, speaker: '', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PHONE); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);
  const read = () => page.evaluate(() => [...document.querySelectorAll('#m-nav button')].map(b => { const s = b.querySelector('svg'), c = getComputedStyle(b), sc = getComputedStyle(s), r = s.getBoundingClientRect(); return { go: b.dataset.go, on: b.classList.contains('on'), btnBg: c.backgroundColor, btnShadow: c.boxShadow, iconBg: sc.backgroundColor, w: Math.round(r.width), h: Math.round(r.height), radius: sc.borderTopLeftRadius }; }));
  await page.locator('#m-nav [data-go="edit"]').click(); await sleep(500);
  const nav = await read(), on = nav.filter(n => n.on), off = nav.filter(n => !n.on);
  check('exactly one destination is chosen', on.length === 1 && on[0].go === 'edit', JSON.stringify(on));
  check('its icon lies on a filled pill', on[0].iconBg !== 'rgba(0, 0, 0, 0)' && parseInt(on[0].radius) >= 12, JSON.stringify(on[0]));
  check('and the button has no box, no fill and no ring of its own', on[0].btnBg === 'rgba(0, 0, 0, 0)' && on[0].btnShadow === 'none', JSON.stringify(on[0]));
  check('the others have no pill', off.every(n => n.iconBg === 'rgba(0, 0, 0, 0)'), JSON.stringify(off.map(n => n.iconBg)));
  check('and their icons are the same size, so nothing jumps', off.every(n => n.w === on[0].w && n.h === on[0].h), JSON.stringify(nav.map(n => [n.w, n.h])));
  await page.locator('#m-nav [data-go="rows"]').click(); await sleep(500);
  const nav2 = await read();
  check('choosing another destination moves the pill', nav2.filter(n => n.iconBg !== 'rgba(0, 0, 0, 0)').map(n => n.go).join() === 'rows', JSON.stringify(nav2.map(n => [n.go, n.iconBg])));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
