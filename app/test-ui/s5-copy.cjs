// Browser regression check for stage S5: the age of the newest copy outside the browser is always visible.
//   PC_URL=http://localhost:4285/ node test-ui/s5-copy.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [],
  files: { 'Map001.json': { a: { target: 'раз', status: 'draft', mt: 5 } } },
  settings: { tolerancePct: 1000, blockErrors: false, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': [{ key: 'a', source: 'One', speaker: '', kind: 'dialogue', context: '' }] },
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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  const { snapshot, ...rest } = project();
  await page.evaluate(put, { text: JSON.stringify(rest), snapshot });
  await page.reload(); await sleep(1500);
  const foot = async () => ({ t: await page.locator('#sb-sync').innerText(), cls: await page.locator('#sb-sync').getAttribute('class'), hidden: await page.locator('#sb-sync').isHidden() });
  let f = await foot();
  check('the footer says there is no copy outside the browser, and marks it', !f.hidden && /Копії поза браузером ще не було/.test(f.t) && /bad/.test(f.cls ?? ''), JSON.stringify(f));
  await page.click('#settings'); await sleep(400);
  await page.getByRole('tab', { name: 'Синхронізація' }).click();
  await page.evaluate(() => { for (const d of document.querySelectorAll('dialog details')) d.open = true; });
  const dl = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
  await page.click('#st-export'); await dl; await sleep(800);
  await page.keyboard.press('Escape'); await sleep(400);
  f = await foot();
  check('after saving the project to a file the footer shows the copy is fresh', /Копія: щойно/.test(f.t) && !/bad/.test(f.cls ?? ''), JSON.stringify(f));
  const p = await page.evaluate(stored);
  check('the mark is part of the stored project', p.stamps?.copy?.how === 'файл', JSON.stringify(p.stamps));
  await page.reload(); await sleep(1500);
  f = await foot();
  check('and it is still there after a restart', /Копія: щойно|Копія: \d+ хв/.test(f.t), f.t);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close(); await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
