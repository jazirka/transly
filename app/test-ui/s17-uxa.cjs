// Browser regression checks for the first-run and frame findings of the UX audit (ux-a): the totals follow the typing, the session counter
// counts rows, the left strip shows what is open, the quick search shows the match, tabs of the settings do not jump.
//   PC_URL=http://localhost:4285/ node test-ui/s17-uxa.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const long = 'The harbour master looks at you for a long time and then says that the ship you came on left three days ago without a single passenger, and nobody saw it go.';
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [{ s: 'Yes', t: 'Авжеж', mt: 1 }], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': [...Array(7).fill('Yes'), long, 'Another line here'].map((src, i) => ({ key: 'k' + i, source: src, speaker: 'Hero', kind: 'dialogue', context: '' })) },
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
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);

  // ---- the header totals follow the typing in the editor (ux-a-02) and the session counts rows, not keystrokes (ux-a-03)
  const meter = () => page.locator('#pg-txt').innerText();
  const before = await meter();
  await page.locator('.gr .tr').nth(0).click(); await page.keyboard.press('Escape'); await page.locator('[data-m="edit"]').click(); await sleep(500);
  await page.locator('#i-tr').click(); await page.keyboard.type('Так, звісно'); await sleep(1400);
  const typing = await meter();
  check('the header «Перекладено» follows the typing in the editor', typing !== before && /Перекладено 1[01]%/.test(typing) || /\(1 з/.test(typing), `${before} -> ${typing}`);
  const sess = await page.locator('#sb-sess').innerText();
  check('the session counts one changed row, however many keys were pressed', /^Сесія: 1 рядок змінено/.test(sess), sess);

  // ---- the left strip names only what is open when files and rows are both shown (ux-a-08)
  await page.locator('#strip [data-lp="files"]').click(); await sleep(300);
  const pressed = await page.$$eval('#strip button', bs => bs.filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.dataset.lp));
  check('only the buttons of the open panels are pressed', pressed.every(x => x === 'files' || x === 'rows') && pressed.length <= 2, JSON.stringify(pressed));

  // ---- the quick search shows the match, not the start of the line (ux-a-05)
  await page.keyboard.press('Control+k'); await sleep(300);
  await page.keyboard.type('nobody saw'); await sleep(500);
  const hit = await page.evaluate(() => { const t = document.querySelector('#sd-res .sd-it .sd-t'); return { text: t?.textContent ?? '', mark: t?.querySelector('mark')?.textContent ?? '' }; });
  check('the quick search shows the part of the line that matches, marked', /nobody saw/i.test(hit.text) && /nobody saw/i.test(hit.mark), JSON.stringify(hit).slice(0, 200));
  await page.keyboard.press('Escape'); await sleep(200);

  // ---- the QA counter keeps its button look with errors (ux-a-11)
  await page.locator('[data-m="table"]').click(); await sleep(400);
  await page.locator('.gr .tr').nth(8).click(); await page.keyboard.type('Без коду'); await page.keyboard.press('Control+Enter'); await sleep(900);
  const cls = await page.locator('#sb-qa').getAttribute('class');
  check('the QA counter keeps the button class', /sbtn/.test(cls ?? ''), cls ?? '');

  // ---- the settings tabs do not change the height of the dialog (ux-a-13)
  await page.locator('#hamb').click(); await sleep(300); await page.locator('#menubar [data-mg="Файл"]').click(); await sleep(200); await page.locator('#mdd').getByText('Налаштування…').first().click(); await sleep(500);
  const heights = [];
  for (const name of ['Загальні', 'Гра і мови', 'Синхронізація', 'Застосунок']) { await page.locator('.stabbar').getByRole('tab', { name }).click(); await sleep(150); heights.push(await page.evaluate(() => Math.round(document.querySelector('dialog[open]').getBoundingClientRect().height))); }
  check('the settings dialog is as tall on every tab', Math.max(...heights) - Math.min(...heights) <= 1, JSON.stringify(heights));
  await page.keyboard.press('Escape'); await sleep(300);

  // ---- a repeated line does not fill the panel with twins (ux-a-09)
  await page.locator('.gr').nth(1).click(); await sleep(500);
  const twins = await page.locator('.pn-lrow').count();
  check('the linked rows of a repeated line are three cards at most, with a button for the rest', twins <= 3 && (await page.getByRole('button', { name: 'Показати всі' }).count()) >= 1, String(twins));
  // ---- Ctrl+Z outside the field takes back what was typed in the editor, in its place among the actions (ux-c-09)
  {
    await page.locator('[data-m="edit"]').click(); await sleep(400);
    await page.locator('.si').nth(3).click(); await sleep(300);
    await page.locator('#i-tr').click(); await page.keyboard.type('Перша правка'); await page.locator('.si').nth(4).click(); await sleep(500);
    await page.locator('#i-tr').click(); await page.keyboard.type('Друга правка'); await page.locator('.si').nth(5).click(); await sleep(500);
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Control+z'); await sleep(700);
    const txt = await page.evaluate(() => document.body.innerText);
    check('Ctrl+Z takes back the last thing typed in the editor, not an older action', !/Друга правка/.test(txt) && /Перша правка/.test(txt), '');
  }
  // ---- «З пам'яті» fills the chosen empty rows (it works in steps now, so the page is not held) (ux-c-08)
  {
    await page.locator('[data-m="table"]').click(); await sleep(500);
    await page.locator('.gr').nth(4).hover(); await page.locator('.gr .rc').nth(4).check({ force: true }); await sleep(300);
    await page.locator('#bb-tm').click(); await sleep(1200);
    const rows = await page.locator('.gr').evaluateAll(r => r.map(x => x.innerText.replace(/\s+/g, ' ')));
    check('«З пам’яті» puts the match into the chosen empty row', rows.some(r => /k4 Yes/.test(r) && !/—/.test(r)), JSON.stringify(rows.filter(r => /Yes/.test(r)).map(r => r.slice(0, 40))));
  }
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
