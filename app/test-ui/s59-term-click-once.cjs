// Browser regression check: a click on a term of the original puts its translation into the field once, not again when it is there.
//   PC_URL=http://localhost:4285/ node test-ui/s59-term-click-once.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const cmd = (code, parameters, indent = 0) => ({ code, indent, parameters });
const MAP = { displayName: 'Town', events: [null, { id: 1, name: 'e', x: 1, y: 1, pages: [{ list: [cmd(101, ['', 0, 0, 2, 'Levi']), cmd(401, ['Levi is here.']), cmd(0, [])] }] }] };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 860 } })).newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  await page.evaluate(async text => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('once-game', { create: true }); const data = await game.getDirectoryHandle('data', { create: true });
    const w = await (await data.getFileHandle('Map001.json', { create: true })).createWritable(); await w.write(text); await w.close();
    window.showDirectoryPicker = async () => root.getDirectoryHandle('once-game');
  }, JSON.stringify(MAP));
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1500);
  await page.locator('#strip [data-lp="glossary"]').first().click(); await sleep(300);
  await page.locator('#gl-new').click(); await sleep(150);
  await page.locator('#gl-en').fill('Levi'); await page.locator('#gl-uk').fill('Леві'); await page.locator('#gl-save').click(); await sleep(300);
  await page.locator('#grid .gr').nth(1).click(); await sleep(300);
  await page.locator('[data-m="edit"]').click(); await sleep(600);
  const term = page.locator('#f-src [data-hc="term"]').first();
  await term.click(); await sleep(300);
  const v1 = await page.locator('#i-tr').inputValue();
  await term.click(); await sleep(300);
  const v2 = await page.locator('#i-tr').inputValue();
  check('the first click writes the translation', /Леві/.test(v1), JSON.stringify(v1));
  check('the second click does not write it again', v2 === v1, JSON.stringify(v2));
  check('no page errors', errors.length === 0, errors.join('|'));
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
