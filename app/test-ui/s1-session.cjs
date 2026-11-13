// Browser regression checks for stage S1 (the stored project is never overwritten unseen). See s0-safety.cjs for how to run:
//   PC_URL=http://localhost:4285/ node test-ui/s1-session.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': ['a', 'b', 'c'].map((k, i) => ({ key: k, source: 'Line number ' + (i + 1), speaker: '', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => {
  const o = indexedDB.open('transly', 3);
  o.onsuccess = () => {
    const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite');
    tx.objectStore('projects').put(text, 'default'); if (snapshot) tx.objectStore('snapshots').put(snapshot, 'default');
    tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error);
  };
  o.onerror = () => rej(o.error);
});
const readAll = () => new Promise((res, rej) => {
  const o = indexedDB.open('transly', 3);
  o.onsuccess = () => {
    const db = o.result; const out = {};
    const tx = db.transaction(['projects', 'snapshots']);
    const a = tx.objectStore('projects').get('default'); a.onsuccess = () => { out.project = a.result ?? null; };
    const k = tx.objectStore('snapshots').getAllKeys(); const v = tx.objectStore('snapshots').getAll();
    v.onsuccess = () => { out.keys = k.result; out.values = v.result; };
    tx.oncomplete = () => { db.close(); res(out); }; tx.onerror = () => rej(tx.error);
  };
  o.onerror = () => rej(o.error);
});

let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ---- 1. a stored project this build cannot read is shown to the translator and is not overwritten
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(PC); await sleep(800);
    const unreadable = JSON.stringify({ version: 2, name: 'З майбутнього', files: { 'Map001.json': { a: { target: 'Мій важливий переклад', status: 'done', mt: 5 } } } });
    await page.evaluate(put, { text: unreadable });
    await page.reload(); await sleep(1500);
    const alert = await page.locator('[role=alert]').first().innerText().catch(() => '');
    check('unreadable project: the translator is told what happened', /не вдалося прочитати/i.test(alert), alert.slice(0, 60));
    await sleep(2500);
    let st = await page.evaluate(readAll);
    check('unreadable project: the stored record is untouched after a few seconds', st.project === unreadable);
    await page.getByRole('button', { name: 'Почати з порожнього проєкту' }).click(); await sleep(1500);
    st = await page.evaluate(readAll);
    check('unreadable project: starting an empty one keeps the old record as a copy', st.keys.some(k => String(k).startsWith('default:unreadable:')) && st.values.some(v => v === unreadable));
    await ctx.close();
  }

  // ---- 2. two tabs: neither overwrites the other's work
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const A = await ctx.newPage(), errors = [];
    A.on('pageerror', e => errors.push(String(e.message)));
    await A.goto(PC); await sleep(800);
    await A.evaluate(put, { text: JSON.stringify((({ snapshot, ...r }) => r)(project())), snapshot: project().snapshot });
    await A.reload(); await sleep(1500);
    const B = await ctx.newPage(); B.on('pageerror', e => errors.push(String(e.message)));
    await B.goto(PC); await sleep(2000);                 // B has loaded the same stored state as A
    const cell = (p, n) => p.locator('.gr .tr').nth(n);
    await cell(A, 0).click(); await A.keyboard.type('A-перший'); await A.keyboard.press('Enter'); await sleep(1500);
    await cell(B, 2).click(); await B.keyboard.type('B-третій'); await B.keyboard.press('Enter'); await sleep(2500);
    const stored = (await A.evaluate(readAll)).project ?? '';
    check('two tabs: the first tab\'s text is still stored after the second saved', stored.includes('A-перший'));
    check('two tabs: the second tab\'s text is stored too', stored.includes('B-третій'));
    await A.reload(); await sleep(2000);
    const rows = await A.locator('.gr .tr').evaluateAll(r => r.map(x => x.innerText));
    check('two tabs: after a reload both texts are shown', rows.some(t => t.includes('A-перший')) && rows.some(t => t.includes('B-третій')), JSON.stringify(rows));
    check('two tabs: no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
