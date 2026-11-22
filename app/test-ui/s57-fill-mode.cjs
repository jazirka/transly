// Browser regression check: the autofill is a mode of the table of the project (PC). Switched on from «Інструменти → Автозаповнення…», it shows what it can
// write in the «Переклад» cell of the empty rows, in grey, with the dot of the source (the same original that was sent, the translation memory with how close
// it is, the words), and a bar over the table with the count, the closeness the slider takes without asking, what is learned from, and «Вписати».
// Nothing is written until then; the rows are drafts marked «авто» (one action of the journal «autofill»), and «Скасувати» takes them back.
//   PC_URL=http://localhost:4285/ node test-ui/s57-fill-mode.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const T = 1700000000000;
const LONG = 'The body of the bobby was still pulsating steadily, but now it stopped.';
const src = ['Hello', 'Good morning', 'Hello', 'Good morning', 'Take the key', 'Take the old key', 'Open the door', 'Open the old door', LONG, LONG, 'Red cat', 'Red dog', 'Red cow', 'Red rat', 'Big sword', 'Big bow'];
const rows = src.map((s, i) => ({ key: 'k' + i, source: s, speaker: '', kind: 'dialogue', context: '' }));
const done = { 0: 'Привіт', 1: 'Добрий ранок', 4: 'Візьми ключ', 6: 'Відкрий двері', 8: 'Тіло', 10: 'Руда кішка', 11: 'Руда собака', 14: 'Великий меч' };
const files = { 'Map001.json': {}, 'Map002.json': {} };
for (const [i, t] of Object.entries(done)) files['Map001.json']['k' + i] = { target: t, status: i === '8' || i === '14' ? 'draft' : 'done', mt: T };
const project = { version: 1, name: 'D', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [], settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' }, files };
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });
const stored = () => new Promise(r => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const g = o.result.transaction('projects').objectStore('projects').get('default'); g.onsuccess = () => r(JSON.parse(g.result)); }; });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 860 } })).newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(500);
  await page.evaluate(put, { text: JSON.stringify(project), snapshot: { 'Map001.json': rows, 'Map002.json': [{ key: 'm0', source: 'Hello', speaker: '', kind: 'dialogue', context: '' }, { key: 'm1', source: 'Zebra', speaker: '', kind: 'dialogue', context: '' }] } }); await page.reload(); await sleep(1300);
  await page.locator('[data-m="table"]').click().catch(() => {}); await sleep(300);
  await page.locator('#hamb').click(); await sleep(250); await page.getByText('Інструменти', { exact: true }).first().click().catch(() => {}); await sleep(250); await page.getByText('Автозаповнення…').first().click(); await sleep(1800);
  const cells = () => page.evaluate(() => [...document.querySelectorAll('#grid .gr')].map(r => ({ src: r.querySelector('.src').innerText.trim(), tr: (r.querySelector('.tr .fl') ?? r.querySelector('.tr')).innerText.replace(/\s+/g, ' ').trim(), fl: r.querySelector('.tr .fl')?.className ?? '', dot: r.querySelector('.tr .fl .dot')?.className ?? '', len: r.querySelector('.len').innerText.trim() })));

  const bar = await page.evaluate(() => { const b = document.getElementById('fillbar'); return { shown: !b.hidden, text: b.innerText.replace(/\s+/g, ' ') }; });
  check('the bar of the autofill is over the table of the project, with the count', bar.shown && /Автозаповнення/.test(bar.text) && /Знайдено \d+/.test(bar.text), bar.text);
  check('it is still the table of the project: the tabs, the filter, the columns', await page.evaluate(() => !!document.querySelector('.tabs .tab') && !!document.querySelector('#q') && /Ключ[\s\S]*Оригінал[\s\S]*Переклад/.test(document.querySelector('#grid .gh').innerText)));
  let c = await cells();
  const by = s => c.filter(x => x.src === s);
  const by0 = (list, s) => list.filter(x => x.src === s);
  check('a line whose original was sent shows its translation in grey, with the dot of the same originals', by('Hello').some(x => x.tr === 'Привіт' && /ok/.test(x.dot)) && by('Good morning').some(x => x.tr === 'Добрий ранок'), JSON.stringify(by('Hello')));
  check('the memory shows how close it is: «Take the old key» is 75% and stays below the slider', by('Take the old key').some(x => /^7\d%$/.test(x.len) && /info/.test(x.dot) && !/yes/.test(x.fl)), JSON.stringify(by('Take the old key')));
  check('a swapped word is never close, a draft is not a source', c.filter(x => /^Red (cow|rat)/.test(x.src)).every(x => !/yes/.test(x.fl)) && !c.some(x => x.src.startsWith('The body') && x.fl) && !by('Big bow').some(x => x.fl), JSON.stringify(c.filter(x => x.fl).map(x => x.src + ':' + x.len)));
  check('what the slider takes is marked, and the button counts it', c.filter(x => /yes/.test(x.fl)).length === 2 && /· 3/.test(await page.locator('#fb-go').innerText()), await page.locator('#fb-go').innerText());


  // «−» and «+» on a row, the find edited in the cell, the filter and the tabs
  const rowOf = src => page.locator('#grid .gr', { has: page.locator('.fl'), hasText: src }).first();
  await rowOf('Open the old door').locator('[data-fd="yes"]').click(); await sleep(300);
  c = await cells();
  check('«+» takes a find that the slider leaves grey, and the button counts it', by0(c, 'Open the old door').some(x => /yes/.test(x.fl)) && /· 4/.test(await page.locator('#fb-go').innerText()), await page.locator('#fb-go').innerText());
  await rowOf('Open the old door').locator('[data-fd="yes"]').click(); await sleep(300);
  check('pressing it again lets the decision go: the slider decides again', !by0(await cells(), 'Open the old door').some(x => /yes/.test(x.fl)) && /· 3/.test(await page.locator('#fb-go').innerText()));
  await rowOf('Good morning').locator('[data-fd="no"]').click(); await sleep(300);
  check('«−» leaves a row empty: its find is struck through and not counted', (await cells()).filter(x => x.src === 'Good morning').some(x => /no/.test(x.fl)) && /· 2/.test(await page.locator('#fb-go').innerText()), await page.locator('#fb-go').innerText());
  await rowOf('Good morning').locator('[data-fd="no"]').click(); await sleep(300);
  await rowOf('Open the old door').locator('.tr').click({ position: { x: 20, y: 10 } }); await sleep(400);
  check('a click on the cell opens it with the find in it', await page.evaluate(() => document.querySelector('#grid textarea.cell-ed')?.value) === 'Відкрий двері');
  await page.locator('#grid textarea.cell-ed').fill('Відкрий стару браму'); await page.keyboard.press('Escape'); await page.mouse.click(1000, 780); await sleep(300);
  check('Esc leaves the find as it was', (await cells()).filter(x => x.src === 'Open the old door').every(x => x.tr === 'Відкрий двері'));
  await rowOf('Open the old door').locator('.tr').click({ position: { x: 20, y: 10 } }); await sleep(400);
  await page.locator('#grid textarea.cell-ed').fill('Відкрий стару браму'); await page.mouse.click(1000, 780); await sleep(400);
  const own = (await cells()).filter(x => x.src === 'Open the old door')[0];
  check('what is written there settles the find: it is the text now, and it is taken, but not written to the project', own && own.tr === 'Відкрий стару браму' && /yes/.test(own.fl) && !(await page.evaluate(stored)).files['Map001.json'].k7, JSON.stringify(own));
  await page.locator('#fb-only').click(); await sleep(400);
  check('«Лише з пропозиціями» leaves in the table only the rows that have a find', await page.evaluate(() => [...document.querySelectorAll('#grid .gr')].every(r => !!r.querySelector('.fl'))) && (await cells()).length === 6, String((await cells()).length));
  await page.locator('#fb-only').click(); await sleep(300);
  check('the tab of a file says how many finds it has', (await page.evaluate(() => [...document.querySelectorAll('.tabs .tab')].map(t => t.innerText.replace(/\s+/g, ' ')).join('|'))).includes('+6'));
  await page.locator('#fb-next').click(); await sleep(900);
  check('«Наступний файл» opens the next file that has a find', await page.evaluate(() => /Map002/.test(document.querySelector('.tabs .tab.on')?.innerText ?? '')) && (await cells()).some(x => x.src === 'Hello' && /ok/.test(x.dot)), await page.evaluate(() => document.querySelector('.tabs .tab.on')?.innerText));
  await page.locator('#fb-next').click(); await sleep(900);

  // the keys on selected rows
  const bb = await page.locator('#grid .gr .ln').nth(2).boundingBox(), bb2 = await page.locator('#grid .gr .ln').nth(5).boundingBox();
  await page.mouse.move(bb.x + 6, bb.y + 8); await page.mouse.down(); await page.mouse.move(bb2.x + 6, bb2.y + 8, { steps: 5 }); await page.mouse.up(); await sleep(200);
  const cnt = async () => Number((await page.locator('#fb-go').innerText()).match(/· (\d+)/)[1]);
  const c0 = await cnt();
  await page.keyboard.press('-'); await sleep(400);
  const c1 = await cnt();
  check('«−» on the selected rows settles their finds at once', c1 < c0, c0 + ' → ' + c1);
  await page.keyboard.press('+'); await sleep(400);
  check('«+» takes them all back', (await cnt()) > c1, String(await cnt()));
  await page.locator('#bb-clear').click(); await sleep(200);
  await page.keyboard.press('-'); await page.keyboard.press('-'); await sleep(100);

  // the slider
  await page.locator('#fb-min').click(); await sleep(200); await page.locator('#fb-range').fill('70'); await sleep(400);
  c = await cells();
  check('the slider lowers the bar: the 75% and 76% finds are taken now', c.filter(x => /yes/.test(x.fl)).length === 4 && /· 5/.test(await page.locator('#fb-go').innerText()), await page.locator('#fb-go').innerText());
  await page.locator('#fb-range').fill('85'); await sleep(300); await page.keyboard.press('Escape'); await page.mouse.click(800, 800); await sleep(200);

  // what is learned from
  await page.locator('#fb-src').click(); await sleep(200); await page.locator('[data-fsrc="drafts"]').click(); await sleep(1800);
  check('with the drafts as a source the choice stays for the next time, and the long line is still not given a word', await page.evaluate(() => localStorage.getItem('transly.af.drafts') === '1') && !(await cells()).some(x => x.src.startsWith('The body') && x.fl));
  await page.locator('#fb-src').click(); await sleep(200); await page.locator('[data-fsrc="sent"]').click(); await sleep(1800);

  // the fill
  await page.locator('#fb-go').click(); await sleep(900);
  check('a message says how many drafts were made, with «Скасувати»; the bar is gone', await page.evaluate(() => document.getElementById('fillbar').hidden && /Автозаповнено 3 рядки/.test(document.getElementById('toasts').innerText) && /Скасувати/.test(document.getElementById('toasts').innerText)), await page.evaluate(() => document.getElementById('toasts').innerText));
  let e = (await page.evaluate(stored)).files['Map001.json'];
  check('the rows are drafts with the text, in one action of the journal «autofill»; the rest are untouched', e.k2.target === 'Привіт' && e.k2.status === 'draft' && e.k3.target === 'Добрий ранок' && !e.k5 && !e.k9 && /^autofill:/.test(e.k2.history.at(-1).batch) && /однакового рядка/.test(e.k2.history.at(-1).what), JSON.stringify(e.k2));
  await page.locator('#toasts .toast', { hasText: 'Автозаповнено' }).getByRole('button', { name: 'Скасувати' }).click(); await sleep(600);
  e = (await page.evaluate(stored)).files['Map001.json'];
  check('«Скасувати» takes them back', !e.k2?.target && !e.k3?.target, JSON.stringify([e.k2, e.k3]));

  // Esc puts the mode away
  await page.locator('#hamb').click(); await sleep(250); await page.getByText('Інструменти', { exact: true }).first().click().catch(() => {}); await sleep(250); await page.getByText('Автозаповнення…').first().click(); await sleep(1500);
  await page.keyboard.press('Escape'); await sleep(300);
  check('Esc puts the mode away: no bar, no grey finds', await page.evaluate(() => document.getElementById('fillbar').hidden && !document.querySelector('#grid .fl')));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
