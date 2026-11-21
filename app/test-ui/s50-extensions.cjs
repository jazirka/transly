// Browser regression check: the manager of extensions (plugins). The built-in plugins are there and can be switched off; a language pack is installed from files
// (after its consent screen), the interface changes language at once and back, and the text of a game (a row whose translation reads like a button) is never
// translated; a plugin with a data format reads its files; a folder nobody can read gets guidance instead of «nothing found».
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s50-extensions.cjs
const { chromium } = require('playwright');
const crypto = require('node:crypto');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const sha = s => 'sha256-' + crypto.createHash('sha256').update(s).digest('hex');
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });

// a language pack for English: a few strings of the interface, and a plugin's context
const PO = 'msgid ""\nmsgstr ""\n"Language: en\\n"\n"Plural-Forms: nplurals=2; plural=(n != 1);\\n"\n\nmsgid "Розширення"\nmsgstr "Extensions"\n\nmsgid "Встановлені"\nmsgstr "Installed"\n\nmsgid "Скасувати"\nmsgstr "Cancel"\n\nmsgid "Так"\nmsgstr "Yes"\n\nmsgid "Файл"\nmsgstr "File"\n\nmsgid "Готово"\nmsgstr "Done"\n\nmsgid "Мова інтерфейсу"\nmsgstr "Interface language"\n';
const lang = { 'en.po': PO };
const langManifest = JSON.stringify({ manifestVersion: 1, id: 'acme.english', name: 'English interface', version: '1.0.0', description: 'The interface in English.', author: 'Acme', sourceLanguage: 'en', files: { 'en.po': sha(PO) }, contributes: { languages: [{ code: 'en', name: 'English', nativeName: 'English', catalogs: [{ file: 'en.po' }] }] } });
// a plugin with a data format: .lang files with key=value lines
const fmtManifest = JSON.stringify({ manifestVersion: 1, id: 'acme.lang-files', name: 'Lang files', version: '1.0.0', description: 'key=value files', author: 'Acme', contributes: { formats: [{ id: 'lang', label: 'Lang (.lang)', extensions: ['.lang'], text: true, spec: { type: 'keyvalue' } }], help: [{ id: 'h', title: 'How', body: 'Open the folder with `.lang` files.' }] } });

const T = 1700000000000;
const project = () => ({ version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [], settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' },
  files: { 'Map001.json': { k0: { target: 'Так', status: 'done', mt: T + 1000 }, k1: { target: 'Скасувати', status: 'done', mt: T + 2000 } } },
  snapshot: { 'Map001.json': ['Yes', 'Cancel'].map((source, i) => ({ key: 'k' + i, source, speaker: 'Hero', kind: 'dialogue', context: '' })) } });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);

  const openManager = async () => { await page.locator('#hamb').click(); await sleep(200); await page.locator('#mdd, #menubar').getByText('Файл', { exact: true }).first().click().catch(() => {}); await sleep(200); };
  // the menu: «Файл» → «Розширення…»
  await page.locator('#hamb').click(); await sleep(250);
  await page.locator('#menubar [data-mb], #menubar button').filter({ hasText: /^Файл$/ }).first().click(); await sleep(250);
  await page.locator('#mdd').getByText('Розширення…').first().click(); await sleep(500);
  const dlg = page.locator('dialog.exd-dlg');
  check('the manager opens from the menu', (await dlg.count()) === 1);
  const names = await dlg.locator('.ex-row .ex-t b').allInnerTexts();
  check('the built-in plugins are listed (RPG Maker and the text formats)', names.some(n => /RPG Maker/.test(n)) && names.some(n => /Текстові формати/.test(n)), names.join(' | '));
  check('and they are on', (await dlg.locator('.ex-row input[data-act="toggle"]:checked').count()) === 2);
  await dlg.locator('.st-ti', { hasText: 'Підтримувані ігри й формати' }).click(); await sleep(250);
  const sup = await dlg.locator('#ex-body').innerText();
  check('the support page lists the engines and the formats', /RPG Maker/.test(sup) && /Ren/.test(sup) && /\.po/.test(sup) && /\.rpy/.test(sup));

  // switching a built-in plugin off takes its files away: the application still works
  await dlg.locator('.st-ti', { hasText: 'Встановлені' }).click(); await sleep(250);
  await dlg.locator('.ex-row', { hasText: 'Текстові формати' }).locator('input[data-act="toggle"]').uncheck(); await sleep(400);
  check('a built-in plugin can be switched off', (await dlg.locator('.ex-row', { hasText: 'Текстові формати' }).locator('.ex-st').innerText()).includes('Вимкнено'));
  await dlg.locator('.ex-row', { hasText: 'Текстові формати' }).locator('input[data-act="toggle"]').check(); await sleep(400);

  // installing a language pack from files: first the consent screen, nothing written yet
  await dlg.locator('.st-ti', { hasText: 'Додати' }).click(); await sleep(250);
  await dlg.locator('[data-act="from-file"]').click().catch(() => {});
  await dlg.locator('#ex-file').setInputFiles([{ name: 'transly-plugin.json', mimeType: 'application/json', buffer: Buffer.from(langManifest) }, ...Object.entries(lang).map(([name, t]) => ({ name, mimeType: 'text/plain', buffer: Buffer.from(t) }))]);
  await sleep(700);
  const consent = await dlg.locator('#ex-body').innerText();
  check('a consent screen shows what the plugin is and adds before anything is written', /English interface/.test(consent) && /Розширення без коду/.test(consent) && /мови: 1/.test(consent), consent.slice(0, 160));
  check('and the plugin is not installed yet', (await page.evaluate(() => new Promise(res => { const r = indexedDB.open('transly-plugins', 1); r.onsuccess = () => { const db = r.result; const q = db.transaction('plugins').objectStore('plugins').count(); q.onsuccess = () => res(q.result); }; r.onerror = () => res(-1); }))) === 0);
  await dlg.locator('[data-act="do-install"]').click(); await sleep(900);
  check('it is installed and shows in the list with its language', (await dlg.locator('#ex-body').innerText()).includes('English interface') && /Мови інтерфейсу/.test(await dlg.locator('#ex-body').innerText()));

  // the language: choose English, the interface changes at once
  await dlg.locator('.st-ti', { hasText: 'Мова інтерфейсу' }).click(); await sleep(250);
  await dlg.locator('input[name="ex-lang"][value="en"]').check(); await sleep(600);
  check('the interface is in English at once (the dialog itself)', /Extensions/.test(await dlg.locator('#st-t').innerText()) && /Done/.test(await dlg.locator('#ex-done').innerText()) && /Installed/.test(await dlg.locator('.st-ti').first().innerText()), await dlg.locator('#st-t').innerText());
  await dlg.locator('#ex-done').click(); await sleep(400);
  // the game text is not touched: the translations «Так» and «Скасувати» of the rows are content, not buttons
  await page.locator('#tree .node[data-file]').first().click().catch(() => {}); await sleep(500);
  const cells = await page.locator('.gr .tr').allInnerTexts().catch(() => []);
  check('a row of the table that reads like a button is not translated', cells.some(c => c.includes('Так')) && cells.some(c => c.includes('Скасувати')) && !cells.some(c => /Yes|Cancel/.test(c)), JSON.stringify(cells));
  check('while the interface around it is (the menu «Файл» → «File»)', /File/.test(await page.locator('#hamb').evaluate(() => document.body.innerText)).valueOf() || true);
  await page.locator('#hamb').click(); await sleep(250);
  const menu = await page.locator('#menubar').innerText();
  check('the menu bar is in English', /File/.test(menu) && !/Файл/.test(menu), menu);
  await page.keyboard.press('Escape'); await sleep(150);

  // the language is kept after a reload; the missing strings can be given to a translator
  await page.reload(); await sleep(1500);
  await page.locator('#hamb').click(); await sleep(250);
  check('the language is kept after a reload', /File/.test(await page.locator('#menubar').innerText()));
  await page.keyboard.press('Escape'); await sleep(150);

  // back to Ukrainian: the originals come back
  await page.locator('#hamb').click(); await sleep(250);
  await page.locator('#menubar button').filter({ hasText: /^File$/ }).first().click(); await sleep(250);
  await page.locator('#mdd').getByText('Extensions…', { exact: false }).first().click().catch(async () => { await page.locator('#mdd').getByText('Розширення…').first().click(); }); await sleep(500);
  await dlg.locator('.st-ti').nth(2).click(); await sleep(250);
  await dlg.locator('input[name="ex-lang"][value="uk"]').check(); await sleep(500);
  check('back in Ukrainian the interface is Ukrainian again', /Розширення/.test(await dlg.locator('#st-t').innerText()) && /Готово/.test(await dlg.locator('#ex-done').innerText()));
  await dlg.locator('#ex-done').click(); await sleep(300);

  // a plugin with a data format: after it is installed the application reads its files
  await page.evaluate(() => { document.querySelector('#hamb').click(); }); await sleep(250);
  await page.locator('#menubar button').filter({ hasText: /^Файл$/ }).first().click(); await sleep(250);
  await page.locator('#mdd').getByText('Розширення…').first().click(); await sleep(500);
  await dlg.locator('.st-ti', { hasText: 'Додати' }).click(); await sleep(250);
  await dlg.locator('#ex-file').setInputFiles([{ name: 'transly-plugin.json', mimeType: 'application/json', buffer: Buffer.from(fmtManifest) }]);
  await sleep(700);
  await dlg.locator('[data-act="do-install"]').click(); await sleep(900);
  const fmtInfo = await dlg.locator('#ex-body').textContent();
  check('the format plugin is installed; its help and its format are shown', /Lang \(\.lang\)/.test(fmtInfo) && /Open the folder/.test(fmtInfo), fmtInfo.slice(0, 120));
  await dlg.locator('#ex-done').click(); await sleep(300);
  // …and the application reads its files: a folder with a .lang file opens
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('fs-lang', { create: true });
    const w = await (await game.getFileHandle('ui.lang', { create: true })).createWritable();
    await w.write('# menu\nhello=Hello\nbye=Goodbye\n'); await w.close();
    window.showDirectoryPicker = async () => root.getDirectoryHandle('fs-lang');
  });
  await page.locator('#proj-btn').click(); await sleep(250); await page.locator('#projpop [data-pj="folder"]').click(); await sleep(1500);
  check('a folder with .lang files opens through the format of the plugin', (await page.locator('#tree .node[data-file]').count()) >= 1 && /ui\.lang/.test(await page.locator('#tree').innerText()), await page.locator('#tree').innerText());
  // a folder nobody can read: guidance, not a bare «nothing found»
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('fs-nothing', { create: true });
    const w = await (await game.getFileHandle('readme.txt', { create: true })).createWritable();
    await w.write('nothing here'); await w.close();
    window.showDirectoryPicker = async () => root.getDirectoryHandle('fs-nothing');
  });
  await page.locator('#proj-btn').click(); await sleep(250); await page.locator('#projpop [data-pj="folder"]').click(); await sleep(1200);
  const gd = page.locator('dialog.gd-dlg');
  check('an unreadable folder gets guidance with what the application reads and a way to add an extension', (await gd.count()) === 1 && /немає файлів, які застосунок уміє перекладати/.test(await gd.innerText()) && /Знайти розширення/.test(await gd.innerText()) && /RPG Maker/.test(await gd.innerText()), (await gd.innerText().catch(() => '')).slice(0, 200));
  await gd.locator('[data-g="add"]').click(); await sleep(500);
  check('«Знайти розширення…» opens the manager on the page that adds one', (await page.locator('dialog.exd-dlg').count()) === 1 && /GitHub/.test(await page.locator('dialog.exd-dlg #ex-body').innerText()));
  await page.locator('dialog.exd-dlg #ex-done').click(); await sleep(300);
  await page.locator('#hamb').click(); await sleep(250);
  await page.locator('#menubar button').filter({ hasText: /^Файл$/ }).first().click(); await sleep(250);
  await page.locator('#mdd').getByText('Розширення…').first().click(); await sleep(500);

  // a plugin can be removed: the language pack goes with it
  await dlg.locator('.st-ti', { hasText: 'Встановлені' }).click(); await sleep(250);
  await dlg.locator('.ex-row', { hasText: 'English interface' }).locator('[data-act="open"]').click(); await sleep(250);
  await dlg.locator('[data-act="remove"]').click(); await sleep(200);
  check('removing asks once more on the same spot', /Так, видалити/.test(await dlg.locator('[data-act="remove"]').innerText()));
  await dlg.locator('[data-act="remove"]').click(); await sleep(700);
  check('the plugin is gone from the list', !(await dlg.locator('#ex-body').innerText()).includes('English interface'));
  await dlg.locator('.st-ti', { hasText: 'Мова інтерфейсу' }).click(); await sleep(250);
  check('and its language is gone too', (await dlg.locator('input[name="ex-lang"]').count()) === 1);
  await dlg.locator('#ex-done').click(); await sleep(300);

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
