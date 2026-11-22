// Browser regression check: the autofill screen (PC). It is built like the merge screen: a table of the empty rows the app can fill, the source
// of each told by the dot, the match of the memory with its closeness, «−» and «+» to settle a row, the «Результат» cell written in place, a
// slider for the closeness from which a proposal is taken without asking, and a choice of what is learned from (sent rows or the drafts too).
// Nothing is written until «Вписати»; then the rows are drafts marked «авто», and «Скасувати» takes them back.
//   PC_URL=http://localhost:4285/ node test-ui/s57-autofill-screen.cjs
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
const files = { 'Map001.json': {} };
for (const [i, t] of Object.entries(done)) files['Map001.json']['k' + i] = { target: t, status: i === '8' || i === '14' ? 'draft' : 'done', mt: T };
const project = { version: 1, name: 'D', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [], settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' }, files };
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });
const stored = () => new Promise(r => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const g = o.result.transaction('projects').objectStore('projects').get('default'); g.onsuccess = () => r(JSON.parse(g.result)); }; });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 860 } })).newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(500);
  await page.evaluate(put, { text: JSON.stringify(project), snapshot: { 'Map001.json': rows } }); await page.reload(); await sleep(1300);
  await page.locator('[data-m="edit"]').click(); await sleep(300);
  const open = async () => { await page.locator('#hamb').click(); await sleep(250); await page.getByText('Інструменти', { exact: true }).first().click().catch(() => {}); await sleep(250); await page.getByText('Автозаповнення…').first().click(); await sleep(1500); };
  const list = () => page.evaluate(() => [...document.querySelectorAll('.mgx.af .gr')].map(r => ({ src: r.querySelector('.src').innerText, found: r.querySelector('.tr.fnd').innerText.replace(/\s+/g, ' '), res: r.querySelector('.res').innerText.replace(/\s+/g, ' '), dot: r.querySelector('.dot').className, yes: r.querySelector('.res').classList.contains('yes') })));
  await open();

  check('the screen takes the place of the work area; the top bar says «Автозаповнення» and has a way out', await page.evaluate(() => !!document.querySelector('.mgx.af') && /Автозаповнення/.test(document.getElementById('mcap').textContent) && !!document.getElementById('mg-close')));
  let l = await list();
  const by = s => l.filter(x => x.src.trim() === s);
  check('the right side is the island of the table of the project: the tabs of the files, the filter, the table with Ключ, Оригінал and Переклад', await page.evaluate(() => document.querySelectorAll('.mgx.af .tabs .tab').length === 2 && !!document.querySelector('.mgx.af .filters .qin') && [...document.querySelectorAll('.mgx.af .gh > div')].map(x => x.textContent.trim()).join('|').includes('Ключ|Оригінал · EN|Переклад · UK')));
  check('the left side is the tree of the files, as in the left panel: the card, the folders, the badge, the percent and its bar', await page.evaluate(() => !!document.querySelector('.mgx.af .mg-card .mg-ph') && !!document.querySelector('.mgx.af .node.dir[data-dir="data/maps"]') && !!document.querySelector('.mgx.af .node .ic.map') && !!document.querySelector('.mgx.af .node .pc') && !!document.querySelector('.mgx.af .node .mini')));
  check('rows with an original that was sent are filled whole, with the dot of the same originals', by('Hello').length === 1 && by('Hello')[0].res === 'Привіт' && /ok/.test(by('Hello')[0].dot) && by('Good morning')[0].res === 'Добрий ранок', JSON.stringify(l.slice(0, 3)));
  check('a swapped word is never close: «Red cow» after «Red cat» stays far below the slider, an added word («old») is close but under it', l.some(x => /^7\d%/.test(x.found) && /без рішення/.test(x.res) && /info/.test(x.dot)) && l.filter(x => /Red/.test(x.src)).every(x => /^(\d|[1-5]\d|6\d)%/.test(x.found) && !x.yes), JSON.stringify(l.filter(x => /info/.test(x.dot))));
  check('a draft is not a source: «Тіло» is not put on the long line, and no row is made of the draft «Великий меч»', !l.some(x => x.src.startsWith('The body')) && !l.some(x => /Big bow/.test(x.src)), JSON.stringify(l.map(x => x.src)));
  check('the rows settled by the slider are marked, the ones below are not', l.filter(x => x.yes).length === 2, String(l.filter(x => x.yes).length));
  check('the main button counts what is written', /Вписати як чернетки · 2/.test(await page.locator('#mg-go').innerText()), await page.locator('#mg-go').innerText());

  // the choice of what is learned from: the drafts too
  await page.locator('#af-bt-src').click(); await sleep(200); await page.locator('[data-src="drafts"]').click(); await sleep(1500);
  l = await list();
  check('with «Надісланих і чернеток» the draft is a source too: «Big bow» is composed (no: one word is a guess), the long line is still not filled with a word', !l.some(x => x.src.startsWith('The body')), JSON.stringify(l.map(x => x.src)));
  check('the choice stays for the next time', await page.evaluate(() => localStorage.getItem('transly.af.drafts') === '1'));
  await page.locator('#af-bt-src').click(); await sleep(200); await page.locator('[data-src="sent"]').click(); await sleep(1500);

  // the slider
  await page.locator('#af-bt-min').click(); await sleep(200); await page.locator('#af-min').fill('70'); await sleep(300);
  check('the slider lowers the bar: the matches of the memory above it are taken now', (await list()).filter(x => x.yes).length === 4 && /· 4/.test(await page.locator('#mg-go').innerText()));
  await page.locator('#af-min').fill('100'); await sleep(300);
  check('and at 100% only whole equal originals are taken', (await list()).filter(x => x.yes).length === 2);
  await page.locator('#af-min').fill('85'); await sleep(200); await page.keyboard.press('Escape'); await page.mouse.click(700, 700); await sleep(200);

  // «−» and «+», and the text written in place
  const row = n => page.locator('.mgx.af .gr').nth(n);
  await row(0).locator('[data-d="no"]').click(); await sleep(200);
  check('«−» leaves a row empty and says so', /пропущено/.test((await list())[0].res) && /· 1/.test(await page.locator('#mg-go').innerText()));
  await row(0).locator('[data-d="yes"]').click(); await sleep(200);
  const memRow = (await list()).findIndex(x => /info/.test(x.dot));
  await row(memRow).locator('.res').click(); await sleep(300);
  await page.locator('.mgx.af textarea.cell-ed').fill('Візьми старий ключ'); await page.keyboard.press('Enter'); await sleep(300);
  check('a click on «Результат» writes the row in place, and it is taken', (await list())[memRow].res === 'Візьми старий ключ' && (await list())[memRow].yes);

  // the fill
  await page.locator('#mg-go').click(); await sleep(800);
  check('the screen closes, a message says how many drafts were made and carries «Скасувати»', await page.evaluate(() => !document.querySelector('.mgx.af') && /Автозаповнено 3 рядки/.test(document.getElementById('toasts').innerText) && /Скасувати/.test(document.getElementById('toasts').innerText)), await page.evaluate(() => document.getElementById('toasts').innerText));
  let p = await page.evaluate(stored), e = p.files['Map001.json'];
  check('the rows are drafts with the text, in one action of the journal «autofill», the other rows are untouched', e.k2.target === 'Привіт' && e.k2.status === 'draft' && e[ 'k5'].target === 'Візьми старий ключ' && !e.k7 && !e.k9 && e.k3.target === 'Добрий ранок', JSON.stringify([e.k2, e.k5, e.k7]));
  check('the history says where each came from', /однакового рядка/.test(e.k2.history.at(-1).what) && /пам’яті/.test(e.k5.history.at(-1).what), JSON.stringify([e.k2.history.at(-1), e.k5.history.at(-1)]));
  check('and the batch is «autofill»', /^autofill:/.test(e.k2.history.at(-1).batch));
  await page.locator('#toasts .toast', { hasText: 'Автозаповнено' }).getByRole('button', { name: 'Скасувати' }).click(); await sleep(600);
  p = await page.evaluate(stored); e = p.files['Map001.json'];
  check('«Скасувати» takes them back', !e.k2.target && !e.k5.target, JSON.stringify([e.k2.target, e.k5.target]));

  // Esc closes it
  await open(); await page.keyboard.press('Escape'); await sleep(300);
  check('Esc closes the screen', await page.evaluate(() => !document.querySelector('.mgx.af') && !document.getElementById('mcap')));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
