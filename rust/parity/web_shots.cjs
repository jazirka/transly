// Знімки веб-версії для порівняння з нативом (matриця екранів). Запуск з теки app (потрібен playwright): FIX=<тека з make_fixture> OUT=<тека знімків> PC_URL... node ../rust/parity/web_shots.cjs; веб має працювати на http://localhost:4301/ (npx vite preview).
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const FIX = process.env.FIX, OUT = process.env.OUT;
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
    window.showDirectoryPicker = async () => root.getDirectoryHandle('ParityGame');
    await new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects'], 'readwrite'); tx.objectStore('projects').put(proj, 'default'); tx.oncomplete = () => res(); }; o.onerror = () => rej(o.error); });
  }, { files, proj });
  await page.reload(); await sleep(900);
  await page.evaluate(async () => { const root = await navigator.storage.getDirectory(); window.showDirectoryPicker = async () => root.getDirectoryHandle('ParityGame'); });
  await page.locator('button:visible', { hasText: 'Відкрити папку гри' }).last().click(); await sleep(1800);
  const shot = async n => { await sleep(350); await page.screenshot({ path: path.join(OUT, n + '.png') }); console.log('shot', n); };
  const click = async sel => { await page.locator(sel).first().click(); await sleep(250); };
  await shot('01-table-nosel');
  await page.locator('#grid .gr').nth(1).click(); await sleep(300); await shot('02-table-row');
  await page.locator('#tree-list .node:has-text("Enemies")').click(); await sleep(400); await shot('03-table-enemies');
  await page.locator('#grid .gr').nth(2).locator('.cb, input[type=checkbox], .ln').first().click({ modifiers: ['Control'] }).catch(() => {}); await sleep(250); await shot('04-table-checked');
  await click('[data-m="edit"]'); await sleep(500); await shot('05-edit');
  await click('#strip [data-lp="scenes"]'); await sleep(400); await shot('06-edit-scenes');
  await click('#strip [data-lp="glossary"]'); await sleep(400); await shot('07-edit-related');
  await click('#stabs [data-p="act"]'); await sleep(300); await shot('08-right-activity');
  await click('#stabs [data-p="cm"]'); await sleep(300); await shot('09-right-comments');
  await page.locator('#tree-list .node:has-text("Town")').click().catch(() => {}); await sleep(300);
  await click('[data-m="scene"]'); await sleep(600); await shot('10-scene');
  await click('[data-m="table"]'); await sleep(400);
  await click('#hamb'); await sleep(300); await shot('11-main-menu'); await page.keyboard.press('Escape');
  await click('#proj-btn'); await sleep(300); await shot('12-project-menu'); await page.keyboard.press('Escape');
  await click('#br-btn'); await sleep(300); await shot('13-branch-menu'); await page.keyboard.press('Escape');
  await click('#cfg-btn'); await sleep(300); await shot('14-run-menu'); await page.keyboard.press('Escape');
  await b.close();
})();
