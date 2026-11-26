const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FIX = process.env.FIX, OUT = process.env.OUT;
const SEL = JSON.parse(process.env.SEL);
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
  // LS='{"transly.rtab":"act,rel,cm"}' — значення localStorage перед перезавантаженням (напр. усі три вкладки правої панелі)
  if (process.env.LS) await page.evaluate(o => { for (const [k, v] of Object.entries(o)) localStorage.setItem(k, v); }, JSON.parse(process.env.LS));
  await page.reload(); await sleep(900);
  await page.evaluate(async () => { const root = await navigator.storage.getDirectory(); window.showDirectoryPicker = async () => root.getDirectoryHandle('ParityGame'); });
  await page.locator('button:visible', { hasText: 'Відкрити папку гри' }).last().click(); await sleep(1800);
  // MODE: без нього — таблиця (рядок 2 файлу за замовчуванням); edit — «Редагування»; scene — «Сцена» (файл Town)
  if (process.env.MODE && !['hist', 'gloss', 'glossform', 'scenes'].includes(process.env.MODE)) {
    await page.locator('#tree-list .node:has-text("Enemies")').click(); await sleep(400);
    await page.locator('#grid .gr').nth(0).click(); await sleep(300);
  } else { await page.locator('#grid .gr').nth(1).click(); await sleep(300); }
  if (process.env.MODE === 'edit') { await page.locator('[data-m="edit"]').click(); await sleep(600); }
  // scenes — «Редагування», ліва панель «Сцени» (файл Town)
  if (process.env.MODE === 'scenes') {
    await page.locator('#tree-list .node:has-text("Town")').click(); await sleep(300);
    await page.locator('#grid .gr').nth(0).click(); await sleep(300);
    await page.locator('[data-m="edit"]').click(); await sleep(500);
    await page.locator('#strip [data-lp="scenes"]').click(); await sleep(500);
  }
  // gloss — ліва панель «Пов’язане» (глосарій); glossform — те саме з відкритою формою «＋ Додати»
  if (process.env.MODE === 'gloss' || process.env.MODE === 'glossform') {
    await page.locator('#strip [data-lp="glossary"]').click(); await sleep(500);
    if (process.env.MODE === 'glossform') { await page.locator('#gl-new').click(); await sleep(400); }
  }
  // hist — «Редагування» з двома надісланими версіями (щоб у «Активності» були записи й дата-розділювач)
  if (process.env.MODE === 'hist') {
    await page.locator('#grid .gr').nth(1).click(); await sleep(300);
    await page.locator('[data-m="edit"]').click(); await sleep(600);
    // надсилання переходить до наступного рядка — після кожного повертаємось на той самий у списку рядків
    for (const t of ['Селянин, перша версія', 'Селянин, друга версія тексту']) {
      await page.locator('#i-tr').fill(t); await page.locator('#b-save').click(); await sleep(500);
      await page.locator('#slist .si').nth(1).click(); await sleep(400);
    }
  }
  if (process.env.MODE === 'scene') { await page.locator('#tree-list .node:has-text("Town")').click(); await sleep(300); await page.locator('[data-m="scene"]').click(); await sleep(600); }
  // PANE=files|rows|centre|right — клік у вікно перед знімком, щоб увімкнути відповідне «робоче вікно» (html[data-pane])
  if (process.env.PANE) {
    const clickAt = { files: '#tree', rows: '#lp-rows', centre: '#main', right: '.fs' }[process.env.PANE];
    const box = await page.locator(clickAt).first().boundingBox(); await page.mouse.click(box.x + box.width / 2, box.y + box.height - 40); await sleep(300);
    console.log('data-pane =', await page.evaluate(() => document.documentElement.dataset.pane));
  }
  const res = await page.evaluate(sel => {
    const P = ['overflow-y','scrollbar-gutter','box-sizing','margin-right','font-family','font-size','font-weight','line-height','color','background-color','background-image','border-top-width','border-top-color','border-bottom-width','border-bottom-color','border-radius','padding','margin','gap','height','width','opacity','letter-spacing','text-transform'];
    const out = {};
    for (const [name, q] of Object.entries(sel)) {
      const e = document.querySelector(q); if (!e) { out[name] = null; continue; }
      const c = getComputedStyle(e), r = e.getBoundingClientRect(); const o = { rect: [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10] };
      for (const p of P) { const v = c.getPropertyValue(p); if (v && v !== 'none' && v !== 'normal' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)' && v !== 'auto') o[p] = v; }
      out[name] = o;
    }
    return out;
  }, SEL);
  if (process.env.KIDS) {
    const kids = await page.evaluate(qs => qs.map(q => { const e = document.querySelector(q); if (!e) return [q, null];
      return [q, [...e.children].map(k => { const r = k.getBoundingClientRect(), c = getComputedStyle(k);
        return [k.tagName.toLowerCase() + (k.id ? '#' + k.id : '') + (k.className && typeof k.className === 'string' ? '.' + k.className.trim().split(/\s+/).join('.') : ''),
          [r.left, r.top, r.width, r.height].map(v => Math.round(v * 10) / 10).join(','), c.fontSize, c.color, c.backgroundColor, c.display, (k.textContent || '').trim().slice(0, 28)].join(' | '); })]; }), JSON.parse(process.env.KIDS));
    for (const [q, l] of kids) { console.log('==', q); (l || ['-']).forEach(x => console.log('  ', x)); }
  }
  fs.writeFileSync(OUT, JSON.stringify(res, null, 1)); console.log('written', OUT, Object.values(res).filter(x => x === null).length, 'missing');
  await b.close();
})();
