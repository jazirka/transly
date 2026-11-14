// Browser regression checks: a row typed a moment before the page goes away (closed, reloaded, navigated off) is not lost.
// See s0-safety.cjs for how to run:  PC_URL=http://localhost:4285/ PHONE_URL=http://localhost:4284/ node test-ui/s10-unload.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const PHONE = process.env.PHONE_URL || 'http://localhost:4284/';
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
const stored = () => new Promise((res, rej) => {
  const o = indexedDB.open('transly', 3);
  o.onsuccess = () => { const db = o.result; const r = db.transaction('projects').objectStore('projects').get('default'); r.onsuccess = () => { db.close(); res(r.result ?? ''); }; r.onerror = () => rej(r.error); };
  o.onerror = () => rej(o.error);
});
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ---- PC: Enter, then away at once (0 / 50 / 300 ms), then back
  for (const delay of [0, 50, 300]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await page.goto(PC); await sleep(800);
    const p = project(); const { snapshot } = p; delete p.snapshot;
    await page.evaluate(put, { text: JSON.stringify(p), snapshot });
    await page.reload(); await sleep(1500);
    const text = `Набране-${delay}`;
    await page.locator('.gr .tr').nth(1).click(); await page.keyboard.type(text); await page.keyboard.press('Enter');
    await sleep(delay);
    await page.goto('about:blank');
    await page.goto(PC); await sleep(1800);
    const rows = await page.locator('.gr .tr').evaluateAll(r => r.map(x => x.innerText));
    check(`PC, away after ${delay} ms: the text is shown again`, rows.some(t => t.includes(text)), JSON.stringify(rows).slice(0, 120));
    await sleep(1200);
    check(`PC, away after ${delay} ms: and it is in the store`, (await page.evaluate(stored)).includes(text));
    check(`PC, away after ${delay} ms: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- PC: a reload with the text just typed
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(PC); await sleep(800);
    const p = project(); const { snapshot } = p; delete p.snapshot;
    await page.evaluate(put, { text: JSON.stringify(p), snapshot });
    await page.reload(); await sleep(1500);
    await page.locator('.gr .tr').nth(0).click(); await page.keyboard.type('Перед перезавантаженням'); await page.keyboard.press('Enter');
    await page.reload(); await sleep(1800);
    const rows = await page.locator('.gr .tr').evaluateAll(r => r.map(x => x.innerText));
    check('PC, reload right after typing: the text is still there', rows.some(t => t.includes('Перед перезавантаженням')));
    await ctx.close();
  }

  // ---- phone: typed, then away at once
  for (const delay of [0, 100, 300]) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await page.goto(PHONE); await sleep(800);
    const p = project(); const { snapshot } = p; delete p.snapshot;
    await page.evaluate(put, { text: JSON.stringify(p), snapshot });
    await page.reload(); await sleep(1500);
    await page.locator('.m-row').first().click({ timeout: 4000 }); await sleep(700);
    const text = `Телефон-${delay}`;
    await page.locator('#m-tr').fill(text);
    await sleep(delay);
    await page.goto('about:blank');
    await page.goto(PHONE); await sleep(1800);
    await sleep(1200);
    check(`phone, away after ${delay} ms: the text is in the store`, (await page.evaluate(stored)).includes(text));
    check(`phone, away after ${delay} ms: no page errors`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- a store that keeps failing: the browser is asked before the page closes (and the text is in the outbox)
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(PC); await sleep(800);
    const p = project(); const { snapshot } = p; delete p.snapshot;
    await page.evaluate(put, { text: JSON.stringify(p), snapshot });
    await page.reload(); await sleep(1500);
    await page.evaluate(() => { IDBObjectStore.prototype.put = function () { throw new DOMException('full', 'QuotaExceededError'); }; });
    await page.locator('.gr .tr').nth(0).click(); await page.keyboard.type('Сховище повне'); await page.keyboard.press('Enter');
    await sleep(1500);
    const asked = await page.evaluate(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented; });
    check('failing store: closing the page asks for confirmation', asked);
    const outbox = await page.evaluate(() => localStorage.getItem('transly:outbox:default') ?? '');
    check('failing store: the text waits in the outbox', outbox.includes('Сховище повне'));
    await ctx.close();
  }

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
