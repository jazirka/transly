// Browser regression check: the pages of the list of rows. Pages: one page is drawn, the bubble has «‹ 3 / 12 ›»; the continuous list marks where each
// page begins and its bubble follows the scroll; both can be turned off in the settings; the place of every list (the page and the scroll) comes back.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s38-pages.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const N = 130;
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: {
    'Map001.json': Array.from({ length: N }, (_, i) => ({ key: 'k' + i, source: `Row number ${i + 1} of the long file`, speaker: 'Hero', kind: 'dialogue', context: '' })),
    'Map002.json': Array.from({ length: 12 }, (_, i) => ({ key: 'm' + i, source: `Small file line ${i + 1}`, speaker: 'Hero', kind: 'dialogue', context: '' })),
  },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot });
  await page.evaluate(() => { localStorage.removeItem('transly.pages'); localStorage.removeItem('transly.places'); });
  await page.reload(); await sleep(1500);
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  const open = async lp => { await page.locator(`.strip [data-lp="${lp}"]`).click(); await sleep(350); };
  if (!(await page.locator('#tree').isVisible())) await open('files');
  if (!(await page.locator('#lp-rows').isVisible())) await open('rows');
  await page.locator('#tree .node[data-file="Map001.json"]').click(); await sleep(700);

  const bubble = () => page.evaluate(() => { const b = document.getElementById('pgb'); return b && !b.hidden ? { text: b.innerText.replace(/\s+/g, ' ').trim(), prev: b.querySelector('[data-pg="prev"]')?.disabled ?? null, next: b.querySelector('[data-pg="next"]')?.disabled ?? null, arrows: b.querySelectorAll('.pg-a').length } : null; });
  const has = key => page.evaluate(k => !!document.querySelector(`#slist .si[data-key="${k}"]`), key);
  const scrollList = y => page.evaluate(v => { document.getElementById('slist').scrollTop = v; }, y);

  // ---- pages: one page is drawn
  let b = await bubble();
  check('by default the list is pages: the bubble says «1 / 3» and the first arrow is off', !!b && /^‹ 1 \/ 3 ›$/.test(b.text) && b.prev === true && b.next === false, JSON.stringify(b));
  await scrollList(100000); await sleep(500);
  check('the last row of the page is there and the next page is not', (await has('k49')) && !(await has('k50')), `${await has('k49')} ${await has('k50')}`);
  check('the first row of the first page is there', await has('k0'));

  await page.locator('#pgb [data-pg="next"]').click(); await sleep(500);
  b = await bubble();
  check('«›» turns to the next page: «2 / 3»', !!b && /2 \/ 3/.test(b.text) && b.prev === false, JSON.stringify(b));
  check('its rows are drawn, the rows of the first page are gone', (await has('k50')) && !(await has('k49')) && !(await has('k0')));
  check('the list starts at the top of the page', (await page.evaluate(() => document.getElementById('slist').scrollTop)) < 5);

  // ---- a jump by number
  await page.locator('#pgb [data-pg="jump"]').click(); await sleep(200);
  check('the label becomes a field for the number', (await page.locator('#pgb .pg-in').count()) === 1);
  await page.locator('#pgb .pg-in').fill('3'); await page.keyboard.press('Enter'); await sleep(500);
  b = await bubble();
  check('Enter goes to that page: «3 / 3», the last arrow is off', !!b && /3 \/ 3/.test(b.text) && b.next === true, JSON.stringify(b));
  check('the last page has the rest of the rows', (await has('k100')) && (await has('k129')) && !(await has('k99')));
  await page.locator('#pgb [data-pg="jump"]').click(); await sleep(150); await page.keyboard.press('Escape'); await sleep(250);
  check('Esc puts the label back without leaving the page', (await page.locator('#pgb .pg-in').count()) === 0 && /3 \/ 3/.test((await bubble())?.text ?? ''));

  // ---- a row on another page brings its page
  await page.locator('#slist .si').first().click(); await sleep(300);
  await page.keyboard.press('Control+k'); await sleep(300);
  await page.keyboard.type('Row number 20 of'); await sleep(500);
  await page.keyboard.press('Enter'); await sleep(900);
  b = await bubble();
  check('opening a row of another page brings that page in', !!b && /1 \/ 3/.test(b.text) && (await has('k19')), JSON.stringify(b));

  // ---- the place comes back: page 2, a scroll, another file and back
  await page.locator('#pgb [data-pg="next"]').click(); await sleep(500);
  await scrollList(240); await sleep(700);
  await page.locator('#tree .node[data-file="Map002.json"]').click(); await sleep(800);
  check('a list of one page has no bubble', (await bubble()) === null);
  await page.locator('#tree .node[data-file="Map001.json"]').click(); await sleep(900);
  b = await bubble(); const top = await page.evaluate(() => document.getElementById('slist').scrollTop);
  check('coming back to the file: the same page and the same place', !!b && /2 \/ 3/.test(b.text) && Math.abs(top - 240) < 80, `${JSON.stringify(b)} top=${top}`);

  // ---- the settings: the continuous list with marks
  await page.locator('#hamb').click().catch(() => {}); await sleep(250);
  await page.locator('#menubar [data-mg="Файл"]').click(); await sleep(200); await page.locator('#mdd').getByText('Налаштування…').first().click(); await sleep(500);
  await page.locator('.st-ti[data-p="look"]').click(); await sleep(200);
  check('the settings have the choice of how to show the list, the size of a page and the memory', (await page.locator('#st-pgm').count()) === 1 && (await page.locator('#st-pgs').count()) === 1 && (await page.locator('#st-pgr').count()) === 1 && (await page.locator('#st-pgr').isChecked()));
  await page.locator('#st-pgm').selectOption('flow'); await sleep(500);
  await page.keyboard.press('Escape'); await sleep(400);
  b = await bubble();
  check('continuous with marks: the bubble has the label only', !!b && b.arrows === 0 && /\/ 3/.test(b.text), JSON.stringify(b));
  await scrollList(0); await sleep(500);
  check('every page begins with a mark (the first one has no line above)', await page.evaluate(() => { const f = document.querySelector('#slist .si.pg-first[data-page="1"]'); return !!f; }));
  await page.locator('#pgb [data-pg="jump"]').click(); await sleep(200);
  await page.locator('#pgb .pg-in').fill('3'); await page.keyboard.press('Enter'); await sleep(900);
  const flowKeys = await page.evaluate(() => [...document.querySelectorAll('#slist .si:not(.lazy)')].map(e => e.dataset.key));
  check('a jump scrolls the continuous list to the first row of the page (the other pages are still there)', flowKeys.includes('k100') && /3 \/ 3/.test((await bubble())?.text ?? ''), flowKeys.slice(0, 4).join());
  await scrollList(0); await sleep(700);
  check('scrolling back to the top the bubble says «1 / 3»', /1 \/ 3/.test((await bubble())?.text ?? ''), JSON.stringify(await bubble()));

  // ---- off
  await page.evaluate(() => localStorage.setItem('transly.pages', JSON.stringify({ mode: 'off', size: 50, remember: false })));
  await page.reload(); await sleep(1500);
  if (!(await page.locator('#tree').isVisible())) await open('files');
  if (!(await page.locator('#lp-rows').isVisible())) await open('rows');
  await page.locator('#tree .node[data-file="Map001.json"]').click(); await sleep(800);
  check('off: no bubble and no marks', (await bubble()) === null && (await page.locator('#slist .si.pg-first').count()) === 0);
  await scrollList(100000); await sleep(600);
  check('off: the whole list is there', await has('k129'));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
