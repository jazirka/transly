// Browser regression check: the English pack that comes with the application. English is offered without installing anything; choosing it puts the
// interface in English (menus, panels, dialogs, counts such as «5 rows»), the text of the game (the rows of the table, the editor) is never touched, and the
// choice survives a reload and can be undone. Run as s0-safety.cjs:   PC_URL=http://localhost:4285/ node test-ui/s51-lang-en.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + String(detail).slice(0, 220) : '')); if (!ok) failed++; };
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });

const T = 1700000000000;
const project = () => ({ version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [], settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' },
  files: { 'Map001.json': { k0: { target: 'Так', status: 'done', mt: T + 1000 }, k1: { target: 'Скасувати', status: 'done', mt: T + 2000 }, k2: { target: 'Файл', status: 'draft', mt: T + 3000 } } },
  snapshot: { 'Map001.json': ['Yes', 'Cancel', 'File'].map((source, i) => ({ key: 'k' + i, source, speaker: 'Hero', kind: 'dialogue', context: '' })) } });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);

  const bar = async () => { if (!(await page.locator('#menubar').isVisible())) { await page.locator('#hamb').click({ timeout: 2000 }).catch(() => {}); await sleep(250); } };
  const menu = async name => { await bar(); await sleep(100); await page.locator('#menubar [data-mb], #menubar button').filter({ hasText: new RegExp('^' + name + '$') }).first().click(); await sleep(250); };
  // open the manager on the language page
  await menu('Файл'); await page.locator('#mdd').getByText('Розширення…').first().click(); await sleep(500);
  const dlg = page.locator('dialog.exd-dlg');
  await dlg.locator('.st-ti', { hasText: 'Мова інтерфейсу' }).click(); await sleep(250);
  const langs = await dlg.locator('input[name="ex-lang"]').evaluateAll(a => a.map(x => x.value));
  check('English is offered without installing anything', langs.includes('en') && langs.includes('uk'), langs.join(','));
  await dlg.locator('input[name="ex-lang"][value="en"]').check(); await sleep(500);
  const titles = await dlg.innerText();
  check('the manager itself speaks English', /Interface language/.test(titles) && /Extensions/.test(titles), titles.slice(0, 120));
  await dlg.locator('button', { hasText: /Close|Закрити|Готово|Done/ }).first().click().catch(async () => { await page.keyboard.press('Escape'); }); await sleep(300);
  if (await dlg.count() && await dlg.evaluate(d => d.open).catch(() => false)) await page.keyboard.press('Escape');
  await sleep(300);

  // the interface is in English, the rows of the game are not
  await bar();
  const bar1 = await page.locator('#menubar').innerText();
  check('the menu bar is in English', /File/.test(bar1) && /Tools/.test(bar1), bar1.replace(/\s+/g, ' '));
  const rowsTxt = await page.locator('#slist, #grid, #table').allInnerTexts().catch(() => []);
  const rowsAll = rowsTxt.join(' ');
  check('the text of the game is not translated (Так · Скасувати · Файл stay)', /Так/.test(rowsAll) && /Скасувати/.test(rowsAll) && /Файл/.test(rowsAll), rowsAll.replace(/\s+/g, ' ').slice(0, 160));

  // how much Ukrainian is left in the chrome (outside the rows of the game)? a small allowance: strings built in code from several pieces
  const left = await page.evaluate(() => {
    const SKIP = '.gr, textarea, #slist .si, #grid, #table, .tx, .src, .tgt, code, pre, input';
    const out = [];
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) {
      const t = n.nodeValue.trim(); if (!t || !/[Ѐ-ӿ]/.test(t)) continue;
      const el = n.parentElement; if (!el || el.closest(SKIP) || el.closest('[hidden]') || !el.offsetParent) continue;
      out.push(t.slice(0, 60));
    }
    return out;
  });
  check('little Ukrainian is left in the visible interface (outside the game text)', left.length <= 12, left.join(' | '));

  // it survives a reload
  await page.reload(); await sleep(1500);
  await bar();
  const bar2 = await page.locator('#menubar').innerText();
  check('the language is kept after a reload', /File/.test(bar2), bar2.replace(/\s+/g, ' '));

  // the settings dialog and the counts
  await menu('File'); await page.locator('#mdd').getByText(/Settings…/).first().click().catch(() => {}); await sleep(600);
  const st = await page.locator('dialog[open]').first().innerText().catch(() => '');
  check('the settings speak English', /General|Settings|Checks/.test(st) && !/Загальні/.test(st.replace(/\s+/g, ' ')), st.replace(/\s+/g, ' ').slice(0, 160));
  await page.keyboard.press('Escape'); await sleep(300);

  // back to Ukrainian
  await menu('File'); await page.locator('#mdd').getByText('Extensions…').first().click(); await sleep(500);
  const dlg2 = page.locator('dialog.exd-dlg');
  await dlg2.locator('.st-ti', { hasText: 'Interface language' }).click(); await sleep(250);
  await dlg2.locator('input[name="ex-lang"][value="uk"]').check(); await sleep(500);
  await page.keyboard.press('Escape'); await sleep(300);
  await bar();
  const bar3 = await page.locator('#menubar').innerText();
  check('back in Ukrainian the interface is Ukrainian again', /Файл/.test(bar3) && !/Tools/.test(bar3), bar3.replace(/\s+/g, ' '));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
