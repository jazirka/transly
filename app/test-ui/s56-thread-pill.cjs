// Browser regression check: the pill on the thread of a term (PC). The renderings are chips, a click puts one into the translation in the
// case the word stands in; the gender and the comment of the term are written on the spot; a term the translation lacks has its pill under
// the word; the old card with its long lines is gone for the terms of the editor.
//   PC_URL=http://localhost:4285/ node test-ui/s56-thread-pill.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const T = 1700000000000;
const rows = [{ key: 'k0', source: 'When the old hunter reached the cottage, he told the boy that he must take the \\c[2]Bear trap\\c[0] back to the village.', speaker: 'Hero', kind: 'dialogue', context: 'EV030' }];
const project = { version: 1, name: 'D', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [{ en: 'Bear trap', uk: 'ведмежий капкан', mt: T }, { en: 'boy', uk: 'хлопчик', alt: ['хлопець', 'малий'], mt: T }], settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' }, files: { 'Map055.json': { k0: { target: 'Коли старий мисливець дійшов до хатини, він сказав хлопчикові, що той мусить віднести це до села. ', status: 'draft', mt: T } } } };
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });
const stored = () => new Promise(r => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const g = o.result.transaction('projects').objectStore('projects').get('default'); g.onsuccess = () => r(JSON.parse(g.result)); }; });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 760 } })).newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(500);
  await page.evaluate(put, { text: JSON.stringify(project), snapshot: { 'Map055.json': rows } }); await page.reload(); await sleep(1300);
  await page.locator('[data-m="edit"]').click(); await sleep(300);
  await page.locator('#tree .node[data-file]').first().click({ timeout: 2000 }).catch(() => {}); await sleep(200);
  await page.locator('#slist .si').first().click({ timeout: 2000 }).catch(() => {}); await sleep(500);

  // the numbers are always there: on the word of the original, on its place in the translation and on its chip
  const nums = await page.evaluate(() => ({ src: [...document.querySelectorAll('#f-src [data-tn]')].map(e => e.dataset.tn), tr: [...document.querySelectorAll('#te-layer [data-tn]')].map(e => e.dataset.tn), chip: [...document.querySelectorAll('.thc2-dot')].map(e => e.textContent) }));
  check('the terms are numbered in the original, the translation and on the chips', JSON.stringify(nums.src) === '["1","2"]' && JSON.stringify(nums.tr) === '["1"]' && nums.chip.join() === '1,2', JSON.stringify(nums));

  // hover: the pill, the dashed thread, and no card with long lines
  await page.locator('#f-src .th[data-term="boy"]').first().hover(); await sleep(600);
  const a = await page.evaluate(() => ({ pill: !document.getElementById('thread-pill').hidden, chips: [...document.querySelectorAll('#thread-pill .tp-c')].map(e => e.textContent.trim()), hot: [...document.querySelectorAll('#te-links path.hot')].length, card: !!document.getElementById('termcard') && !document.getElementById('termcard').hidden, lines: document.querySelectorAll('#card-links path').length }));
  check('the pill opens on the term, with the renderings as chips', a.pill && a.chips.length === 3 && a.chips[0].startsWith('хлопчик'), JSON.stringify(a));
  check('the thread is lit while the pill is open, and the old card is not there', a.hot === 1 && !a.card && a.lines === 0, JSON.stringify(a));
  // the pill hangs on the middle of the thread
  const geo = await page.evaluate(() => { const p = document.getElementById('thread-pill').getBoundingClientRect(), path = document.querySelector('#te-links path.hot'), b = document.getElementById('te-links').getBoundingClientRect(), m = path.getPointAtLength(path.getTotalLength() / 2); return { px: p.left + p.width / 2, py: p.top, pb: p.top + (p.height > 40 ? 15 : p.height / 2), mx: b.left + m.x, my: b.top + m.y }; });
  check('the pill is on the middle of the thread (the same x within the screen edge limits, the middle of the thread inside its first row)', Math.abs(geo.my - geo.pb) < 6 && (Math.abs(geo.px - geo.mx) < 8 || geo.px < 400 || geo.px > 1000), JSON.stringify(geo));

  // the pointer goes to the pill: it stays, and so does the thread
  const box = await page.locator('#thread-pill').boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + 8); await sleep(500);
  check('it stays when the pointer is on it, with the thread', await page.evaluate(() => !document.getElementById('thread-pill').hidden && document.querySelectorAll('#te-links path.hot').length === 1));

  // a chip puts the rendering in, in the case of the word
  await page.locator('#thread-pill [data-tp="v"][data-i="1"]').click(); await sleep(400);
  const val = await page.inputValue('#i-tr');
  check('a click on «хлопець» puts «хлопцеві» (the case stays) in the place of «хлопчикові»', val.includes('сказав хлопцеві,') && !val.includes('хлопчикові'), val);

  // the gender and the comment on the spot
  await page.locator('#thread-pill [data-tp="more"]').click(); await sleep(200);
  await page.locator('#thread-pill [data-tp="g"][data-v="m"]').click(); await sleep(150);
  await page.locator('#thread-pill .tp-note').fill('Слуга, не «син».');
  await page.locator('#thread-pill [data-tp="save"]').click(); await sleep(500);
  const t = (await page.evaluate(stored)).terms.find(x => x.en === 'boy');
  check('the gender and the comment are saved, the alternatives and the rest stay', t.gender === 'm' && t.note === 'Слуга, не «син».' && t.alt.join() === 'хлопець,малий' && t.uk === 'хлопчик', JSON.stringify(t));
  check('the pill shows the gender', (await page.locator('#thread-pill .tp-m').innerText()).startsWith('ч'));

  // Esc puts the pill away
  await page.keyboard.press('Escape'); await sleep(200);
  check('Esc closes the pill', await page.evaluate(() => document.getElementById('thread-pill').hidden));

  // a term the translation lacks: no thread, the pill is under the word, a chip puts the rendering in at the end
  await page.locator('#f-src .th[data-term="Bear trap"]').first().hover(); await sleep(600);
  const m = await page.evaluate(() => { const p = document.getElementById('thread-pill'), w = document.querySelector('#f-src .th[data-term="Bear trap"]').getBoundingClientRect(), r = p.getBoundingClientRect(); return { shown: !p.hidden, lines: document.querySelectorAll('#te-links path.hot').length, under: r.top >= w.bottom - 1, hollow: getComputedStyle(document.querySelector('#f-src .th[data-term="Bear trap"]'), '::after').boxShadow !== 'none' }; });
  check('a term the translation lacks has no thread, and its pill stands under the word', m.shown && m.lines === 0 && m.under && m.hollow, JSON.stringify(m));
  await page.locator('#thread-pill [data-tp="v"]').first().click(); await sleep(400);
  check('its chip puts the rendering in at the end', (await page.inputValue('#i-tr')).trim().endsWith('ведмежий капкан'));

  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
