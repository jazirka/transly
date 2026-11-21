// Browser regression check: «Внески» under the field of the editing view: the translations of the row that were sent, a card for each send of each translator (the newest first, several
// from one translator all there), with a button that puts one into the field; the related things and the discussion stay in the panel on the right (three tabs on its rail).
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s43-variants.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const T = 1700000000000;
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' },
  files: { 'Map001.json': { k0: { target: 'Нокаут', status: 'done', mt: T + 3000, history: [
    { at: T, who: 'Оля', what: 'надіслано', text: 'Удар' },
    { at: T + 1000, who: 'Ви', what: 'правка', text: 'Нокаут!' },
    { at: T + 2000, who: 'Ви', what: 'надіслано', text: 'Нокдаун' },
    { at: T + 3000, who: 'Ви', what: 'надіслано', text: 'Нокаут' },
  ] } } },
  snapshot: { 'Map001.json': ['Knockout', 'Another line here'].map((source, i) => ({ key: 'k' + i, source, speaker: 'Hero', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  await page.locator('#lp-rows .si').first().click(); await sleep(600);

  const cards = () => page.locator('#f-var .var').evaluateAll(els => els.map(e => ({ who: e.querySelector('b').textContent, text: e.querySelector('.var-t').textContent, cur: e.classList.contains('cur'), btn: e.querySelector('[data-vr]').getAttribute('aria-label'), on: e.querySelector('[data-vr]').getAttribute('aria-checked') === 'true', binOff: e.querySelector('[data-vd]').disabled, up: e.querySelector('[data-vv=up] b').textContent, down: e.querySelector('[data-vv=down] b').textContent, upOn: e.querySelector('[data-vv=up]').classList.contains('on') })));
  let c = await cards();
  check('«Внески» stands under the field and lists the sent translations, the newest first (the draft edit is not among them)', c.map(x => `${x.who}:${x.text}`).join('|') === 'Ви:Нокаут|Ви:Нокдаун|Оля:Удар', JSON.stringify(c));
  check('each card has its votes, the tick (not ticked: the row is only sent) and the bin (not for the translation the row holds)', c.every(x => x.up === '0' && x.down === '0') && c.every(x => x.btn === 'Затвердити' && !x.on) && c[0].cur && !c[1].cur && c[0].binOff && !c[1].binOff, JSON.stringify(c));
  check('the card has its title with the count', /Внески\s*3/i.test(await page.locator('#f-var > .lbl').innerText()));
  // the four buttons of a card are one family: the same height and outline, and the vote signs are drawn (+ and − of the same size and stroke), not typed
  const fam = await page.evaluate(() => [...document.querySelectorAll('#f-var .var:first-child .vt, #f-var .var:first-child .ck, #f-var .var:first-child .vd')].map(e => { const cs = getComputedStyle(e), r = e.getBoundingClientRect(); return { h: Math.round(r.height), bw: cs.borderTopWidth, br: cs.borderTopLeftRadius, svg: !!e.querySelector('svg'), text: [...e.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('') }; }));
  check('the vote, the tick and the bin buttons are 28 px high, outlined, with the same radius, and have drawn signs (no ▲ ▼ typed)', fam.length === 4 && fam.every(x => x.h === 28 && x.bw === '1px' && x.br === fam[0].br && x.svg && x.text === ''), JSON.stringify(fam));
  // votes: + counts, the same click takes it back, − replaces it
  await page.locator('#f-var .var').nth(2).locator('[data-vv=up]').click(); await sleep(400);
  c = await cards();
  check('+ adds a vote of mine to that contribution only', c[2].up === '1' && c[2].upOn && c[0].up === '0' && c[1].up === '0', JSON.stringify(c));
  await page.locator('#f-var .var').nth(2).locator('[data-vv=down]').click(); await sleep(400);
  c = await cards();
  check('− replaces my vote: one against, none for', c[2].up === '0' && c[2].down === '1' && !c[2].upOn, JSON.stringify(c));
  await page.locator('#f-var .var').nth(2).locator('[data-vv=down]').click(); await sleep(400);
  c = await cards();
  check('the same click again takes the vote back', c[2].up === '0' && c[2].down === '0', JSON.stringify(c));
  await page.locator('#f-var .var').nth(0).locator('[data-vv=up]').click(); await sleep(400);
  check('a vote does not change the translation of the row or its status', (await page.locator('#i-tr').inputValue()) === 'Нокаут' && (await page.locator('#f-var .var.cur [data-vr]').getAttribute('aria-checked')) === 'false', await page.locator('#i-tr').inputValue());
  // «Затвердити» of a contribution that is not the row's text: it goes into the row and the row is proofread
  await page.locator('#f-var .var').nth(2).locator('[data-vr]').click(); await sleep(700);
  check('the tick of a contribution puts it into the row', (await page.locator('#i-tr').inputValue()) === 'Удар', await page.locator('#i-tr').inputValue());
  c = await cards();
  check('and the row is proofread: that contribution is marked current and its tick is on', c.some(x => x.cur && x.text === 'Удар' && x.on && x.btn === 'Затверджено'), JSON.stringify(c));
  check('approving does not make a second card of the same text: the credit stays with the one who sent it (Оля), three cards', c.length === 3 && c.find(x => x.cur).who === 'Оля', JSON.stringify(c));

  // the bin takes a contribution off the card (not the history); the toast puts it back
  await page.locator('#f-var .var').nth(1).locator('[data-vd]').click(); await sleep(500);
  c = await cards();
  check('the bin takes the contribution off the card', c.length === 2 && !c.some(x => x.text === 'Нокдаун'), JSON.stringify(c));
  await page.locator('#toasts .toast', { hasText: 'Внесок прибрано' }).getByRole('button', { name: 'Скасувати' }).click(); await sleep(500);
  c = await cards();
  check('«Скасувати» in the toast puts it back', c.length === 3 && c.some(x => x.text === 'Нокдаун'), JSON.stringify(c));
  // the tick of the approved contribution takes the approval back
  await page.locator('#f-var .var.cur [data-vr]').click(); await sleep(600);
  c = await cards();
  check('the tick of the approved one sends the row back to a draft (none of the contributions is the row\'s sent text now), the field keeps the text', c.every(x => !x.cur && !x.on) && (await page.locator('#i-tr').inputValue()) === 'Удар', JSON.stringify(c));

  // the related things and the discussion are on the right
  const rail = await page.locator('#stabs [data-p]').evaluateAll(els => els.map(e => e.dataset.p));
  check('the rail of the right panel has three tabs: the activity, the related things and the discussion (no «Рядок»)', rail.join() === 'act,rel,cm', rail.join());
  check('the related things stand in the right panel, not under the field', (await page.locator('#f-threads').count()) === 0 && (await page.locator('#f-var .thc2, #f-var .thb').count()) === 0 && (await page.locator('.pn-sec[data-sec="th"]').count()) === 1);
  check('the discussion is the second tab of the right panel (not under the field)', (await page.locator('#f-var #cm-in').count()) === 0 && (await page.locator('.fs #cm-in').count()) === 1);
  // the tabs are independent toggles: the activity is open from the start, a click would close it
  if (!(await page.locator('#stabs [data-p="act"]').evaluate(e => e.classList.contains('on')))) await page.locator('#stabs [data-p="act"]').click();
  await sleep(300);
  check('the activity of the row (the earlier translations with what was added and deleted) is in the panel too, grouped by the day, each record with its icon and its time', (await page.locator('.pn-sec[data-sec="ac"]').isVisible()) && (await page.locator('#rp-title').innerText()).toLowerCase().startsWith('активність') && (await page.locator('#hist-list .ac-d').count()) >= 1 && (await page.locator('#hist-list .ac-i .ac-ic svg').count()) >= 3 && (await page.locator('#hist-list .ac-i time').count()) >= 3);
  check('the right panel has no card or line of the state of the row («Стан і дії») in any view: the field and the contributions are the translation', (await page.locator('.pn-sec[data-sec="tr"], .pn-ver').count()) === 0 && !/Стан і дії/.test(await page.locator('.fs').innerText()));

  // a row that was not sent has no card
  await page.locator('#lp-rows .si').nth(1).click(); await sleep(500);
  check('a row with nothing sent has no «Внески»', !(await page.locator('#f-var').isVisible()), JSON.stringify(await page.evaluate(() => { const b = document.querySelector('#f-var'); return { hidden: b.hidden, disp: getComputedStyle(b).display, n: document.querySelector('#f-var-n').textContent, key: document.querySelector('#f-key').textContent, tr: document.querySelector('#i-tr').dataset.key }; })));
  check('no page errors', errors.length === 0, errors.join(' | '));
  if (process.env.SHOT_DIR) { await page.locator('#lp-rows .si').first().click(); await sleep(500); await page.screenshot({ path: process.env.SHOT_DIR + '/s43-variants.png' }); }
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
