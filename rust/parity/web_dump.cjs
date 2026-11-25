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
  await page.reload(); await sleep(900);
  await page.evaluate(async () => { const root = await navigator.storage.getDirectory(); window.showDirectoryPicker = async () => root.getDirectoryHandle('ParityGame'); });
  await page.locator('button:visible', { hasText: 'Відкрити папку гри' }).last().click(); await sleep(1800);
  await page.locator('#grid .gr').nth(1).click(); await sleep(300);
  const res = await page.evaluate(sel => {
    const P = ['font-family','font-size','font-weight','line-height','color','background-color','background-image','border-top-width','border-top-color','border-bottom-width','border-bottom-color','border-radius','padding','margin','gap','height','width','opacity','letter-spacing','text-transform'];
    const out = {};
    for (const [name, q] of Object.entries(sel)) {
      const e = document.querySelector(q); if (!e) { out[name] = null; continue; }
      const c = getComputedStyle(e), r = e.getBoundingClientRect(); const o = { rect: [Math.round(r.left * 10) / 10, Math.round(r.top * 10) / 10, Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10] };
      for (const p of P) { const v = c.getPropertyValue(p); if (v && v !== 'none' && v !== 'normal' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)' && v !== 'auto') o[p] = v; }
      out[name] = o;
    }
    return out;
  }, SEL);
  fs.writeFileSync(OUT, JSON.stringify(res, null, 1)); console.log('written', OUT, Object.values(res).filter(x => x === null).length, 'missing');
  await b.close();
})();
