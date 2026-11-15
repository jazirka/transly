// Browser regression check for the long list (perf audit): a file of 30 000 rows is a few hundred elements, not tens of thousands;
// the rows near the reader are drawn, the page does not grow while scrolling through, keys and jumps work.
//   PC_URL=http://localhost:4285/ node test-ui/s19-bigfile.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const N = 30000;
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': Array.from({ length: N }, (_, i) => ({ key: 'k' + i, source: 'Line number ' + i + ' of a very long file', speaker: '', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => {
  const o = indexedDB.open('transly', 3);
  o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
  o.onerror = () => rej(o.error);
});
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot });
  const t0 = Date.now(); await page.reload(); await page.waitForSelector('#grid .gr:not(.lazy)', { timeout: 60000 }); const opened = Date.now() - t0;
  const stats = () => page.evaluate(() => ({ rows: document.querySelectorAll('#grid .gr:not(.lazy)').length, nodes: document.getElementById('grid').children.length, rc: document.getElementById('grid').getAttribute('aria-rowcount') }));
  const s0 = await stats();
  check('a file of 30 000 rows opens fast', opened < 8000, opened + ' ms');
  check('the list is a few hundred elements, not tens of thousands', s0.nodes < 1500 && s0.rows < 200, JSON.stringify(s0));
  check('the grid still says how many rows it has', s0.rc === String(N + 1), s0.rc);

  // scroll through a good part of the file: what is drawn stays bounded
  const sc = '#grid';
  await page.mouse.move(700, 450);
  for (let i = 0; i < 40; i++) { await page.mouse.wheel(0, 2500); await sleep(25); }
  await sleep(500);
  const s1 = await stats();
  check('after scrolling on, the page has not grown with every screen', s1.nodes < 1800 && s1.rows < 700, JSON.stringify(s1));

  // jump far down: the rows there are drawn
  await page.evaluate(() => { const g = document.getElementById('grid').parentElement; g.scrollTop = g.scrollHeight * 0.8; });
  await sleep(1200);
  const far = await page.evaluate(() => [...document.querySelectorAll('#grid .gr:not(.lazy)')].map(r => Number(r.dataset.key.slice(1))).sort((a, b) => a - b));
  check('after a jump far down the rows of that place are drawn', far.length > 10 && far[0] > N * 0.6, `${far[0]}…${far[far.length - 1]} (${far.length})`);

  // the keyboard: select a row, go down, the next row is selected (and drawn)
  await page.locator('#grid .gr:not(.lazy)').nth(5).click(); await sleep(200);
  const k0 = await page.evaluate(() => document.querySelector('#grid .gr.sel')?.dataset.key);
  const t1 = Date.now(); await page.keyboard.press('ArrowDown'); await sleep(150);
  const k1 = await page.evaluate(() => document.querySelector('#grid .gr.sel')?.dataset.key);
  check('ArrowDown moves the selection to the next row', !!k0 && !!k1 && Number(k1.slice(1)) === Number(k0.slice(1)) + 1, `${k0} -> ${k1} in ${Date.now() - t1} ms`);

  // search for a row far away: it is found and reachable
  await page.locator('#q').fill('number 29990 of'); await sleep(1200);
  const found = await page.evaluate(() => document.querySelectorAll('#grid .gr:not(.lazy)').length);
  check('a filter finds a row at the end of the file', found === 1, String(found));
  // ---- a row with a hundred thousand letters in one word does not hold the page (the table shows its beginning; selecting and editing are quick)
  {
    await page.locator('#q').fill(''); await sleep(700);
    const p2 = project(); const snap2 = { 'Map001.json': [{ key: 'k0', source: 'A'.repeat(100000), speaker: '', kind: 'dialogue', context: '' }, { key: 'k1', source: 'Short line', speaker: '', kind: 'dialogue', context: '' }] };
    delete p2.snapshot;
    await page.evaluate(put, { text: JSON.stringify(p2), snapshot: snap2 });
    const t3 = Date.now(); await page.reload(); await page.waitForSelector('#grid .gr:not(.lazy)', { timeout: 60000 }); const opened2 = Date.now() - t3;
    check('a file with a 100 000-letter word opens in seconds, not half a minute', opened2 < 5000, opened2 + ' ms');
    const t4 = Date.now(); await page.locator('#grid .gr').first().click(); await page.waitForSelector('#grid .gr.sel'); const sel = Date.now() - t4;
    check('selecting that row is quick', sel < 3000, sel + ' ms');
    const clipped = await page.locator('#grid .gr .src').first().innerText();
    check('the table cell shows the beginning and says how much is left', /ще \d/.test(clipped) && clipped.length < 3000, String(clipped.length));
  }
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
