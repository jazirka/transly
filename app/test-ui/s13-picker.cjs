// Browser regression check: a game folder opened through window.showDirectoryPicker (Chrome, Edge: the normal way on the web)
// with a NATIVE directory handle (the browser's private file system stands in for a real folder). See s0-safety.cjs for how to run:
//   PC_URL=http://localhost:4285/ node test-ui/s13-picker.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const msg = text => [{ code: 101, indent: 0, parameters: ['', 0, 0, 2] }, { code: 401, indent: 0, parameters: [text] }];
const mapOf = lines => ({ displayName: 'T', events: [null, { id: 1, name: 'EV001', x: 0, y: 0, pages: [{ list: [...lines.flatMap(msg), { code: 0, indent: 0, parameters: [] }] }] }] });
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  // a real folder tree: game/data/Map001.json, and the native picker returns its handle
  await page.evaluate(async text => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('picker-game', { create: true });
    const data = await game.getDirectoryHandle('data', { create: true });
    const w = await (await data.getFileHandle('Map001.json', { create: true })).createWritable();
    await w.write(text); await w.close();
    window.showDirectoryPicker = async () => root.getDirectoryHandle('picker-game');
  }, JSON.stringify(mapOf(['The road north', 'Farewell'])));
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1800);
  const rows = await page.locator('.gr').evaluateAll(r => r.map(x => x.innerText.replace(/\s+/g, ' ')));
  check('a folder picked through the native picker opens with its rows', rows.some(r => /The road north/.test(r)) && rows.some(r => /Farewell/.test(r)), JSON.stringify(rows).slice(0, 160));
  const toasts = await page.locator('.toast').allInnerTexts();
  check('and no «no text to translate» message', !toasts.some(t => /немає тексту для перекладу/.test(t)), JSON.stringify(toasts));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
