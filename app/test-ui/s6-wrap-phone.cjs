// Browser regression check for stage S6 (phone): the "too wide for the window" advice on the phone leads to the whole-file wrap screen.
//   PHONE_URL=http://localhost:4284/ node test-ui/s6-wrap-phone.cjs
const { chromium } = require('playwright');
const PHONE = process.env.PHONE_URL || 'http://localhost:4284/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const wide = Array.from({ length: 40 }, () => 'довге слово').join(' ');
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [],
  files: { 'Map001.json': { a: { target: wide, status: 'draft', mt: 5 } } },
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, wrap: { mode: 'text' } },
  snapshot: { 'Map001.json': [{ key: 'a', source: 'Hello there, my friend, how are you doing today', speaker: '', kind: 'dialogue', context: '' }] },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => {
  const o = indexedDB.open('transly', 3);
  o.onsuccess = () => {
    const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite');
    tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default');
    tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error);
  };
  o.onerror = () => rej(o.error);
});
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PHONE); await sleep(800);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot });
  await page.reload(); await sleep(1500);
  await page.locator('.m-row').first().click({ timeout: 4000 }); await sleep(700);
  const link = page.locator('[data-sub="wrap"]', { hasText: 'Весь файл' });
  check('phone: the wide-line advice offers the whole-file wrap', await link.count() > 0);
  if (await link.count()) {
    await link.first().click(); await sleep(600);
    const body = await page.locator('body').innerText();
    check('phone: it opens the wrap screen', /Перенесення рядків/.test(body));
  }
  check('phone: no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
