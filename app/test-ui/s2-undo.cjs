// Browser regression checks for stage S2a (one undo path). See s0-safety.cjs for how to run:
//   PC_URL=http://localhost:4285/ node test-ui/s2-undo.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [],
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

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  const { snapshot, ...rest } = project();
  await page.evaluate(put, { text: JSON.stringify(rest), snapshot });
  await page.reload(); await sleep(1500);
  const send = async (n, text) => { await page.locator('.gr .tr').nth(n).click(); await page.keyboard.type(text); await page.keyboard.press('Control+Enter'); await sleep(900); };
  await send(0, 'Один'); await send(1, 'Два'); await send(2, 'Три');
  let p = await page.evaluate(stored);
  check('three single sends are stored as sent', ['a', 'b', 'c'].every(k => p.files['Map001.json'][k]?.status === 'done'), JSON.stringify(Object.values(p.files['Map001.json']).map(e => e.status)));
  check('every single send is an action of the journal (it carries a batch id)', ['a', 'b', 'c'].every(k => (p.files['Map001.json'][k].history ?? []).some(h => String(h.batch ?? '').startsWith('send:'))));
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('Control+z'); await sleep(900);
  p = await page.evaluate(stored);
  check('Ctrl+Z takes back the last single send (it used to say "Нічого скасовувати")', p.files['Map001.json'].c.status === 'draft' && p.files['Map001.json'].b.status === 'done', JSON.stringify(Object.values(p.files['Map001.json']).map(e => e.status)));
  const toastText = await page.locator('body').innerText();
  check('the message names the action that was taken back', /Скасовано «надіслано»/.test(toastText));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close(); await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
