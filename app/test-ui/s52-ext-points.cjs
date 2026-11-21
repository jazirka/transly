// Browser regression check: what a plugin without code brings besides formats and languages. The example «style-pack» is installed from its files; its
// rules of QA show in «Правила QA» and flag a row, its command is in the menu «Інструменти» and replaces after a preview (and undoes), its glossary is looked
// at and then added to the project (a term the project already has stays as it is), and when the plugin is switched off everything goes with it.
// Run as s0-safety.cjs:   PC_URL=http://localhost:4285/ node test-ui/s52-ext-points.cjs
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + String(detail).slice(0, 220) : '')); if (!ok) failed++; };
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });
const read = () => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const r = db.transaction('projects').objectStore('projects').get('default'); r.onsuccess = () => { db.close(); res(r.result); }; r.onerror = () => rej(r.error); }; o.onerror = () => rej(o.error); });

const DIR = path.join(__dirname, '..', 'examples', 'plugins', 'style-pack');
const pack = [['transly-plugin.json', 'application/json'], ['help/guide.md', 'text/markdown'], ['terms.tsv', 'text/tab-separated-values']].map(([n, t]) => ({ name: n, mimeType: t, buffer: fs.readFileSync(path.join(DIR, n)) }));

const T = 1700000000000;
const project = () => ({ version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [{ en: 'Sword', uk: 'шабля', mt: T }], settings: { tolerancePct: 100, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' },
  files: { 'Map001.json': { k0: { target: 'Це круто...', status: 'draft', mt: T + 1000 }, k1: { target: 'Так - ок.', status: 'draft', mt: T + 2000 }, k2: { target: 'Гаразд.', status: 'draft', mt: T + 3000 } } },
  snapshot: { 'Map001.json': ['This is cool...', 'Yes - ok.', 'Fine.'].map((source, i) => ({ key: 'k' + i, source, speaker: 'Hero', kind: 'dialogue', context: '' })) } });

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
  const closeDlg = async () => { await page.keyboard.press('Escape'); await sleep(300); if (await page.locator('dialog[open]').count()) { await page.keyboard.press('Escape'); await sleep(300); } };

  // install the example from its files
  await menu('Файл'); await page.locator('#mdd').getByText('Розширення…').first().click(); await sleep(500);
  const dlg = page.locator('dialog.exd-dlg');
  await dlg.locator('.st-ti', { hasText: 'Додати' }).click(); await sleep(250);
  await dlg.locator('#ex-file').setInputFiles(pack); await sleep(800);
  const consent = await dlg.locator('#ex-body').innerText();
  check('the consent screen says what the plugin adds (rules, commands, glossaries)', /правила QA: 4/.test(consent) && /команди: 3/.test(consent) && /словники: 2/.test(consent), consent.replace(/\s+/g, ' '));
  await dlg.locator('[data-act="do-install"]').click(); await sleep(900);
  await dlg.locator('.st-ti', { hasText: 'Встановлені' }).click(); await sleep(250);
  await dlg.locator('.ex-row', { hasText: 'Style pack' }).locator('[data-act="open"]').first().click(); await sleep(400);
  const det = await dlg.locator('#ex-body').innerText();
  check('its page lists the rules, the commands and the glossaries', /Правила QA/.test(det) && /No slang/.test(det) && /Tidy punctuation/.test(det) && /Forms of address/.test(det) && /Fantasy basics/.test(det), det.replace(/\s+/g, ' ').slice(0, 200));

  // a glossary: looked at first; a term the project already has is kept as it is
  await dlg.locator('[data-act="add-gloss"][data-gloss="fantasy"]').click(); await sleep(500);
  const gl = await page.locator('dialog[open]').last().innerText();
  check('the glossary is shown before it is added: three terms are new, «sword» the project translates differently and keeps', /Нових термінів: 3/.test(gl) && /інакше \(лишаються як є\): 1/.test(gl) && /shield/.test(gl), gl.replace(/\s+/g, ' ').slice(0, 200));
  await page.locator('#xg-go').click(); await sleep(700);
  await dlg.locator('[data-act="add-gloss"][data-gloss="forms-of-address"]').click(); await sleep(500);
  const gl2 = await page.locator('dialog[open]').last().innerText();
  check('the other list is all new («Sir» and «Madam»)', /Нових термінів: 2/.test(gl2), gl2.replace(/\s+/g, ' ').slice(0, 160));
  await page.locator('#xg-go').click(); await sleep(900);
  const saved = JSON.parse(await page.evaluate(read));
  const byEn = Object.fromEntries(saved.terms.map(t => [t.en, t]));
  check('the new terms are in the project, with their alternatives', byEn.shield?.uk === 'щит' && byEn.shield.alt?.includes('буклер') && byEn.Sir?.uk === 'пане' && byEn.Madam?.alt?.[0] === 'мадам', Object.keys(byEn).join(','));
  check('and the term the project had is untouched', byEn.Sword?.uk === 'шабля' && !saved.terms.some(t => t.en === 'sword' && t.uk === 'меч'), JSON.stringify(byEn.Sword));
  await page.locator('dialog.exd-dlg #ex-done').click(); await sleep(400);

  // the menu: the command with the name of the plugin
  await menu('Інструменти');
  const items = await page.locator('#mdd .mi').allInnerTexts();
  check('the menu «Інструменти» has the commands of the plugin, with its name', items.some(x => /Tidy punctuation/.test(x) && /Style pack/.test(x)) && items.some(x => /House style guide/.test(x)), items.join(' | ').replace(/\s+/g, ' '));

  // the rules of QA
  await page.locator('#mdd .mi', { hasText: 'Правила QA' }).first().click(); await sleep(600);
  const qr = await page.locator('dialog[open]').last().innerText();
  check('the rules of the plugin are listed in «Правила QA» with the name of the plugin', /No slang/.test(qr) && /розширення «Style pack»/.test(qr) && /Names fit the menu/.test(qr), qr.replace(/\s+/g, ' ').slice(0, 200));
  await closeDlg();

  // the command: preview, then replace, then undo
  await menu('Інструменти');
  await page.locator('#mdd .mi', { hasText: 'Tidy punctuation' }).first().click(); await sleep(600);
  const pv = await page.locator('#xr-list').innerText();
  check('the replacing command shows what it would change before it does anything', /Це круто\.\.\./.test(pv) && /Це круто…/.test(pv) && /Так — ок\./.test(pv) && !/Гаразд/.test(pv), pv.replace(/\s+/g, ' '));
  let now = JSON.parse(await page.evaluate(read));
  check('nothing was written yet', now.files['Map001.json'].k0.target === 'Це круто...');
  await page.locator('#xr-go').click(); await sleep(900);
  now = JSON.parse(await page.evaluate(read));
  check('after «Замінити вибрані» the translations are changed', now.files['Map001.json'].k0.target === 'Це круто…' && now.files['Map001.json'].k1.target === 'Так — ок.', JSON.stringify(now.files['Map001.json']).slice(0, 160));
  await page.keyboard.press('Control+z'); await sleep(900);
  now = JSON.parse(await page.evaluate(read));
  check('and Ctrl+Z puts them back, as with any mass action', now.files['Map001.json'].k0.target === 'Це круто...' && now.files['Map001.json'].k1.target === 'Так - ок.', JSON.stringify(now.files['Map001.json']).slice(0, 160));

  // the help command opens a dialog with the topic
  await menu('Інструменти');
  await page.locator('#mdd .mi', { hasText: 'House style guide' }).first().click(); await sleep(500);
  const hp = await page.locator('dialog[open]').last().innerText();
  check('the help command opens the topic of the plugin', /keeps a translation in one voice/.test(hp) && /No slang/.test(hp), hp.replace(/\s+/g, ' ').slice(0, 120));
  await closeDlg();

  // switched off: the commands and the rules go with it
  await menu('Файл'); await page.locator('#mdd').getByText('Розширення…').first().click(); await sleep(500);
  const d2 = page.locator('dialog.exd-dlg');
  await d2.locator('.ex-row', { hasText: 'Style pack' }).locator('input[data-act="toggle"]').uncheck(); await sleep(500);
  await d2.locator('#ex-done').click(); await sleep(400);
  await menu('Інструменти');
  const items2 = await page.locator('#mdd .mi').allInnerTexts();
  check('switched off, the plugin leaves the menu', !items2.some(x => /Tidy punctuation/.test(x)), items2.join(' | ').replace(/\s+/g, ' '));
  await page.locator('#mdd .mi', { hasText: 'Правила QA' }).first().click(); await sleep(600);
  const qr2 = await page.locator('dialog[open]').last().innerText();
  check('and its rules leave «Правила QA»', !/No slang/.test(qr2), qr2.replace(/\s+/g, ' ').slice(0, 120));
  await closeDlg();
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
