// Знімає вікна налаштувань веб-версії (загальні й проєкту): кожну сторінку дерева — знімок, прямокутники й computed style будови.
// FIX=/tmp/parity/fixture OUT=/tmp/parity/websettings node ../rust/parity/web_settings.cjs  (з app/, збірка на :4301)
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
  const dump = () => page.evaluate(() => {
    const d = document.querySelector('dialog[open]'); if (!d) return null;
    const R = e => { const q = e.getBoundingClientRect(); return [q.left, q.top, q.width, q.height].map(v => Math.round(v * 10) / 10).join(','); };
    const C = (e, ps) => { const c = getComputedStyle(e); return ps.map(p => p + ':' + c.getPropertyValue(p)).join(' '); };
    const out = { dlg: R(d) };
    const q = (sel, ps) => { const e = d.querySelector(sel); return e ? R(e) + ' ' + C(e, ps || ['font-size', 'font-weight', 'color', 'background-color', 'padding', 'margin', 'gap', 'border-radius']) : null; };
    out.nav = q('.st-nav'); out.srch = q('.st-srch'); out.tree = q('.st-tree'); out.grp = q('.st-grp'); out.gl = q('.st-gl'); out.ti = q('.st-ti'); out.cur = q('.st-ti[aria-current=page]');
    out.main = q('.st-main'); out.crumb = q('.st-crumb'); out.content = q('.st-content'); out.bar = q('.st-bar'); out.dirty = q('.st-dirty');
    out.btns = [...d.querySelectorAll('.st-bar .btn')].map(e => R(e) + ' ' + e.textContent.trim());
    out.items = [...d.querySelectorAll('.st-ti, .st-grp, .st-gl')].map(e => R(e) + ' ' + e.className + ' ' + e.textContent.trim());
    const page = [...d.querySelectorAll('.st-page')].find(p => !p.hidden);
    out.page = page ? [...page.children].map(k => k.tagName.toLowerCase() + (k.className ? '.' + String(k.className).trim().split(/\s+/).join('.') : '') + ' [' + R(k) + '] ' + (k.textContent || '').trim().slice(0, 60)) : null;
    out.pagecss = page ? C(page, ['gap', 'padding']) : null;
    return out;
  });
  const walk = async (tag, label) => {
    const ids = await page.locator('dialog[open] .st-ti').evaluateAll(es => es.map(e => [e.dataset.p, e.textContent.trim()]));
    for (const [id, t] of ids) {
      await page.locator(`dialog[open] .st-ti[data-p="${id}"]`).click(); await sleep(350);
      const d = await dump(); console.log('PAGE', tag, id, t); console.log(JSON.stringify(d, null, 1));
      await page.screenshot({ path: path.join(OUT, `${tag}-${id}.png`) });
    }
  };
  // загальні налаштування: Файл → Налаштування…
  await page.locator('#hamb').click().catch(() => {}); await sleep(250);
  await page.locator('#menubar [data-mg="Файл"]').click(); await sleep(200);
  await page.locator('#mdd').getByText('Налаштування…').first().click(); await sleep(600);
  await walk('app');
  await page.keyboard.press('Escape'); await sleep(400);
  // налаштування проєкту: кнопка проєкту
  await page.locator('#proj-btn').click(); await sleep(300);
  console.log('PROJMENU', (await page.locator('#proj-menu, .pop:visible, #mdd:visible').allInnerTexts()).join('|').slice(0, 300));
  await page.locator('.pop:visible, #mdd:visible').getByText('Налаштування проєкту').first().click().catch(e => console.log('noitem', e.message)); await sleep(600);
  await walk('proj');
  await b.close();
})();
