// Browser regression check: the list of scenes has the same page island as the rows (a bubble at the foot of the window with ‹ 1 / 3 ›).
// Run as s0-safety.cjs:   PC_URL=http://localhost:4285/ node test-ui/s55-scene-pages.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + String(detail).slice(0, 200) : '')); if (!ok) failed++; };
const T = 1700000000000;
const rows = Array.from({ length: 240 }, (_, i) => ({ key: 'events[' + Math.floor(i / 2) + '].pages[0].list[' + (i % 2) + ']', source: 'Line ' + i, speaker: 'A', kind: 'dialogue', context: 'EV' + Math.floor(i / 2) }));
const project = { version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [], settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' }, files: { 'Map001.json': { [rows[0].key]: { target: 'Рядок', status: 'draft', mt: T } } } };
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(600);
  await page.evaluate(put, { text: JSON.stringify(project), snapshot: { 'Map001.json': rows } }); await page.reload(); await sleep(1500);
  await page.locator('[data-m="edit"]').click(); await sleep(400);
  await page.locator('#tree .node[data-file]').first().click({ timeout: 2000 }).catch(() => {}); await sleep(300);
  if (!(await page.locator('#lp-sc').isVisible())) { await page.locator('#strip [data-lp="scenes"]').click(); await sleep(500); }
  const pg = page.locator('#sc-pgb');
  check('120 scenes: the island of pages is shown at the foot of the window', await pg.isVisible(), await pg.innerText().catch(() => ''));
  check('it says «1 / 3»', /1 \/ 3/.test(await pg.innerText()));
  const first = await page.locator('#sc-list .sc-item').first().innerText();
  check('a page has 50 scenes', (await page.locator('#sc-list .sc-item').count()) === 50);
  await pg.locator('[data-sg="next"]').click(); await sleep(300);
  check('› goes to the next page', /2 \/ 3/.test(await pg.innerText()) && (await page.locator('#sc-list .sc-item').first().innerText()) !== first);
  await pg.locator('[data-sg="prev"]').click(); await sleep(300);
  check('‹ goes back', /1 \/ 3/.test(await pg.innerText()));
  const b = await pg.boundingBox();
  check('the island is a small bubble, not a bar across the window', !!b && b.height <= 36 && b.width < 220, JSON.stringify(b));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
