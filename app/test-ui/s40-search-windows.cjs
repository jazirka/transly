// Browser regression check: the files and the scenes have the header of the rows window: the title (and the file) with the menu ⋮ and «—», no field under it;
// the search is a field that takes the place of the title (the menu, or Ctrl+F while the window is the one worked in); Esc clears it and then closes it, the ✕ clears
// and closes; left empty it goes back to the title by itself, with a text in it it stays; the ring of the accent is only in the focus.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s40-search-windows.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const cmd = (code, parameters, indent = 0) => ({ code, indent, parameters });
const say = (t, who = 'Cook') => [cmd(101, [who, 0, 0, 2, who]), cmd(401, [t])];
const ev = (id, name, ...lines) => ({ id, name, x: id, y: 1, pages: [{ list: [...lines.flatMap(l => say(l)), cmd(0, [])] }] });
const MAP1 = { displayName: 'Town', events: [null, ev(1, 'cook', 'Take your hat off.'), ev(2, 'harbour', 'The ship is late.')] };
const MAP2 = { displayName: 'Cave', events: [null, ev(1, 'miner', 'Mind the dark.')] };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  await page.evaluate(async ({ a, b }) => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('fs-game', { create: true });
    const data = await game.getDirectoryHandle('data', { create: true });
    for (const [n, t] of [['Map001.json', a], ['Map002.json', b]]) { const w = await (await data.getFileHandle(n, { create: true })).createWritable(); await w.write(t); await w.close(); }
    window.showDirectoryPicker = async () => root.getDirectoryHandle('fs-game');
  }, { a: JSON.stringify(MAP1), b: JSON.stringify(MAP2) });
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1500);
  await page.locator('[data-m="table"]').click(); await sleep(500);
  await page.locator('#tree .node[data-file]').first().click(); await sleep(400);
  const files = () => page.locator('#tree-list .node[data-file]').count();
  const head = sel => page.evaluate(sel => { const h = document.querySelector(sel); return h ? { text: h.innerText.replace(/\s+/g, ' ').trim(), menu: [...h.querySelectorAll('.rs-t')].some(x => x.getClientRects().length > 0), field: [...h.querySelectorAll('.hq')].some(x => x.getClientRects().length > 0), searching: h.classList.contains('searching'), lupa: !!h.querySelector('#lp-search') && h.querySelector('#lp-search').getClientRects().length > 0 } : null; }, sel);

  // ---- the files, alone: the header of the panel carries the controls
  let h = await head('.rs-head');
  check('the header of the files says «Файли гри» and the menu ⋮ stands in it, with no field', !!h && /Файли гри/i.test(h.text) && h.menu && !h.field && !h.searching, JSON.stringify(h));
  check('there is no field under the header (the old strip is gone)', (await page.locator('.tree-q').count()) === 0 && (await page.locator('#tree > .fin').count()) === 0);
  const all = await files();
  // like the «—», the menu ⋮ is shown when the window is touched, not all the time
  await page.evaluate(() => document.activeElement && document.activeElement.blur()); await page.mouse.move(1300, 800); await sleep(300);
  check('the menu ⋮ is not drawn while the window is not touched', (await page.locator('#fs-menu').evaluate(e => getComputedStyle(e).opacity)) === '0');
  await page.locator('#tree-list').hover(); await sleep(300);
  check('and it comes when the mouse is over the window', (await page.locator('#fs-menu').evaluate(e => getComputedStyle(e).opacity)) === '1');
  await page.locator('#tree-list .node[data-file]').first().focus();
  await page.keyboard.press('Control+f'); await sleep(300);
  h = await head('.rs-head');
  check('Ctrl+F in the files opens the search in the header and the focus is in it', !!h && h.field && h.searching && (await page.evaluate(() => document.activeElement?.id)) === 'fq', JSON.stringify(h));
  check('the empty field shows its key', await page.locator('#hq-f .kbd').isVisible());
  await page.keyboard.type('Map002'); await sleep(400);
  check('the tree follows what is typed', (await files()) === 1 && all >= 2, `${await files()} of ${all}`);
  await page.keyboard.press('Escape'); await sleep(300);
  h = await head('.rs-head');
  check('the first Esc clears the text and leaves the field open', (await page.locator('#fq').inputValue()) === '' && !!h && h.field && (await files()) === all, JSON.stringify(h));
  await page.keyboard.press('Escape'); await sleep(300);
  h = await head('.rs-head');
  check('the second Esc closes the field: the title is back', !!h && !h.field && !h.searching && /Файли гри/i.test(h.text), JSON.stringify(h));

  // the menu opens the same field; the cross clears and closes; left empty the field goes back by itself; with a text it stays
  await page.locator('#fs-menu').click(); await sleep(200);
  check('the menu offers the search with its key, the groups (all the files together, a new group) and hiding of the panel', (await page.locator('#fpop [data-wm]').count()) === 3 && /Ctrl\+F/.test(await page.locator('#fpop [data-wm="files:find"]').innerText()) && (await page.locator('#fpop [data-act="group-all"]').count()) === 1 && (await page.locator('#fpop [data-wm="files:newgroup"]').count()) === 1);
  const hr = await page.evaluate(() => { const h = document.querySelector('#fpop hr'), c = h && getComputedStyle(h), t = document.createElement('i'); t.style.cssText = 'border:1px solid var(--line);position:fixed'; document.body.appendChild(t); const line = getComputedStyle(t).borderTopColor; t.remove(); return h ? { w: c.borderTopWidth, color: c.borderTopColor, line, bw: c.borderBottomWidth } : null; });
  check('the dividers of the menu are one quiet line, not the default bevel', !!hr && hr.w === '1px' && hr.bw === '0px' && hr.color === hr.line, JSON.stringify(hr));
  await page.locator('#fpop [data-wm="files:find"]').click(); await sleep(300);
  await page.keyboard.type('Map001'); await sleep(300);
  await page.locator('#fq-x').click(); await sleep(300);
  h = await head('.rs-head');
  check('the cross clears the text and closes the field', !!h && !h.field && (await files()) === all && (await page.locator('#fq').inputValue()) === '', JSON.stringify(h));
  await page.locator('#fs-menu').click(); await sleep(150); await page.locator('#fpop [data-wm="files:find"]').click(); await sleep(250);
  await page.locator('#tree-list .node[data-file]').first().click(); await sleep(300);
  h = await head('.rs-head');
  check('an empty field goes back to the title when it is left', !!h && !h.field && !h.searching, JSON.stringify(h));
  await page.locator('#tree-list .node[data-file]').first().focus(); await page.keyboard.press('Control+f'); await sleep(250);
  await page.keyboard.type('Map'); await sleep(250);
  await page.locator('#tree-list .node[data-file]').first().click(); await sleep(300);
  h = await head('.rs-head');
  const bc = await page.evaluate(() => { const t = document.createElement('i'); t.style.cssText = 'border:1px solid var(--line);position:fixed'; document.body.appendChild(t); const line = getComputedStyle(t).borderTopColor; t.remove(); return { field: getComputedStyle(document.querySelector('#hq-f')).borderTopColor, line }; });
  check('with a text in it the field stays open, with the quiet border (no accent outside the focus)', !!h && h.field && bc.field === bc.line, JSON.stringify({ h, bc }));
  await page.locator('#fq-x').click(); await sleep(250);

  // the picked files: the menu carries a dot, and what can be done with them stands in the menu (not in a row of buttons)
  check('with no files picked the menu has no dot', !(await page.locator('#fs-menu').evaluate(e => e.classList.contains('dot'))));
  for (const f of ['Map001.json', 'Map002.json']) await page.locator(`#tree .node[data-file="${f}"]`).click({ modifiers: ['Control'] });
  await sleep(300);
  check('with files picked the menu carries a dot', await page.locator('#fs-menu').evaluate(e => e.classList.contains('dot')));
  await page.locator('#fs-menu').click(); await sleep(200);
  const pm = await page.locator('#fpop').innerText();
  check('the menu then offers to open the picked files together, to put them into a group, and to clear the picks', /Вибрано файлів: 2/i.test(pm) && (await page.locator('#fpop [data-act="group-picked"]').count()) === 1 && (await page.locator('#fpop [data-wm="files:place"]').count()) === 1 && (await page.locator('#fpop [data-act="group-clear"]').count()) === 1, pm.replace(/\s+/g, ' '));
  await page.locator('#fpop [data-wm="files:place"]').click(); await sleep(250);
  check('«Додати вибрані до групи» opens the list of the groups under the menu', (await page.locator('#fpop').innerText()).length > 0 && (await page.locator('#fpop [data-wm]').count()) === 0);
  await page.keyboard.press('Escape'); await sleep(150);
  await page.locator('#fs-menu').click(); await sleep(200); await page.locator('#fpop [data-act="group-clear"]').click(); await sleep(300);
  check('«Зняти позначки» clears the picks and the dot', !(await page.locator('#fs-menu').evaluate(e => e.classList.contains('dot'))));

  // ---- the scenes under the files: each window has its own header and its own field
  await page.locator('#strip [data-lp="scenes"]').click(); await sleep(450);
  check('the scenes stand under the files, each with its own menu ⋮ in its own card', (await page.locator('[data-card="scenes"] #sc-menu').isVisible()) && (await page.locator('[data-card="files"] #fs-menu').isVisible()) && (await page.locator('#lp-sc .fh #sc-q').count()) === 0);
  const scenes = () => page.locator('#sc-list .sc-item').count();
  const sAll = await scenes();
  check('the scenes of the open file are listed', sAll >= 2, String(sAll));
  await page.locator('#sc-list .sc-item').first().focus();
  await page.keyboard.press('Control+f'); await sleep(300);
  h = await head('[data-card="scenes"]');
  check('Ctrl+F in the scenes opens the field in the header of the scenes (the files stay as they are)', !!h && h.field && h.searching && (await page.evaluate(() => document.activeElement?.id)) === 'sc-q' && !(await head('[data-card="files"]')).searching, JSON.stringify(h));
  await page.keyboard.type('harbour'); await sleep(300);
  check('the scenes follow what is typed', (await scenes()) === 1 && sAll >= 2, `${await scenes()} of ${sAll}`);
  await page.keyboard.press('Escape'); await sleep(250);
  check('the first Esc clears the text, the field stays', (await page.locator('#sc-q').inputValue()) === '' && (await scenes()) === sAll && (await head('[data-card="scenes"]')).field);
  await page.keyboard.press('Escape'); await sleep(250);
  h = await head('[data-card="scenes"]');
  check('the second Esc closes it: «Сцени» and the file are back', !!h && !h.field && /^Сцени/i.test(h.text), JSON.stringify(h));
  await page.locator('#sc-menu').click(); await sleep(200);
  await page.locator('#fpop [data-wm="scenes:find"]').click(); await sleep(300);
  check('the menu of the scenes opens the same field', (await page.evaluate(() => document.activeElement?.id)) === 'sc-q');
  await page.locator('#sc-list .sc-item').first().click().catch(() => {}); await sleep(300);
  check('left empty, it goes back to the title', !(await head('[data-card="scenes"]')).field);
  check('no page errors', errors.length === 0, errors.join(' | '));
  if (process.env.SHOT_DIR) { await page.locator('#fs-menu').click(); await sleep(200); await page.locator('#fpop [data-wm="files:find"]').click(); await sleep(250); await page.screenshot({ path: process.env.SHOT_DIR + '/s40-files-search.png' }); }
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
