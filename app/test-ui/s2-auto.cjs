// Browser regression check for stage S2b: a row filled in from an equal original is a draft marked «авто», not a sent row.
//   PC_URL=http://localhost:4285/ node test-ui/s2-auto.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [],
  settings: { tolerancePct: 1000, blockErrors: false, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': [['a', 'Hello there'], ['b', 'Hello there'], ['c', 'Something else']].map(([k, s]) => ({ key: k, source: s, speaker: '', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => {
  const o = indexedDB.open('transly', 3);
  o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
  o.onerror = () => rej(o.error);
});
const stored = () => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const g = db.transaction('projects').objectStore('projects').get('default'); g.onsuccess = () => { db.close(); res(JSON.parse(g.result)); }; g.onerror = () => rej(g.error); }; o.onerror = () => rej(o.error); });
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
  await page.locator('.gr').nth(0).click(); await sleep(300);
  await page.click('[data-m="edit"]'); await sleep(500);
  await page.locator('#i-tr').click(); await page.keyboard.type('Привіт'); await page.keyboard.press('Control+Enter'); await sleep(1500);
  const p = await page.evaluate(stored);
  const f = p.files['Map001.json'];
  check('the sent row is sent', f.a.status === 'done');
  check('the equal original is filled in with the same text', f.b && f.b.target === 'Привіт', JSON.stringify(f.b));
  check('and it is a DRAFT, not a sent row', f.b && f.b.status === 'draft');
  check('the history says it was filled in automatically', f.b && /автозаповнено/.test(f.b.history?.at(-1)?.what ?? ''), f.b?.history?.at(-1)?.what);
  check('a different original is not touched', !f.c);
  await page.click('[data-m="table"]'); await sleep(500);
  await page.locator('.gr').nth(1).click(); await sleep(600);
  const chip = await page.locator('.cc', { hasText: /^авто$/ }).count();
  check('the row shows the «авто» mark', chip > 0, 'chips: ' + chip);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();

  // the same from the table: Ctrl+Enter in a cell also fills in the equal original (it used to do so only in the editing view)
  {
    const c2 = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const p2 = await c2.newPage();
    await p2.goto(PC); await sleep(800);
    await p2.evaluate(put, { text: JSON.stringify(rest), snapshot });
    await p2.reload(); await sleep(1500);
    await p2.locator('.gr .tr').nth(0).click(); await p2.keyboard.type('Вітаю'); await p2.keyboard.press('Control+Enter'); await sleep(1500);
    const f2 = (await p2.evaluate(stored)).files['Map001.json'];
    check('table Ctrl+Enter: the sent row is sent', f2.a?.status === 'done');
    check('table Ctrl+Enter: the equal original is filled in as a draft', f2.b?.target === 'Вітаю' && f2.b?.status === 'draft', JSON.stringify(f2.b));
    await c2.close();
  }
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
