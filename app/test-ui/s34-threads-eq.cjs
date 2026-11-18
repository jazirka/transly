// Browser regression check: the rows that share an original are a chip «≡ N» at the right of the label of the translation (away from the
// text), not a thread: it has no line in the text and is not among the chips of the threads. A click opens a card with what the others
// hold, the words that differ marked; Esc or a click elsewhere puts it away; a row with no twin has no chip.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s34-threads-eq.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const SRC = 'Take your hat off.';
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' },
  files: { 'Map001.json': { a: { target: 'Зніми капелюх.', status: 'done', mt: 5 }, b: { target: 'Зніми капелюха.', status: 'done', mt: 6 }, c: { target: 'Зніми шапку.', status: 'done', mt: 7 } } },
  snapshot: { 'Map001.json': [SRC, SRC, SRC, 'Another line here'].map((source, i) => ({ key: 'abcd'[i], source, speaker: 'Hero', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => {
  const o = indexedDB.open('transly', 3);
  o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
  o.onerror = () => rej(o.error);
});

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  await page.locator('#lp-rows .si').nth(1).click(); await sleep(600);

  // the chip stands at the right of the label of the translation
  const chip = page.locator('#f-eq .eqchip');
  check('the row has one chip «≡ 2» (the two other rows with this original)', (await chip.count()) === 1 && /≡\s*2/.test(await chip.innerText()), await page.locator('#f-eq').innerHTML());
  const geo = await page.evaluate(() => { const c = document.querySelector('#f-eq .eqchip').getBoundingClientRect(), l = document.querySelector('#f-trlbl').getBoundingClientRect(), b = document.querySelector('.trblock').getBoundingClientRect(); return { chipLeft: Math.round(c.left), labelRight: Math.round(l.right), blockRight: Math.round(b.right), chipRight: Math.round(c.right) }; });
  check('it is at the right edge of the row, far from the label text', geo.chipLeft - geo.labelRight > 150 && geo.blockRight - geo.chipRight < 12, JSON.stringify(geo));
  check('it is not a thread: not among the chips of the threads', (await page.locator('#f-threads .eqchip').count()) === 0);
  check('the translations differ, so the chip says so', await chip.evaluate(e => e.classList.contains('diff')));
  check('no card stands open at first', (await page.locator('.rows-pop').count()) === 0 && (await chip.getAttribute('aria-expanded')) === 'false');

  // a click opens the card with the others, the differing words marked
  await chip.click(); await sleep(300);
  const rows = await page.locator('.rows-pop .pn-lrow').count();
  check('a click opens the card with this row and the others', rows === 3 && (await chip.getAttribute('aria-expanded')) === 'true', String(rows));
  const marks = await page.locator('.rows-pop .pn-lx mark.df').allInnerTexts();
  check('the words that this row does not have are marked in the others', marks.includes('капелюх') && marks.includes('шапку') && !marks.includes('Зніми'), JSON.stringify(marks));
  check('the card stands under the chip, inside the window', await page.evaluate(() => { const r = document.querySelector('.rows-pop').getBoundingClientRect(), c = document.querySelector('#f-eq .eqchip').getBoundingClientRect(); return r.top >= c.bottom && r.right <= window.innerWidth && r.left >= 0; }));
  await page.keyboard.press('Escape'); await sleep(250);
  check('Esc puts it away', (await page.locator('.rows-pop').count()) === 0);
  await chip.click(); await sleep(250);
  await page.locator('#f-src').click(); await sleep(250);
  check('and so does a click elsewhere', (await page.locator('.rows-pop').count()) === 0);
  await chip.click(); await sleep(250); await chip.click(); await sleep(250);
  check('and a second click on the chip', (await page.locator('.rows-pop').count()) === 0);

  // another row: the card is not carried over; a row without a twin has no chip
  await chip.click(); await sleep(250);
  await page.locator('#lp-rows .si').nth(2).click(); await sleep(600);
  check('another row with the same original has its own chip and the card is closed', (await page.locator('#f-eq .eqchip').count()) === 1 && (await page.locator('.rows-pop').count()) === 0);
  await page.locator('#lp-rows .si').nth(3).click(); await sleep(600);
  check('a row with no twin has no chip', (await page.locator('#f-eq .eqchip').count()) === 0);

  // the table has no editor: the chip is the first of the chips of the right panel
  await page.locator('[data-m="table"]').click(); await sleep(500);
  await page.locator('.gr').nth(0).click(); await sleep(500);
  check('in the table the chip stands first among the chips of the right panel', (await page.locator('#pn-th .thb .eqwrap').first().evaluate(e => e === e.parentElement.firstElementChild)) && (await page.locator('#pn-th .eqchip').count()) === 1);
  check('no page errors', errors.length === 0, errors.join(' | '));
  if (process.env.SHOT_DIR) { await page.locator('[data-m="edit"]').click(); await sleep(400); await page.locator('#lp-rows .si').nth(1).click(); await sleep(500); await page.locator('#f-eq .eqchip').click(); await sleep(300); await page.screenshot({ path: process.env.SHOT_DIR + '/s34-threads-eq.png' }); }
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
