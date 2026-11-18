// Browser regression check: the top of a tool window (the header and the search with its buttons) is a fill that fades into the dark body,
// not a lighter strip with a hard edge: the header has no fill or line of its own, a gradient layer lies at the top of the window.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s36-fade.cjs
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
    const game = await root.getDirectoryHandle('fade-game', { create: true });
    const data = await game.getDirectoryHandle('data', { create: true });
    for (const [n, t] of [['Map001.json', a], ['Map002.json', b]]) { const w = await (await data.getFileHandle(n, { create: true })).createWritable(); await w.write(t); await w.close(); }
    window.showDirectoryPicker = async () => root.getDirectoryHandle('fade-game');
  }, { a: JSON.stringify(mapOf('Town', 20)), b: JSON.stringify(mapOf('Forest', 8)) });
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1500);
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  const open = async lp => { await page.locator(`.strip [data-lp="${lp}"]`).click(); await sleep(350); };
  if (!(await page.locator('#tree').isVisible())) await open('files');
  if (!(await page.locator('#lp-rows').isVisible())) await open('rows');
  await page.locator('#tree .node[data-file="Map001.json"]').click(); await sleep(600);

  const st = await page.evaluate(() => {
    const g = (sel, pseudo) => { const e = document.querySelector(sel); if (!e) return null; const c = getComputedStyle(e, pseudo); return { img: c.backgroundImage, bg: c.backgroundColor, bb: c.borderBottomWidth, h: c.height, pe: c.pointerEvents }; };
    return { rowsHead: g('[data-card="rows"]'), filesHead: g('[data-card="files"]'), rows: g('#lp-rows', '::before'), files: g('#tree', '::before'), rowsRect: (() => { const r = document.querySelector('#lp-rows').getBoundingClientRect(); return [r.top, r.height]; })() };
  });
  const grad = s => !!s && /linear-gradient/.test(s.img);
  check('the header of the rows window has no fill and no line of its own', st.rowsHead.bg === 'rgba(0, 0, 0, 0)' && st.rowsHead.bb === '0px', JSON.stringify(st.rowsHead));
  check('the header of the files window has none either', st.filesHead.bg === 'rgba(0, 0, 0, 0)' && st.filesHead.bb === '0px', JSON.stringify(st.filesHead));
  check('a gradient lies at the top of the rows window, over the header and the search', grad(st.rows) && /transparent|rgba\(\d+, \d+, \d+, 0\)/.test(st.rows.img) && parseInt(st.rows.h) >= 90, JSON.stringify(st.rows));
  check('and at the top of the files window', grad(st.files), JSON.stringify(st.files));
  check('the gradient does not catch the pointer', st.rows.pe === 'none' && st.files.pe === 'none');
  // the controls under the fade still work
  await page.locator('#q2').fill('line 3'); await sleep(400);
  check('the search under the fade works', (await page.locator('#slist .si').count()) >= 1);
  await page.locator('#q2').fill('');
  check('no page errors', errors.length === 0, errors.join(' | '));
  if (process.env.SHOT_DIR) await page.screenshot({ path: process.env.SHOT_DIR + '/s36-fade.png' });
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
