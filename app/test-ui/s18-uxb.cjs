// Browser regression checks for the translator's-workplace findings of the UX audit (ux-b): Enter in a
// one-line row sends, the list sort does not reorder the table, a QA fix can be undone in the field, invisible characters show,
// the resolved threads stay open.
//   PC_URL=http://localhost:4285/ node test-ui/s18-uxb.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const units = [
  { key: 'k0', source: 'Harbour', speaker: '', kind: 'name', context: 'Name' },
  { key: 'k1', source: 'The harbour master looks at you for a long time and then says nothing at all.', speaker: 'Hero', kind: 'dialogue', context: 'EV1' },
  { key: 'k2', source: 'Danger‪here​now', speaker: 'Hero', kind: 'dialogue', context: 'EV1' },
  { key: 'k3', source: 'Short', speaker: 'Hero', kind: 'dialogue', context: 'EV1' },
  { key: 'k4', source: 'A line that is in the middle of the pack in length', speaker: 'Hero', kind: 'dialogue', context: 'EV1' },
  { key: 'k5', source: 'A much much much much much longer line than all of the others put together, by far', speaker: 'Hero', kind: 'dialogue', context: 'EV1' },
];
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': units },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => {
  const o = indexedDB.open('transly', 3);
  o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
  o.onerror = () => rej(o.error);
});
const stored = () => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const g = db.transaction('projects').objectStore('projects').get('default'); g.onsuccess = () => { db.close(); res(g.result ?? ''); }; g.onerror = () => rej(g.error); }; o.onerror = () => rej(o.error); });
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);

  // ---- the line over the table follows the selected row (ux-b-02)
  await page.locator('.gr').nth(3).click(); await sleep(300);

  // ---- Enter in a one-line row (a name) sends it and puts no line break in (ux-b-08)
  await page.locator('[data-m="edit"]').click(); await sleep(400);
  await page.locator('.si').nth(0).click(); await sleep(300);
  await page.locator('#i-tr').click(); await page.keyboard.type('Гавань'); await page.keyboard.press('Enter'); await sleep(1300);
  const st = JSON.parse(await page.evaluate(stored)).files['Map001.json'].k0;
  check('Enter in a name sends it without a line break', st?.status === 'done' && !/\n/.test(st.target), JSON.stringify(st && { s: st.status, t: st.target }));

  // ---- the invisible characters of an original are shown (ux-b-09)
  await page.locator('.si').nth(2).click(); await sleep(400);
  const inv = await page.locator('#f-src .inv').count();
  check('direction marks and zero-width characters of the original are shown as marks', inv >= 2, String(inv));

  // ---- a QA fix can be taken back in the field with Ctrl+Z (ux-b-12)
  await page.locator('.si').nth(1).click(); await sleep(400);
  await page.locator('#i-tr').click(); await page.keyboard.type('Привіт  світ, гавані'); await sleep(900);
  const fix = page.getByRole('button', { name: /Виправити/ }).first();
  if (await fix.count()) {
    await fix.click(); await sleep(500);
    const fixed = await page.locator('#i-tr').inputValue();
    await page.locator('#i-tr').focus(); await page.keyboard.press('Control+z'); await sleep(300);
    const back = await page.locator('#i-tr').inputValue();
    check('a QA fix is undone by Ctrl+Z in the field', !/  /.test(fixed) && /  /.test(back), JSON.stringify({ fixed, back }));
  } else check('a QA fix button is offered for a double space', false, 'no button');

  // ---- the sort of the list does not reorder the table (ux-b-20)
  await page.locator('#rs-menu').click(); await sleep(200); await page.locator('#fpop [data-rm="sort"]').click(); await sleep(200);
  await page.locator('#fpop [data-sort="long"]').click(); await sleep(400);
  await page.locator('[data-m="table"]').click(); await sleep(600);
  const order = await page.$$eval('.gr[data-key]:not(.lazy)', rs => rs.map(r => r.dataset.key));
  check('the table keeps the order of the file when the list is sorted', order.join() === 'k0,k1,k2,k3,k4,k5', order.join());

  // ---- a resolved thread: the section stays open when its «Видалити» is armed (ux-b-17)
  await page.locator('.gr').nth(3).click(); await sleep(300);
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  await page.locator('#stabs [data-p="cm"]').click(); await sleep(200); // the discussion is the second tab on the rail of the right panel
  await page.locator('#cm-in').click(); await page.keyboard.type('Перевірити термін'); await page.keyboard.press('Control+Enter'); await sleep(500);
  await page.locator('[data-cm="resolve"]').first().click(); await sleep(400);
  await page.locator('details.thr-closed summary').click(); await sleep(300);
  await page.locator('details.thr-closed [data-cm="delete"]').first().click(); await sleep(400);
  const armed = await page.evaluate(() => ({ open: !!document.querySelector('details.thr-closed[open]'), label: document.querySelector('details.thr-closed [data-cm="delete"]')?.textContent ?? '' }));
  check('the resolved section stays open and the delete button asks again', armed.open && /Справді видалити/.test(armed.label), JSON.stringify(armed));

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
