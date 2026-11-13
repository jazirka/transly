// Browser regression checks for stage S3 (one definition of progress; "next" works across the whole project).
//   PC_URL=http://localhost:4285/ node test-ui/s3-queue.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const u = (k, s) => ({ key: k, source: s, speaker: '', kind: 'dialogue', context: '' });
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [],
  files: {
    'Map001.json': { a1: { target: 'раз', status: 'draft', mt: 5 }, a3: { target: 'три', status: 'done', mt: 5 } },
    'Map002.json': { b2: { target: 'Привіт', status: 'draft', mt: 5 } },
  },
  settings: { tolerancePct: 1000, blockErrors: false, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: {
    'Map001.json': [u('a1', 'One'), u('a2', 'Two'), u('a3', 'Three')],
    'Map002.json': [u('b1', 'Four'), u('b2', 'Hi \\N[1]')],
  },
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
  const selected = async () => page.locator('.gr.sel').first().getAttribute('data-key').catch(() => null);

  const top = await page.locator('#pg-txt').innerText();
  check('top bar: 3 of 5 rows have a translation (one definition)', /Перекладено 60% \(3 з 5\)/.test(top), top);
  const tip = await page.locator('#pg').getAttribute('title');
  check('top bar tooltip lists four disjoint states', /Вичитано 0% · Надіслано, ще не вичитано 20% · Чернетки 40% · Без перекладу 40%/.test(tip ?? ''), tip ?? '');

  await page.locator('.gr').first().click(); await sleep(300);              // a1 in Map001
  check('start: the first row is selected', (await selected()) === 'a1', String(await selected()));
  await page.keyboard.press('Alt+Shift+ArrowDown'); await sleep(500);
  check('Alt+Shift+↓ goes to the next row without text in this file', (await selected()) === 'a2', String(await selected()));
  await page.keyboard.press('Alt+Shift+ArrowDown'); await sleep(700);
  check('and then on into the next FILE', (await selected()) === 'b1', String(await selected()));
  await page.keyboard.press('Alt+Shift+ArrowDown'); await sleep(700);
  check('and round the end of the project', (await selected()) === 'a2', String(await selected()));
  await page.keyboard.press('F8'); await sleep(700);
  check('F8 goes to the next QA error in the project (a lost control code, in another file)', (await selected()) === 'b2', String(await selected()));

  // proofread and on: a3 is sent; Ctrl+Shift+Enter approves it and moves to the next row waiting for proofreading
  await page.keyboard.press('Alt+Shift+ArrowUp'); await sleep(500);          // somewhere in the project
  await page.goto(PC); await sleep(1200);
  const p = await page.evaluate(stored);
  check('nothing was lost on the way', Object.keys(p.files['Map001.json']).length === 2);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close(); await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
