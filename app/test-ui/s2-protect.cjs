// Browser regression checks for stage S2b (bulk tools leave proofread rows alone). See s0-safety.cjs for how to run:
//   PC_URL=http://localhost:4285/ node test-ui/s2-protect.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [],
  files: { 'Map001.json': { a: { target: 'old a', status: 'appr', mt: 5 }, b: { target: 'old b', status: 'done', mt: 5 }, c: { target: 'old c', status: 'draft', mt: 5 } } },
  settings: { tolerancePct: 1000, blockErrors: false, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': ['a', 'b', 'c'].map((k, i) => ({ key: k, source: 'Line number ' + (i + 1), speaker: '', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => {
  const o = indexedDB.open('transly', 3);
  o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
  o.onerror = () => rej(o.error);
});
const stored = () => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const g = db.transaction('projects').objectStore('projects').get('default'); g.onsuccess = () => { db.close(); res(JSON.parse(g.result)); }; g.onerror = () => rej(g.error); }; o.onerror = () => rej(o.error); });
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

async function openReplace(page) {
  await page.click('#hamb'); await sleep(300);
  await page.getByRole('menuitem', { name: 'Інструменти' }).first().click().catch(async () => { await page.getByText('Інструменти', { exact: true }).first().click(); }); await sleep(300);
  await page.getByText('Знайти й замінити…', { exact: false }).first().click(); await sleep(500);
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  for (const include of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await page.goto(PC); await sleep(800);
    const { snapshot, ...rest } = project();
    await page.evaluate(put, { text: JSON.stringify(rest), snapshot });
    await page.reload(); await sleep(1500);
    await openReplace(page);
    await page.fill('#fr-find', 'old'); await page.fill('#fr-rep', 'new'); await sleep(400);
    const sum = await page.locator('#fr-sum').innerText();
    check(`[${include ? 'include' : 'default'}] the preview says what happens to proofread and sent rows`, /Вичитаних/.test(sum) && /Надісланих/.test(sum), sum.slice(0, 160));
    if (include) await page.check('#fr-appr');
    await sleep(300);
    await page.click('#fr-go'); await sleep(1200);
    const p = await page.evaluate(stored);
    const f = p.files['Map001.json'];
    if (!include) {
      check('default: the proofread row is untouched', f.a.target === 'old a' && f.a.status === 'appr', JSON.stringify(f.a));
    } else {
      check('included: the proofread row is replaced and falls back to a draft', f.a.target === 'new a' && f.a.status === 'draft', JSON.stringify(f.a));
    }
    check('the sent row is replaced and becomes a draft', f.b.target === 'new b' && f.b.status === 'draft', JSON.stringify(f.b));
    check('the draft row is replaced', f.c.target === 'new c');
    const text = await page.locator('body').innerText();
    check('the message names the action and what was left out', /Знайдено й замінено/.test(text) && (include || /Вичитаних пропущено: 1/.test(text)));
    check('no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
