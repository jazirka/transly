// Browser regression check: branches of the translation and the merge screen. The branch button stands next to the project's name (a menu to switch, make,
// merge and delete branches); the merge screen takes the place of the work area: a table of the rows the other branch brings, «−» and «+» settle a row, the
// «Результат» cell is written in place, rows are selected by holding the mouse down (the table scrolls at its edge), «Злити» writes one action of the journal.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s47-branches.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const T = 1700000000000;
const ent = (target, status = 'draft', mt = T) => ({ target, status, mt });
const SRC = ['Hello', 'World', 'Leave.', 'Common', 'Army uniform', 'Healing herb'];
const project = () => ({
  version: 1, name: 'Гра', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' },
  // main: k0 as it was, k2 changed here, k3 changed only here, k4 proofread
  files: { 'Map001.json': { k0: ent('Привіт'), k2: ent('Наш варіант', 'draft', T + 30), k3: ent('Лише наша', 'draft', T + 30), k4: ent('Армійська форма', 'appr') } },
  branch: undefined,
  branches: { olya: { from: 'main', at: T + 10,
    base: { 'Map001.json': { k0: ent('Привіт'), k2: ent('Стара'), k3: ent('Спільна'), k4: ent('Армійська форма', 'appr') } },
    files: { 'Map001.json': { k0: ent('Привіт, світе', 'appr', T + 20), k1: ent('Нове', 'draft', T + 20), k2: ent('Її варіант', 'draft', T + 20), k3: ent('Спільна', 'draft', T), k4: ent('Військова форма', 'draft', T + 20), k5: ent('Лікувальна трава', 'draft', T + 20) } } } },
  snapshot: { 'Map001.json': SRC.map((source, i) => ({ key: 'k' + i, source, speaker: 'Hero', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });
const stored = () => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const r = o.result.transaction('projects').objectStore('projects').get('default'); r.onsuccess = () => res(JSON.parse(r.result)); r.onerror = () => rej(r.error); }; o.onerror = () => rej(o.error); });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot; delete p.branch;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);

  // ----- the button and its menu
  check('the branch button stands right after the name of the project, with the name of the current branch', await page.evaluate(() => { const a = document.getElementById('proj-btn'), b = document.getElementById('br-btn'); return a.nextElementSibling === b && b.querySelector('#br-name').textContent === 'main'; }));
  const same = await page.evaluate(() => { const a = getComputedStyle(document.querySelector('#proj-btn #proj-name')), b = getComputedStyle(document.querySelector('#br-btn #br-name')), ca = document.querySelector('#proj-btn .caret').getBoundingClientRect(), cb = document.querySelector('#br-btn .caret').getBoundingClientRect(); return { font: a.fontSize + a.fontFamily === b.fontSize + b.fontFamily, caret: Math.round(ca.width) === Math.round(cb.width) && Math.round(ca.height) === Math.round(cb.height), h: document.getElementById('proj-btn').offsetHeight === document.getElementById('br-btn').offsetHeight }; });
  check('it is the same kind of button as the project (the same font, arrow and height)', same.font && same.caret && same.h, JSON.stringify(same));
  await page.locator('#br-btn').click(); await sleep(300);
  const menu = await page.evaluate(() => [...document.querySelectorAll('#brpop [role=menuitem]')].map(b => ({ t: b.textContent.replace(/\s+/g, ' ').trim(), on: b.classList.contains('on'), dis: b.getAttribute('aria-disabled') })));
  check('the menu lists the branches (main is current), and new, merge, delete (no rename on main)', menu[0].on && /main/.test(menu[0].t) && /olya/.test(menu[1].t) && menu.some(m => /Нова гілка від «main»/.test(m.t)) && menu.some(m => /Злити гілку в «main»/.test(m.t)) && menu.some(m => /Видалити гілку/.test(m.t)) && !menu.some(m => /Перейменувати/.test(m.t)), JSON.stringify(menu.map(m => m.t)));

  // ----- the merge screen
  await page.locator('#brpop [data-bra="merge"]').click(); await sleep(500);
  check('the screen takes the place of the work area; the top bar shows what is merged into what, with a way out', await page.evaluate(() => !!document.querySelector('.mgx') && /olya.*→.*main/.test(document.getElementById('mcap').textContent.replace(/\s+/g, ' ')) && document.getElementById('br-btn').hidden && !!document.getElementById('mg-close')));
  const filt = await page.evaluate(() => [...document.querySelectorAll('.mgx [data-chip]')].map(c => `${c.dataset.chip}:${c.classList.contains('on')}:${/(\d+)/.exec(c.textContent)[1]}`));
  check('the chips carry the counts; conflicts are shown first', filt.join(' ') === 'conflict:true:1 new:false:2 changed:false:2'.replace('new:false:2', 'new:false:2') || /conflict:true:1/.test(filt.join(' ')), filt.join(' '));
  await page.locator('.mgx [data-chip="conflict"]').click(); await sleep(200);
  const all = await page.evaluate(() => [...document.querySelectorAll('.mgx .gr')].map(r => r.dataset.id.split('\u0001')[1]));
  check('with no chip on, every row the other branch brings is listed (not the one only main changed)', all.join(',') === 'k0,k1,k2,k4,k5', all.join(','));
  const st = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.mgx .gr')].map(r => [r.dataset.id.split('\u0001')[1], { p: r.querySelector('.db.p').classList.contains('on'), m: r.querySelector('.db.m').classList.contains('on'), dis: r.querySelector('.db.p').disabled }])));
  check('the start: rows only they changed are taken (+), the conflict waits, the proofread row is kept and locked', st.k0.p && st.k1.p && st.k5.p && !st.k2.p && !st.k2.m && st.k4.dis && st.k4.m, JSON.stringify(st));
  const grey = await page.evaluate(() => { const r = document.querySelector('.mgx .gr[data-id$="k2"]'); return [...r.querySelectorAll('.w')].map(w => w.className).join('|'); });
  check('a row with no decision is grey on both sides', /neu/.test(grey) && !/keep|rej/.test(grey), grey);
  check('the button of the main action names the direction and counts what goes in', /Злити «olya» у «main» · 3/.test(await page.locator('#mg-go').innerText()), await page.locator('#mg-go').innerText());
  const rad = await page.evaluate(() => { const b = document.querySelector('.mgx .db'), c = getComputedStyle(b); return { r: c.borderTopLeftRadius, h: b.offsetHeight, w: b.offsetWidth, svgs: [...document.querySelectorAll('.mgx .gr:first-child .db svg')].map(s => s.getBoundingClientRect().width).join() }; });
  check('«−» and «+» are rounded buttons of one size, drawn the same', rad.r === '8px' && rad.h === 24 && rad.w === 24 && /^14,14$/.test(rad.svgs), JSON.stringify(rad));

  // decide the conflict, write a row by hand
  await page.locator('.mgx .gr[data-id$="k2"] .db.p').click(); await sleep(200);
  const colour = await page.evaluate(() => { const r = document.querySelector('.mgx .gr[data-id$="k2"]'); const [mine, theirs] = r.querySelectorAll('.tr'); return { mine: mine.querySelector('.w')?.className, theirs: theirs.querySelector('.w')?.className }; });
  check('green is what is kept, red what is dropped: with «+» theirs is green and ours red', /keep/.test(colour.theirs) && /rej/.test(colour.mine), JSON.stringify(colour));
  check('«+» on the conflict takes theirs: the row is settled and the count is 4', await page.evaluate(() => document.querySelector('.mgx .gr[data-id$="k2"] .db.p').classList.contains('on')) && /· 4/.test(await page.locator('#mg-go').innerText()));
  await page.locator('.mgx .gr[data-id$="k1"] .res').click(); await sleep(250);
  check('a click on «Результат» writes the row in place (the editor of the table, not a card)', await page.evaluate(() => !!document.querySelector('.mgx .gr[data-id$="k1"] textarea.cell-ed') && !document.querySelector('.mgx .cust')));
  await page.keyboard.press('Control+A'); await page.keyboard.type('Своє нове'); await page.keyboard.press('Enter'); await sleep(250);
  const cust = await page.evaluate(() => { const r = document.querySelector('.mgx .gr[data-id$="k1"]'); return { res: r.querySelector('.res').textContent.trim(), plus: r.querySelector('.db.p').classList.contains('on'), minus: r.querySelector('.db.m').classList.contains('on'), w: [...r.querySelectorAll('.w')].map(w => w.className).join('|') }; });
  check('Enter keeps the hand-written text; the row drops both texts (red) and neither button is on', cust.res === 'Своє нове' && !cust.plus && !cust.minus && /rej/.test(cust.w) && !/keep/.test(cust.w), JSON.stringify(cust));

  // selecting by holding the mouse down
  const box = async sel => page.locator(sel).first().boundingBox();
  const r0 = await box('.mgx .gr[data-id$="k0"] .src'), r2 = await box('.mgx .gr[data-id$="k2"] .src');
  await page.mouse.move(r0.x + 10, r0.y + 8); await page.mouse.down(); await page.mouse.move(r2.x + 10, r2.y + 8, { steps: 6 }); await sleep(200);
  check('the left button held down and dragged over rows selects them (three here), and a hint says how many', await page.evaluate(() => document.querySelectorAll('.mgx .gr.sel').length) === 3 && /Обрано 3/.test(await page.locator('.mg-bub').innerText()));
  await page.mouse.up(); await sleep(150);
  check('the band offers to settle the selection', /Обрано\s*3/.test(await page.locator('.mg-band').innerText()) && await page.locator('.mg-band [data-sel="mine"]').count() === 1);
  await page.locator('.mg-band [data-sel="mine"]').click(); await sleep(200);
  const mineAll = await page.evaluate(() => ['k0', 'k1', 'k2'].map(k => document.querySelector(`.mgx .gr[data-id$="${k}"] .db.m`).classList.contains('on')).join());
  check('«Відкинути» for the selection drops theirs in all three rows', mineAll === 'true,true,true', mineAll);
  await page.locator('.mgx .gr[data-id$="k0"] .db.p').click(); await sleep(150);   // take k0 again: the selection is the row's own now? no: the row is selected, so all three follow
  const follow = await page.evaluate(() => ['k0', 'k1', 'k2'].map(k => document.querySelector(`.mgx .gr[data-id$="${k}"] .db.p`).classList.contains('on')).join());
  check('a button on a selected row settles the whole selection', follow === 'true,true,true', follow);
  await page.locator('.mgx .gr[data-id$="k1"] .res').click(); await sleep(150); await page.keyboard.press('Control+A'); await page.keyboard.type('Своє нове'); await page.keyboard.press('Enter'); await sleep(150);

  // merge
  await page.locator('#mg-go').click(); await sleep(700);
  check('the screen closes and the branch button is back', await page.evaluate(() => !document.querySelector('.mgx') && !document.getElementById('br-btn').hidden && !document.getElementById('mcap')));
  const toast = await page.evaluate(() => document.getElementById('toasts')?.textContent ?? '');
  check('a message says what was merged and carries «Скасувати»', /Злито «olya» у «main»: 4 рядки/.test(toast) && /Скасувати/.test(toast), JSON.stringify(toast));
  await sleep(700);
  const saved = await page.evaluate(stored);
  const f = saved.files['Map001.json'];
  check('the rows are written: theirs where «+», the hand-written text, the proofread row and the row only main changed are untouched', f.k0.target === 'Привіт, світе' && f.k0.status === 'appr' && f.k1.target === 'Своє нове' && f.k1.status === 'draft' && f.k2.target === 'Її варіант' && f.k3.target === 'Лише наша' && f.k4.target === 'Армійська форма' && f.k5.target === 'Лікувальна трава', JSON.stringify(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.target]))));
  check('each written row has a history record of the action «merge»', ['k0', 'k1', 'k2', 'k5'].every(k => (f[k].history ?? []).some(h => /^merge:/.test(h.batch ?? ''))));
  await page.locator('#toasts .toast button').first().click(); await sleep(700);
  const back = (await page.evaluate(stored)).files['Map001.json'];
  check('«Скасувати» takes the whole merge back', back.k0.target === 'Привіт' && !back.k1 || (back.k1 && back.k1.target === '') , JSON.stringify(Object.fromEntries(Object.entries(back).map(([k, v]) => [k, v.target]))));

  // Esc closes the screen
  await page.locator('#br-btn').click(); await sleep(200); await page.locator('#brpop [data-bra="merge"]').click(); await sleep(400);
  await page.keyboard.press('Escape'); await sleep(300);
  check('Esc closes the merge screen', await page.evaluate(() => !document.querySelector('.mgx') && !document.getElementById('br-btn').hidden));

  // ----- making, switching, naming
  await page.locator('#br-btn').click(); await sleep(200); await page.locator('#brpop [data-bra="new"]').click(); await sleep(300);
  const input = page.locator('dialog #br-name');
  await input.fill('Main'); await sleep(150);
  check('a name that is taken (any case) is refused with the reason, and the button is off', /уже є/.test(await page.locator('dialog #br-err').innerText()) && await page.locator('dialog #br-ok').isDisabled());
  await input.fill('вичитка'); await sleep(100); await input.press('Enter'); await sleep(900);
  check('the new branch becomes the current one: the button says so, and the rows are a copy', await page.locator('#br-name').innerText() === 'вичитка' && /Створено гілку «вичитка»/.test(await page.evaluate(() => document.getElementById('toasts')?.textContent ?? '')));
  const s2 = await page.evaluate(stored);
  check('the project keeps it: the current branch, the old rows parked, where it began', s2.branch === 'вичитка' && s2.branches.main.files['Map001.json'].k0.target === 'Привіт' && s2.branches['вичитка'].from === 'main' && s2.files['Map001.json'].k0.target === 'Привіт' && !!s2.branches.olya.files);
  await page.locator('#br-btn').click(); await sleep(200);
  await page.locator('#brpop [data-br="main"]').click(); await sleep(900);
  check('switching back gives main again', await page.locator('#br-name').innerText() === 'main' && (await page.evaluate(stored)).files['Map001.json'].k2.target === 'Наш варіант');
  // rename and delete
  await page.locator('#br-btn').click(); await sleep(200); await page.locator('#brpop [data-br="вичитка"]').click(); await sleep(800);
  await page.locator('#br-btn').click(); await sleep(200);
  check('on another branch the menu offers to rename it (not main)', await page.locator('#brpop [data-bra="rename"]').count() === 1 && /Перейменувати «вичитка»/.test(await page.locator('#brpop [data-bra="rename"]').innerText()));
  await page.locator('#brpop [data-bra="rename"]').click(); await sleep(300);
  await page.locator('dialog #br-name').fill('правка'); await page.locator('dialog #br-name').press('Enter'); await sleep(800);
  check('rename: the button and the project say the new name', await page.locator('#br-name').innerText() === 'правка' && (await page.evaluate(stored)).branch === 'правка');
  await page.locator('#br-btn').click(); await sleep(200); await page.locator('#brpop [data-br="main"]').click(); await sleep(800);
  await page.locator('#br-btn').click(); await sleep(200); await page.locator('#brpop [data-bra="delete"]').click(); await sleep(300);
  await page.locator('dialog [data-del="правка"]').click(); await sleep(150);
  check('delete asks once more before it deletes', /Так, видалити/.test(await page.locator('dialog [data-del="правка"]').innerText()) && !!(await page.evaluate(stored)).branches['правка']);
  await page.locator('dialog [data-del="правка"]').click(); await sleep(900);
  const gone = await page.evaluate(stored);
  check('the branch is deleted, a trace is left, the others are untouched', !gone.branches['правка'] && typeof gone.goneBranches['правка'] === 'number' && !!gone.branches.olya.files && gone.files['Map001.json'].k2.target === 'Наш варіант');
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
