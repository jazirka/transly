// Знімає всі діалоги веб-версії: відкриває кожен пункт меню, що відкриває <dialog>, і друкує розмір, шапку, будову й computed style.
// FIX=/tmp/parity/fixture OUT=/tmp/parity/webdlg node ../rust/parity/web_dialogs.cjs  (запускати з app/, збірка на :4301)
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FIX = process.env.FIX, OUT = process.env.OUT; fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const files = {}; for (const f of fs.readdirSync(path.join(FIX, 'ParityGame/data'))) files[f] = fs.readFileSync(path.join(FIX, 'ParityGame/data', f), 'utf8');
  const proj = fs.readFileSync(path.join(FIX, 'project.json'), 'utf8');
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await b.newContext({ viewport: { width: 1360, height: 800 }, deviceScaleFactor: 1 })).newPage();
  await page.goto('http://localhost:4301/'); await sleep(700);
  await page.evaluate(async ({ files, proj }) => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('ParityGame', { create: true }); const data = await game.getDirectoryHandle('data', { create: true });
    for (const [n, t] of Object.entries(files)) { const w = await (await data.getFileHandle(n, { create: true })).createWritable(); await w.write(t); await w.close(); }
    await new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const tx = o.result.transaction(['projects'], 'readwrite'); tx.objectStore('projects').put(proj, 'default'); tx.oncomplete = () => res(); }; o.onerror = () => rej(o.error); });
  }, { files, proj });
  await page.reload(); await sleep(900);
  await page.evaluate(async () => { const root = await navigator.storage.getDirectory(); window.showDirectoryPicker = async () => root.getDirectoryHandle('ParityGame'); });
  await page.locator('button:visible', { hasText: 'Відкрити папку гри' }).last().click(); await sleep(1800);
  const info = () => page.evaluate(() => {
    const d = document.querySelector('dialog[open]'); if (!d) return null;
    const r = x => { const q = x.getBoundingClientRect(); return [q.left, q.top, q.width, q.height].map(v => Math.round(v * 10) / 10).join(','); };
    const cs = (e, ps) => { const c = getComputedStyle(e); return ps.map(p => p + ':' + c.getPropertyValue(p)).join(' '); };
    const kids = [...(d.querySelector('form') || d).children].map(k => k.tagName.toLowerCase() + (k.className ? '.' + String(k.className).trim().split(/\s+/).join('.') : '') + ' [' + r(k) + '] ' + (k.textContent || '').trim().slice(0, 40));
    return { cls: d.className, rect: r(d), css: cs(d, ['width', 'height', 'max-width', 'max-height', 'background-color', 'border-top-width', 'border-top-color', 'border-radius', 'box-shadow', 'padding', 'top', 'left']), form: cs(d.querySelector('form') || d, ['padding', 'gap', 'display', 'overflow']), h2: d.querySelector('h2') ? r(d.querySelector('h2')) + ' ' + cs(d.querySelector('h2'), ['font-size', 'font-weight', 'color', 'margin']) : null, kids };
  });
  const groups = await page.locator('#menubar [data-mg]').count().catch(() => 0);
  const open = async () => { if (!(await page.locator('#menubar').isVisible())) { await page.locator('#hamb').click().catch(() => {}); await sleep(250); } };
  await open();
  const names = await page.locator('#menubar [data-mg]').evaluateAll(es => es.map(e => e.dataset.mg));
  console.log('groups', names.join(' | '));
  const seen = new Set();
  for (const g of names) {
    await open(); await page.locator(`#menubar [data-mg="${g}"]`).click(); await sleep(200);
    const items = await page.locator('#mdd button, #mdd [role=menuitem]').evaluateAll(es => es.map(e => (e.textContent || '').trim()));
    console.log('==', g, '→', items.join(' | '));
    for (const it of items) {
      if (!it || seen.has(g + it)) continue; seen.add(g + it);
      await open(); await page.locator(`#menubar [data-mg="${g}"]`).click().catch(() => {}); await sleep(150);
      const loc = page.locator('#mdd').getByText(it, { exact: false }).first();
      if (!(await loc.isVisible().catch(() => false))) continue;
      await loc.click().catch(() => {}); await sleep(500);
      const i = await info();
      if (i) { const n = (g + '-' + it).replace(/[^\p{L}\p{N}]+/gu, '_'); console.log('DIALOG', g, '/', it); console.log(JSON.stringify(i, null, 1)); await page.screenshot({ path: path.join(OUT, n + '.png') }); await page.keyboard.press('Escape'); await sleep(300); if (await info()) { await page.keyboard.press('Escape'); await sleep(300); } }
      else { await page.keyboard.press('Escape').catch(() => {}); await sleep(150); }
    }
  }
  await b.close();
})();
