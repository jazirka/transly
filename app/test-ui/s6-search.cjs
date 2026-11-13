// Browser regression check for stage S6: Ctrl+K says how many results each group really has. See s0-safety.cjs for how to run:
//   PC_URL=http://localhost:4285/ node test-ui/s6-search.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rows = n => Array.from({ length: n }, (_, i) => ({ key: 'k' + i, source: 'Line number ' + (i + 1), speaker: '', kind: 'dialogue', context: '' }));
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': rows(20), 'Map002.json': rows(3) },
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
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot });
  await page.reload(); await sleep(1500);
  await page.keyboard.press('Control+k'); await sleep(300);
  await page.fill('#sd-in', 'line number'); await sleep(400);
  const heads = await page.$$eval('#sd-res .sd-h', h => h.map(x => x.textContent));
  const items = await page.$$eval('#sd-res .sd-it', h => h.length);
  check('Ctrl+K: rows group says how many exist beyond the eight shown', heads.some(h => /^Рядки · показано 8 з 23$/.test(h)), JSON.stringify(heads));
  check('Ctrl+K: only eight rows are listed', items === 8, 'items=' + items);
  await page.fill('#sd-in', 'number 2'); await sleep(400);
  const heads2 = await page.$$eval('#sd-res .sd-h', h => h.map(x => x.textContent));
  check('Ctrl+K: a group that fits shows no counter', heads2.every(h => !/показано/.test(h)), JSON.stringify(heads2));
  check('Ctrl+K: no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
