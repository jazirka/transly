// Browser regression check: the files and the scenes open together in the left zone the way the files and the rows do
// (the files above, the scenes below), and the buttons of the rail switch each window on and off. See s0-safety.cjs for how to run:
//   PC_URL=http://localhost:4285/ node test-ui/s28-files-scenes.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const cmd = (code, parameters, indent = 0) => ({ code, indent, parameters });
const say = (t, who = 'Cook') => [cmd(101, [who, 0, 0, 2, who]), cmd(401, [t])];
const MAP = { displayName: 'Town', events: [null, { id: 1, name: 'cook', x: 1, y: 1, pages: [{ list: [...say('Take your hat off.'), ...say('Hello there.'), cmd(0, [])] }] }] };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  await page.evaluate(async text => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('fs-game', { create: true });
    const data = await game.getDirectoryHandle('data', { create: true });
    const w = await (await data.getFileHandle('Map001.json', { create: true })).createWritable();
    await w.write(text); await w.close();
    window.showDirectoryPicker = async () => root.getDirectoryHandle('fs-game');
  }, JSON.stringify(MAP));
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1500);
  await page.locator('[data-m="table"]').click(); await sleep(500);
  await page.locator('#tree .node[data-file]').first().click(); await sleep(400);

  const vis = id => page.locator(id).isVisible();
  const on = () => page.evaluate(() => [...document.querySelectorAll('#strip button[data-lp].on')].map(b => b.dataset.lp).join(','));
  const title = () => page.locator('#lp-title').innerText();
  const rail = lp => page.locator(`#strip [data-lp="${lp}"]`).click().then(() => sleep(350));

  check('to begin with only the files are open', (await vis('#tree')) && !(await vis('#lp-sc')) && !(await vis('#lp-rows')) && (await on()) === 'files', await on());
  // the rows and the scenes belong to the editing mode: the table is the rows already (its rail has only the files and the related window)
  check('in the table the rail has no «Рядки» and no «Сцени»', !(await page.locator('#strip [data-lp="rows"]').isVisible()) && !(await page.locator('#strip [data-lp="scenes"]').isVisible()));
  await page.locator('[data-m="edit"]').click(); await sleep(450);
  await rail('rows'); await rail('files');
  await rail('scenes');
  check('«Сцени» opens under the files, not instead of them', (await vis('#tree')) && (await vis('#lp-sc')) && !(await vis('#lp-rows')), `${await vis('#tree')} ${await vis('#lp-sc')}`);
  check('both buttons of the rail are on, and the title says so', (await on()) === 'files,scenes' && /Файли й сцени/.test(await title()), `${await on()} | ${await title()}`);
  const hs = await page.evaluate(() => { const a = document.querySelector('#tree').getBoundingClientRect(), b = document.querySelector('#lp-sc').getBoundingClientRect(); return { a: Math.round(a.height), b: Math.round(b.height), top: Math.round(b.y - a.y) }; });
  check('they share the zone: the files above, the scenes below, about half each', hs.top > 0 && Math.abs(hs.a - hs.b) < 120, JSON.stringify(hs));
  await rail('rows');
  check('the rows button swaps the second window: the rows are below the files, the scenes are gone', (await vis('#tree')) && (await vis('#lp-rows')) && !(await vis('#lp-sc')) && (await on()) === 'files,rows', await on());
  await rail('scenes');
  check('and the scenes button swaps it back', (await vis('#lp-sc')) && !(await vis('#lp-rows')) && (await on()) === 'files,scenes', await on());
  await rail('files');
  check('the files button closes the files and keeps the scenes alone', !(await vis('#tree')) && (await vis('#lp-sc')) && (await on()) === 'scenes', await on());
  await rail('files');
  check('and brings the files back above them', (await vis('#tree')) && (await vis('#lp-sc')) && (await on()) === 'files,scenes', await on());
  await page.locator('[data-hide-left="scenes"]').first().click({ force: true }); await sleep(350);
  check('the cross of the scenes window hides only it: the files stay', (await vis('#tree')) && !(await vis('#lp-sc')) && (await on()) === 'files', await on());
  await rail('rows');
  check('the files and the rows work as before', (await vis('#tree')) && (await vis('#lp-rows')) && (await on()) === 'files,rows', await on());
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
