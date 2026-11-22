// Browser regression check: rows of the table of the project are selected by holding the mouse on the number column and dragging; the table scrolls
// by itself near its edge; Ctrl adds; a press without a move toggles one row.
//   PC_URL=http://localhost:4285/ node test-ui/s58-drag-select.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const T = 1700000000000;
const rows = Array.from({ length: 300 }, (_, i) => ({ key: 'k' + i, source: 'Line number ' + i, speaker: '', kind: 'dialogue', context: '' }));
const project = { version: 1, name: 'D', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [], settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' }, files: { 'Map001.json': {} } };
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 800 } })).newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(500);
  await page.evaluate(put, { text: JSON.stringify(project), snapshot: { 'Map001.json': rows } }); await page.reload(); await sleep(1300);
  const n = () => page.evaluate(() => document.querySelectorAll('#grid .gr.chk').length);
  const ln = i => page.locator('#grid .gr .ln').nth(i);
  const box = async i => (await ln(i).boundingBox());
  let b3 = await box(3), b8 = await box(8);
  await page.mouse.move(b3.x + 6, b3.y + b3.height / 2); await page.mouse.down();
  await page.mouse.move(b8.x + 6, b8.y + b8.height / 2, { steps: 8 }); await sleep(150);
  check('holding the mouse on the number and dragging down selects the rows it passes (rows 4 to 9)', (await n()) === 6, String(await n()));
  await page.mouse.move(b8.x + 6, b3.y, { steps: 6 }); await sleep(150);
  check('moving back shortens the selection', (await n()) === 1, String(await n()));
  await page.mouse.move(b8.x + 6, b8.y, { steps: 4 }); await page.mouse.up(); await sleep(150);
  check('the bar of the selected rows counts them', /\b6\b/.test(await page.locator("#bulkn").innerText()), await page.locator('#bulkn').innerText());
  // autoscroll
  const wrap = await page.locator('.gridwrap').boundingBox();
  const before = await page.evaluate(() => document.querySelector('.gridwrap').scrollTop);
  b3 = await box(3);
  await page.mouse.move(b3.x + 6, b3.y + b3.height / 2); await page.mouse.down();
  await page.mouse.move(b3.x + 6, wrap.y + wrap.height - 8, { steps: 10 }); await sleep(1500);
  const after = await page.evaluate(() => document.querySelector('.gridwrap').scrollTop);
  const many = await n();
  await page.mouse.up(); await sleep(150);
  check('at the bottom edge the table scrolls by itself while the mouse is held', after > before + 300, `${before} → ${after}`);
  check('and the selection grows with it', many > 25, String(many));
  // a press without a move toggles; Ctrl adds
  await page.evaluate(() => { document.querySelector('.gridwrap').scrollTop = 0; }); await sleep(300);
  await page.locator('#bb-clear').click(); await sleep(200);
  const b1 = await box(1); await page.mouse.click(b1.x + 6, b1.y + b1.height / 2); await sleep(150);
  check('a click on the number toggles the row', (await n()) === 1);
  const b5 = await box(5), b7 = await box(7);
  await page.keyboard.down('Control'); await page.mouse.move(b5.x + 6, b5.y + 8); await page.mouse.down(); await page.mouse.move(b7.x + 6, b7.y + 8, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Control'); await sleep(150);
  check('Ctrl adds a dragged range to what is selected', (await n()) === 4, String(await n()));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
