// Browser regression check: the header of the rows window. «Рядки» and the name of the file; the menu ⋮ and «—» at the right and no lupa; the search is a field
// that takes the place of the title (the menu, or Ctrl+F), Esc clears it and then closes it, the ✕ clears and closes; no row of buttons under the header.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s39-rows-header.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': ['The soul of the harbour', 'Nobody saw the ship', 'A lost soul wanders', 'The tide is rising'].map((source, i) => ({ key: 'k' + i, source, speaker: 'Cook', kind: 'dialogue', context: '' })) },
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
  const open = async lp => { await page.locator(`.strip [data-lp="${lp}"]`).click(); await sleep(350); };
  // only the rows window: the header of the panel carries the controls
  if (await page.locator('#tree').isVisible()) await open('files');
  if (!(await page.locator('#lp-rows').isVisible())) await open('rows');
  const rows = () => page.locator('#slist .si').count();
  const head = () => page.evaluate(() => { const h = document.querySelector('.rs-head'); return h ? { text: h.innerText.replace(/\s+/g, ' ').trim(), menu: !!h.querySelector('#rs-menu') && h.querySelector('#rs-menu').getClientRects().length > 0, field: h.querySelector('#hq') && h.querySelector('#hq').getClientRects().length > 0, lupa: h.querySelector('#lp-search') && h.querySelector('#lp-search').getClientRects().length > 0, searching: h.classList.contains('searching') } : null; });

  let h = await head();
  check('the header says «Рядки» and the menu ⋮ stands in it, with no field', !!h && /^Рядки/i.test(h.text) && h.menu && !h.field && !h.searching, JSON.stringify(h));
  check('there is no lupa in the header of the rows', !!h && !h.lupa && (await page.locator('#rs-search').count()) === 0);
  check('there is no row of buttons and no field under the header', (await page.locator('#lp-rows .fh').evaluate(e => e.getBoundingClientRect().height)) < 2);
  const all = await rows();

  // Ctrl+F opens the field and types into it
  await page.locator('#slist .si').first().focus();
  await page.keyboard.press('Control+f'); await sleep(300);
  h = await head();
  check('Ctrl+F opens the search in the header and the focus is in it', !!h && h.field && h.searching && (await page.evaluate(() => document.activeElement?.id)) === 'q2', JSON.stringify(h));
  check('the empty field shows its key (Ctrl+F)', await page.locator('#hq .kbd').isVisible());
  // left empty, the field goes back to the title (a click elsewhere); the accent ring is only for the focus, as in every other field
  const ring = await page.evaluate(() => { const f = document.querySelector('#hq'), c = getComputedStyle(f); return { border: c.borderTopColor, outline: c.outlineStyle + ' ' + c.outlineColor }; });
  check('the focused field has the accent ring (the outline) like every other field', ring.outline.startsWith('solid'), JSON.stringify(ring));
  await page.locator('#slist .si').first().click(); await sleep(350);
  h = await head();
  check('an empty field goes back to the title when it is left', !!h && !h.field && !h.searching && /^Рядки/i.test(h.text), JSON.stringify(h));
  await page.locator('#slist .si').first().focus();
  await page.keyboard.press('Control+f'); await sleep(300);
  await page.keyboard.type('soul'); await sleep(600);
  check('the list follows what is typed', (await rows()) === 2 && (await rows()) < all, `${await rows()} of ${all}`);
  check('the cross of the field is shown while there is a text', await page.locator('#hq .hqx').isVisible() && !(await page.locator('#hq .kbd').isVisible()));
  await page.keyboard.press('Escape'); await sleep(500);
  h = await head();
  check('the first Esc clears the text and leaves the field open', (await page.locator('#q2').inputValue()) === '' && !!h && h.field && (await rows()) === all, JSON.stringify(h));
  await page.keyboard.press('Escape'); await sleep(400);
  h = await head();
  check('the second Esc closes the field and the focus goes back to the list', !!h && !h.field && !h.searching && /^Рядки/i.test(h.text) && (await page.evaluate(() => !!document.activeElement?.closest('#slist'))), JSON.stringify(h));

  // the menu opens the same field; the cross clears and closes it
  await page.locator('#rs-menu').click(); await sleep(200);
  check('the menu lists the order, the filters and the search with its keys', (await page.locator('#fpop [data-rm]').count()) >= 4 && /Ctrl\+F/.test(await page.locator('#fpop [data-rm="find"]').innerText()));
  await page.locator('#fpop [data-rm="find"]').click(); await sleep(300);
  await page.keyboard.type('tide'); await sleep(600);
  check('the field opened from the menu works', (await rows()) === 1, String(await rows()));
  await page.locator('#q2-x').click(); await sleep(500);
  h = await head();
  check('the cross clears the text and closes the field', !!h && !h.field && (await rows()) === all && (await page.locator('#q2').inputValue()) === '', JSON.stringify(h));

  // a query stays open: the field is not closed by leaving it
  await page.locator('#rs-menu').click(); await sleep(150); await page.locator('#fpop [data-rm="find"]').click(); await sleep(250);
  await page.keyboard.type('ship'); await sleep(500);
  await page.locator('#slist .si').first().click(); await sleep(400);
  h = await head();
  check('with a text in it the field stays open', !!h && h.field && (await page.locator('#q2').inputValue()) === 'ship', JSON.stringify(h));
  const bc = await page.evaluate(() => { const t = document.createElement('i'); t.style.cssText = 'border:1px solid var(--line);position:fixed'; document.body.appendChild(t); const line = getComputedStyle(t).borderTopColor; t.remove(); return { field: getComputedStyle(document.querySelector('#hq')).borderTopColor, line }; });
  check('an open field that is not focused keeps the quiet border (no accent)', bc.field === bc.line, JSON.stringify(bc));
  await page.locator('#rs-menu').click(); await sleep(200);
  await page.locator('#fpop [data-rm="reset"]').click(); await sleep(500);
  h = await head();
  check('«Скинути пошук і фільтри» clears the text and closes the field', !!h && !h.field && (await rows()) === all);

  // two windows: the controls move into the card of the rows
  await open('files'); await sleep(300);
  const placed = await page.evaluate(() => ({ inCard: !!document.querySelector('[data-card="rows"] #rs-menu'), card: document.querySelector('[data-card="rows"]').innerText.replace(/\s+/g, ' ').trim() }));
  check('with the files shown too, the menu ⋮ stands in the card of the rows, which is titled the same', placed.inCard && /^Рядки/i.test(placed.card), JSON.stringify(placed));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
