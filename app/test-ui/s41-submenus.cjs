// Browser regression check: the popup menus are multi-level, as in an IDE. An item with ▸ opens its list beside the menu and the menu stays open: on hover (after a short
// wait), on a click, or with → from the keyboard; ← or Esc closes the last list only; a choice closes them all; the list stands to the right of its menu with the mark ✓ on the current
// choice. The menu ⋮ of the rows has «Вигляд ▸» (the order) and «Фільтри ▸» (the statuses, boxes that stay open while ticked).
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s41-submenus.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': ['The soul of the harbour', 'Nobody saw the ship', 'A lost soul wanders', 'The tide is rising', ...Array.from({ length: 60 }, (_, i) => `Filler line ${i + 1}`)].map((source, i) => ({ key: 'k' + i, source, speaker: 'Cook', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  if (await page.locator('#tree').isVisible()) await page.locator('.strip [data-lp="files"]').click();
  if (!(await page.locator('#lp-rows').isVisible())) { await page.locator('.strip [data-lp="rows"]').click(); await sleep(350); }
  const subs = () => page.locator('.pop.sub').count();
  const menuOpen = async () => !(await page.locator('#fpop').evaluate(e => e.hidden));
  const rows = () => page.locator('#slist .si').count();
  const all = await rows();

  // ---- the thumb of the scrollbar of the list under the pointer is not drawn over a menu (the pointer stays over the list while the menu opens from the keyboard)
  await page.locator('#slist .si').nth(2).hover(); await page.mouse.move(150, 300); await sleep(300);
  check('over the list its thumb is drawn (the list is long)', (await page.locator('.ovs-y.on').count()) === 1);
  await page.evaluate(() => document.querySelector('#rs-menu').click()); await sleep(300);
  check('with a menu open the thumb of the list is not drawn over it', (await menuOpen()) && (await page.locator('.ovs-y.on').count()) === 0);
  await page.mouse.move(160, 310); await sleep(300);
  check('and it does not come back while the pointer moves over the list under the menu', (await page.locator('.ovs-y.on').count()) === 0);
  await page.keyboard.press('Escape'); await sleep(200);

  // ---- hover opens the list beside the menu, and the menu stays
  await page.locator('#rs-menu').click(); await sleep(200);
  check('the menu has two items that open lists (▸)', (await page.locator('#fpop [data-sub]').count()) === 2 && (await page.locator('#fpop [data-sub][aria-haspopup="menu"]').count()) === 2);
  check('no list is open at first', (await subs()) === 0 && (await page.locator('#fpop [data-sub][aria-expanded="true"]').count()) === 0);
  await page.locator('#fpop [data-sub="rows-sort"]').hover(); await sleep(450);
  check('hovering «Вигляд ▸» opens its list (no click needed)', (await subs()) === 1 && (await menuOpen()));
  const g = await page.evaluate(() => { const m = document.querySelector('#fpop').getBoundingClientRect(), l = document.querySelector('.pop.sub').getBoundingClientRect(), i = document.querySelector('#fpop [data-sub="rows-sort"]').getBoundingClientRect(); return { menuRight: Math.round(m.right), subLeft: Math.round(l.left), subTop: Math.round(l.top), itemTop: Math.round(i.top), inside: l.right <= innerWidth && l.bottom <= innerHeight }; });
  check('the list stands to the right of the menu, level with its item, inside the window', g.subLeft >= g.menuRight - 6 && Math.abs(g.subTop - g.itemTop) <= 12 && g.inside, JSON.stringify(g));
  check('the item that opened it is marked as open', (await page.locator('#fpop [data-sub="rows-sort"]').getAttribute('aria-expanded')) === 'true');
  check('the current choice has the mark ✓ (the order «За порядком»)', (await page.locator('.pop.sub [data-sort][aria-checked="true"]').count()) === 1 && (await page.locator('.pop.sub [data-sort][aria-checked="true"]').evaluate(e => getComputedStyle(e, '::before').content)) === '"✓"');
  // hovering the other item that opens a list swaps the lists; hovering a plain item closes it
  await page.locator('#fpop [data-sub="rows-more"]').hover(); await sleep(450);
  check('hovering «Фільтри ▸» swaps the list for its own', (await subs()) === 1 && (await page.locator('.pop.sub .fi').count()) === 8 && (await page.locator('#fpop [data-sub="rows-sort"]').getAttribute('aria-expanded')) === 'false');
  await page.locator('#fpop [data-rm="find"]').hover(); await sleep(500);
  check('hovering an item that has no list closes the list', (await subs()) === 0 && (await menuOpen()));

  // ---- the keyboard: → opens, ← closes the last list, Esc closes the last list, then the menu
  await page.locator('#fpop [data-sub="rows-sort"]').focus();
  await page.keyboard.press('ArrowRight'); await sleep(250);
  check('→ on an item with ▸ opens its list and puts the focus on its first item', (await subs()) === 1 && (await page.evaluate(() => !!document.activeElement?.closest('.pop.sub'))));
  await page.keyboard.press('ArrowDown'); await sleep(100);
  check('↓ walks the items of the list', await page.evaluate(() => document.activeElement?.dataset.sort === 'new'));
  await page.keyboard.press('ArrowLeft'); await sleep(250);
  check('← closes the list and gives the focus back to its item', (await subs()) === 0 && (await page.evaluate(() => document.activeElement?.dataset.sub === 'rows-sort')) && (await menuOpen()));
  await page.keyboard.press('Enter'); await sleep(250);
  check('Enter on the item opens the list too', (await subs()) === 1);
  await page.keyboard.press('Escape'); await sleep(250);
  check('Esc closes the list only, the menu stays', (await subs()) === 0 && (await menuOpen()));
  await page.keyboard.press('Escape'); await sleep(250);
  check('the next Esc closes the menu', !(await menuOpen()));

  // ---- a choice in the list applies and closes everything
  await page.locator('#rs-menu').click(); await sleep(200);
  await page.locator('#fpop [data-sub="rows-sort"]').click(); await sleep(250);
  await page.locator('.pop.sub [data-sort="long"]').click(); await sleep(400);
  check('choosing «Найдовші спершу» applies it and closes the list and the menu', (await subs()) === 0 && !(await menuOpen()) && (await page.locator('#rs-menu').evaluate(e => e.classList.contains('dot'))));
  await page.locator('#rs-menu').click(); await sleep(200);
  await page.locator('#fpop [data-sub="rows-sort"]').click(); await sleep(250);
  check('the mark ✓ moved to the chosen order', (await page.locator('.pop.sub [data-sort="long"]').getAttribute('aria-checked')) === 'true' && (await page.locator('.pop.sub [data-sort][aria-checked="true"]').count()) === 1);
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await sleep(200);

  // ---- the boxes of the statuses stay open while ticked, a click outside closes everything
  await page.locator('#rs-menu').click(); await sleep(200);
  await page.locator('#fpop [data-sub="rows-more"]').click(); await sleep(250);
  await page.locator('.pop.sub .fi[data-filter="new"]').click(); await sleep(400);
  check('a ticked status filters the rows while the list stays open', (await rows()) <= all && (await subs()) === 1 && (await menuOpen()) && (await page.locator('.pop.sub .fi.on').count()) === 1);
  await page.locator('#slist .si').first().click(); await sleep(300);
  check('a click outside closes the lists and the menu', (await subs()) === 0 && !(await menuOpen()));
  check('no page errors', errors.length === 0, errors.join(' | '));
  if (process.env.SHOT_DIR) { await page.locator('#rs-menu').click(); await sleep(200); await page.locator('#fpop [data-sub="rows-sort"]').hover(); await sleep(450); await page.screenshot({ path: process.env.SHOT_DIR + '/s41-submenus.png' }); }
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
