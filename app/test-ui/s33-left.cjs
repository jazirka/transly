// Browser regression check: the left column. The numbers of the windows are always in their place; the searches are alike, with no divider
// under them; the groups have no title and their actions are in the menu ⋮ of the files; the highlight of the tree is rounded and inside the inset;
// picked files in a row share one outline with nothing drawn between them. See s0-safety.cjs:   PC_URL=http://localhost:4285/ node test-ui/s33-left.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const FILES = { Actors: ['Harold', 'Therese'], Armors: ['Cloth', 'Shield'], Classes: ['Fighter', 'Mage'], Enemies: ['Slime', 'Bat'], Items: ['Potion', 'Ether'], Skills: ['Fire', 'Ice'] };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  await page.evaluate(async ({ files }) => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('left-game', { create: true });
    const data = await game.getDirectoryHandle('data', { create: true });
    for (const [n, list] of Object.entries(files)) { const w = await (await data.getFileHandle(n + '.json', { create: true })).createWritable(); await w.write(JSON.stringify([null, ...list.map((x, i) => ({ id: i + 1, name: x, description: x + ' description', note: '' }))])); await w.close(); }
    window.showDirectoryPicker = async () => root.getDirectoryHandle('left-game');
  }, { files: FILES });
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1500);
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  if (!(await page.locator('#tree').isVisible())) await page.locator('.strip [data-lp="files"]').click();
  if (!(await page.locator('#lp-rows').isVisible())) { await page.locator('.strip [data-lp="rows"]').click(); await sleep(300); }
  await page.locator('[data-coach-ok]').click().catch(() => {}); await sleep(200);

  // the windows are a path: the file › the rows, with no numbers
  const heads = await page.evaluate(() => ({ steps: document.querySelectorAll('.step').length, rows: document.querySelector('[data-card="rows"] .grow')?.textContent.replace(/\s+/g, ' ').trim() }));
  check('no numbered badges; the rows window says «Рядки» and the file', heads.steps === 0 && /^Рядки /.test(heads.rows), JSON.stringify(heads));

  // the searches are alike: each is a field in the header of its window (it replaces the title when opened); nothing is drawn under them
  check('the search of the files is in the header of its window, not under it', await page.evaluate(() => !!document.querySelector('[data-card="files"] #fq') && !document.querySelector('.tree-q')));
  check('the search of the rows is in the header of its window, not under it', await page.evaluate(() => !!document.querySelector('[data-card="rows"] #q2') && !document.querySelector('#lp-rows .fh #q2')));
  check('and no divider between the groups and the tree', await page.evaluate(() => getComputedStyle(document.querySelector('#tree-groups')).borderBottomWidth === '0px'));

  // the groups: no title; everything about them (all the files together, a new group, the picked files) is in the menu ⋮ of the files, not in a row of buttons
  check('the groups have no title of their own', (await page.locator('#tree-groups .grp-head, #tree-groups .grp-title').count()) === 0);
  check('no row of buttons under the header of the files', (await page.locator('#tree-act').count()) === 0 && (await page.locator('#gr-add').count()) === 0);
  await page.locator('#fs-menu').click(); await sleep(200);
  const menu = await page.locator('#fpop').innerText();
  check('the menu ⋮ holds «Усі файли разом» and «+ Нова група…»', /Усі файли разом/.test(menu) && /Нова група/.test(menu), menu.replace(/\s+/g, ' '));
  await page.locator('#fpop [data-wm="files:newgroup"]').click(); await sleep(250);
  check('and «+ Нова група…» opens the field of a new group', await page.locator('#gr-name').isVisible());
  await page.locator('#gr-name').fill('Магазин'); await page.keyboard.press('Enter'); await sleep(300);
  check('the new group is a row', (await page.locator('#tree-groups .grp-item').count()) === 1);

  // the tree: the same inset on both sides; a file under the icon of its folder
  const inset = await page.evaluate(() => { const l = document.querySelector('#tree-list'), r = l.getBoundingClientRect(), f = l.querySelector('.node[data-file]'), fr = f.getBoundingClientRect(), d = l.querySelector('.node.dir'), dr = d.getBoundingClientRect(); const ic = f.querySelector('.ic').getBoundingClientRect(), di = d.querySelector('.ic')?.getBoundingClientRect(); return { left: Math.round(fr.left - r.left), right: Math.round(r.right - fr.right), iconDx: di ? Math.round(ic.left - di.left) : null }; });
  check('the highlight stays inside the inset, the same on both sides', inset.left === inset.right && inset.left >= 5, JSON.stringify(inset));
  check('a file stands under the icon of its folder, not far to the right of it', inset.iconDx === null || Math.abs(inset.iconDx) <= 20, JSON.stringify(inset));

  // picked files: one outline, nothing between them
  for (const f of ['Classes.json', 'Enemies.json', 'Items.json']) await page.locator(`#tree .node[data-file="${f}"]`).click({ modifiers: ['Control'] });
  await sleep(300); await page.mouse.move(900, 700);
  const picks = await page.$$eval('#tree .node.pick', ns => ns.map(n => { const c = getComputedStyle(n); return { f: n.dataset.file, cls: [...n.classList].filter(x => x.startsWith('pk-')).join(' '), r: c.borderRadius, sh: c.boxShadow }; }));
  const run = picks.filter(p => ['Classes.json', 'Enemies.json', 'Items.json'].includes(p.f));
  check('three picked files in a row: the first is the top of the run, the last the bottom', run.length === 3 && run[0].cls === 'pk-top' && run[1].cls === '' && run[2].cls === 'pk-bot', JSON.stringify(run));
  check('their corners are rounded only at the ends of the run', /^8px 8px 0px 0px$/.test(run[0].r) && run[1].r === '0px' && /^0px 0px 8px 8px$/.test(run[2].r), JSON.stringify(run.map(p => p.r)));
  // the middle one has a line on its two sides only, none above or below (a line between the picked files)
  const lines = s => [...s.matchAll(/(-?\d+px) (-?\d+px) 0px 0px inset/g)].map(m => `${m[1]} ${m[2]}`);
  const mid = lines(run[1].sh), top = lines(run[0].sh), bot = lines(run[2].sh);
  check('no line is drawn between the picked files', mid.length > 0 && mid.every(l => /^-?1px 0px$/.test(l)) && top.includes('0px 1px') && !top.includes('0px -1px') && bot.includes('0px -1px') && !bot.includes('0px 1px'), JSON.stringify([mid, top, bot]));
  const pickBg = await page.evaluate(() => getComputedStyle(document.querySelector('#tree .node.pick')).backgroundColor);
  check('picked files are filled (the colour of the project while you work in the files)', /rgba?\(/.test(pickBg) && pickBg !== 'rgba(0, 0, 0, 0)', pickBg);
  // the choice in the rows has the shape of the choice in the files: rounded, inset by the same distance, no divider
  await page.locator('#lp-rows .si').first().click(); await sleep(300);
  const shape = await page.evaluate(() => { const r = document.querySelector('#lp-rows .si.sel'), t = document.querySelector('#tree .node.cur'); if (!r || !t) return null; const c = getComputedStyle(r), l = document.querySelector('#slist').getBoundingClientRect(), rr = r.getBoundingClientRect(), tl = document.querySelector('#tree-list').getBoundingClientRect(), tr = t.getBoundingClientRect(); return { rad: c.borderTopLeftRadius, bb: c.borderBottomWidth, insetRows: Math.round(rr.left - l.left), insetFiles: Math.round(tr.left - tl.left), radFiles: getComputedStyle(t).borderTopLeftRadius }; });
  check('the chosen row is rounded and inset like the chosen file, with no divider under it', !!shape && shape.rad === shape.radFiles && shape.bb === '0px' && shape.insetRows === shape.insetFiles, JSON.stringify(shape));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close(); await browser.close();
  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nall checks passed');
})();
