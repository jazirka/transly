// Browser regression check: the statuses are chosen in «Ще ▾» (boxes with a dot and a count, they can be mixed) and the chosen ones show as chips;
// the search over everything (Ctrl+K) has sections and the keys at the bottom; the run menu has an icon of its own for each of its three items.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s32-filters.cjs
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
    const game = await root.getDirectoryHandle('flt-game', { create: true });
    const data = await game.getDirectoryHandle('data', { create: true });
    for (const [n, t] of [['Map001.json', a], ['Map002.json', b]]) { const w = await (await data.getFileHandle(n, { create: true })).createWritable(); await w.write(t); await w.close(); }
    window.showDirectoryPicker = async () => root.getDirectoryHandle('flt-game');
  }, { a: JSON.stringify(mapOf('Town', 12)), b: JSON.stringify(mapOf('Forest', 8)) });
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1500);
  // one row is sent, so that «Надіслані» is not empty
  await page.locator('[data-m="table"]').click(); await sleep(500);
  await page.locator('.gr .tr').nth(1).click(); await page.keyboard.type('Привіт'); await page.keyboard.press('Control+Enter'); await sleep(800);
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  const open = async lp => { await page.locator(`.strip [data-lp="${lp}"]`).click(); await sleep(350); };
  if (!(await page.locator('#lp-rows').isVisible())) await open('rows');
  const rowsN = () => page.locator('#slist .si').count();
  const all = await rowsN();

  // at rest there is no row of chips: «Ще ▾» only
  check('at rest the rows window has no chips of statuses, only «Ще ▾»', (await page.locator('#chips2 .chip[data-filter]').count()) === 0 && (await page.locator('#chips2 [data-more]').count()) === 1);
  // the box with the statuses
  await page.locator('#chips2 [data-more]').click(); await sleep(250);
  const pop = await page.$$eval('#fpop .fi', cs => cs.map(c => ({ f: c.dataset.filter, t: c.textContent.trim().replace(/\s+/g, ' '), dot: c.querySelector('.sd')?.className ?? '', off: c.disabled })));
  check('«Ще ▾» lists the statuses and the extras with their counts', pop.length === 8 && pop.every(p => /\d$/.test(p.t)), JSON.stringify(pop.map(p => p.t)));
  check('the statuses wear their dots', pop.find(p => p.f === 'new')?.dot === 'sd new' && pop.find(p => p.f === 'done')?.dot === 'sd done', JSON.stringify(pop.map(p => [p.f, p.dot])));
  await page.locator('#fpop .fi[data-filter="new"]').click(); await sleep(400);
  const onlyNew = await rowsN();
  check('a ticked status filters the rows and shows as a chip', onlyNew === all - 1 && (await page.locator('#chips2 .chip.on[data-filter="new"]').count()) === 1, `${all} -> ${onlyNew}`);
  check('the box stays open while statuses are ticked', await page.locator('#fpop').isVisible() && (await page.locator('#fpop .fi.on').count()) === 1);
  await page.locator('#fpop .fi[data-filter="done"]').click(); await sleep(400);
  check('two statuses can be mixed (a row passes when it has any of them)', (await rowsN()) === all && (await page.locator('#chips2 .chip.on[data-filter]').count()) === 2, `${await rowsN()} of ${all}`);
  await page.keyboard.press('Escape'); await sleep(200);
  await page.locator('#chips2 .chip.on[data-filter="new"]').click(); await sleep(400);
  check('a click on a chip drops that status', (await rowsN()) === 1 && (await page.locator('#chips2 .chip.on[data-filter]').count()) === 1, String(await rowsN()));
  await page.locator('#chips2 [data-reset]').click(); await sleep(400);
  check('«Скинути» brings every row back and the chips go', (await rowsN()) === all && (await page.locator('#chips2 .chip.on[data-filter]').count()) === 0);

  // the sort moved into «Вигляд ▾»
  check('the sort button is «Вигляд ▾»', /Вигляд/.test(await page.locator('#sortbtn').innerText()));
  await page.locator('#sortbtn').click(); await sleep(200);
  check('and offers the order with a mark on the current one', (await page.locator('#fpop [data-sort]').count()) >= 3 && (await page.locator('#fpop [data-sort][aria-checked="true"]').count()) === 1);
  await page.keyboard.press('Escape'); await sleep(150);

  // the search over everything
  await page.keyboard.press('Control+k'); await sleep(400);
  const tabs = await page.$$eval('#sd-tabs [role=tab]', bs => bs.map(b => b.textContent.trim()));
  check('the search has sections: all, files, rows, terms', JSON.stringify(tabs) === JSON.stringify(['Усе', 'Файли', 'Рядки', 'Терміни']), JSON.stringify(tabs));
  const foot = await page.locator('.sd-foot').innerText();
  check('and the keys at the bottom', /↑↓/.test(foot) && /Enter/.test(foot) && /Tab/.test(foot) && /Esc/.test(foot), foot);
  await page.keyboard.type('line'); await sleep(300);
  const kinds0 = await page.$$eval('.sd-h', hs => hs.map(h => h.textContent.trim().split(' ')[0]));
  check('«Усе» groups the results', kinds0.includes('Рядки'), JSON.stringify(kinds0));
  await page.keyboard.press('Tab'); await sleep(250);
  check('Tab goes to the next section (files)', (await page.locator('#sd-tabs [aria-selected="true"]').innerText()) === 'Файли');
  await page.keyboard.press('Tab'); await sleep(250);
  const kinds2 = await page.$$eval('.sd-h', hs => hs.map(h => h.textContent.trim().split(' ')[0]));
  check('and to the rows: only they are listed', (await page.locator('#sd-tabs [aria-selected="true"]').innerText()) === 'Рядки' && kinds2.length === 1 && kinds2[0] === 'Рядки', JSON.stringify(kinds2));
  await page.keyboard.press('Shift+Tab'); await sleep(200);
  check('Shift+Tab goes back', (await page.locator('#sd-tabs [aria-selected="true"]').innerText()) === 'Файли');
  await page.keyboard.press('Escape'); await sleep(300);

  // the run menu: an icon of its own for each item
  await page.locator('#cfg-btn').click(); await sleep(300);
  const icons = await page.$$eval('#cfgpop .cfg-i', is => is.map(i => i.innerHTML));
  check('the three run modes have three different icons', icons.length === 3 && new Set(icons).size === 3, JSON.stringify(icons.length));
  await page.keyboard.press('Escape');
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close(); await browser.close();
  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nall checks passed');
})();
