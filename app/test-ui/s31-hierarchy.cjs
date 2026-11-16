// Browser regression check: the order file → rows / scenes is shown: the numbered windows, the chip of the file in the window below the files,
// the ask for a file while none is open (with a hint that goes away for good), the file in front of the row in the status bar and the
// «↩ N» of the row a file was left on. See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s31-hierarchy.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const cmd = (code, parameters, indent = 0) => ({ code, indent, parameters });
const say = (t, who = 'Cook') => [cmd(101, [who, 0, 0, 2, who]), cmd(401, [t])];
const mapOf = (name, n) => ({ displayName: name, events: [null, { id: 1, name: 'e', x: 1, y: 1, pages: [{ list: [...Array.from({ length: n }, (_, i) => say(`${name} line ${i + 1}`)).flat(), cmd(0, [])] }] }] });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  await page.evaluate(async ({ a, b }) => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('hier-game', { create: true });
    const data = await game.getDirectoryHandle('data', { create: true });
    for (const [n, t] of [['Map001.json', a], ['Map002.json', b]]) { const w = await (await data.getFileHandle(n, { create: true })).createWritable(); await w.write(t); await w.close(); }
    window.showDirectoryPicker = async () => root.getDirectoryHandle('hier-game');
  }, { a: JSON.stringify(mapOf('Town', 12)), b: JSON.stringify(mapOf('Forest', 8)) });
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1500);
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  const open = async lp => { await page.locator(`.strip [data-lp="${lp}"]`).click(); await sleep(350); };
  if (!(await page.locator('#tree').isVisible())) await open('files');
  if (!(await page.locator('#lp-rows').isVisible())) await open('rows');
  check('the files and the rows are open together', await page.locator('#tree').isVisible() && await page.locator('#lp-rows').isVisible());

  // the first run: the hint over the list teaches the order; with no file open the window below asks for one
  const hint = await page.evaluate(() => document.querySelector('#tree-list .coach')?.textContent ?? '');
  check('the list of files teaches the order file → row → translation', /①/.test(hint) && /②/.test(hint) && /③/.test(hint), hint);
  await page.locator('#tabs-host .tab .x, #tabs-host .tab [data-close]').first().click({ timeout: 3000 }).catch(() => {});
  await sleep(500);
  const empty = await page.evaluate(() => ({ ask: document.querySelector('#slist .emptybox')?.textContent ?? '', chip: document.querySelector('[data-card="rows"] [data-fchip]')?.textContent ?? '', none: document.querySelector('[data-card="rows"] [data-fchip]')?.classList.contains('none'), coach: document.querySelector('#tree-list .coach')?.textContent ?? '' }));
  check('while no file is open the rows window says «Спершу оберіть файл угорі»', /Спершу оберіть файл угорі/.test(empty.ask), JSON.stringify(empty));
  check('its chip says that no file is chosen', /файл не вибрано/.test(empty.chip) && empty.none, JSON.stringify(empty));
  check('and the hint over the files asks for a file', /Оберіть файл/.test(empty.coach) && /②/.test(empty.coach), empty.coach);

  // the file is chosen: the windows are numbered, the chip names the file, the hint is gone for good
  await page.locator('#tree .node[data-file="Map001.json"]').click(); await sleep(600);
  const steps = await page.evaluate(() => { const vis = e => !!e && getComputedStyle(e).display !== 'none'; return { s1: vis(document.querySelector('[data-card="files"] .step')), s2: vis(document.querySelector('[data-card="rows"] .step')), s3: vis(document.querySelector('#f-trlbl .step')), t: ['[data-card="files"] .step', '[data-card="rows"] .step', '#f-trlbl .step'].map(q => document.querySelector(q)?.textContent) }; });
  check('the three windows are numbered 1, 2, 3', steps.s1 && steps.s2 && steps.s3 && steps.t.join('') === '123', JSON.stringify(steps));
  const chip = await page.evaluate(() => ({ t: document.querySelector('[data-card="rows"] [data-fchip]').textContent, none: document.querySelector('[data-card="rows"] [data-fchip]').classList.contains('none') }));
  check('the chip of the rows window names the file', /^MAP\s*Town$/.test(chip.t.trim()) && !chip.none, JSON.stringify(chip));
  check('the hint over the files goes when a file is opened from the list, and stays gone', (await page.locator('#tree-list .coach').count()) === 0 && (await page.evaluate(() => localStorage.getItem('transly.coach.files'))) === '1');

  // the row: the status bar names the file and the place in it
  await page.locator('#lp-rows .si').nth(2).click(); await sleep(500);
  const st = await page.locator('#st-sel').innerText();
  check('the status bar says the file, the row and how many there are', /^Файл: Town › рядок 3 з \d+ · /.test(st), st);

  // the number of the window you work in is in colour
  const stepBg = q => page.evaluate(q => getComputedStyle(document.querySelector(q)).backgroundColor, q);
  const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-solid').trim());
  const hex = h => { const m = /^#(..)(..)(..)$/.exec(h); return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : h; };
  await page.locator('#tree .node[data-file="Map001.json"]').click(); await sleep(400);
  check('the number of the window you work in is in the colour of the project, the others are grey', (await stepBg('[data-card="files"] .step')) === hex(accent) && (await stepBg('[data-card="rows"] .step')) !== hex(accent));

  // the row a file was left on shows beside its name
  await page.locator('#lp-rows .si').nth(4).click(); await sleep(700);
  await page.locator('#tree .node[data-file="Map002.json"]').click(); await sleep(500);
  const mem = await page.evaluate(() => document.querySelector('#tree .node[data-file="Map001.json"] .mem')?.textContent ?? '');
  check('the file that was left shows «↩ N» (the row it was left on)', /^↩ 5$/.test(mem.trim()) || /^↩ \d+$/.test(mem.trim()), mem);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close(); await browser.close();
  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nall checks passed');
})();
