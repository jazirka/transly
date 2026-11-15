// Browser regression check: the states of the controls (rest · hover · active · active and hovered), the dots of the status chips and the
// accent colour of the project (PC and phone). See s0-safety.cjs for how to run:
//   PC_URL=http://localhost:4285/ PHONE_URL=http://localhost:4284/ node test-ui/s26-theme.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const PHONE = process.env.PHONE_URL || 'http://localhost:4284/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const cmd = (code, parameters, indent = 0) => ({ code, indent, parameters });
const say = (t, who = 'Cook') => [cmd(101, [who, 0, 0, 2, who]), cmd(401, [t])];
const MAP = { displayName: 'Town', events: [null, { id: 1, name: 'cook', x: 1, y: 1, pages: [{ list: [...say('Take your hat off.'), ...say('Hello there.'), cmd(0, [])] }] }] };

const accentOf = page => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
const rgbOf = page => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim().split(',').map(Number));

async function pcPart(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  await page.evaluate(async text => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('theme-game', { create: true });
    const data = await game.getDirectoryHandle('data', { create: true });
    const w = await (await data.getFileHandle('Map001.json', { create: true })).createWritable();
    await w.write(text); await w.close();
    window.showDirectoryPicker = async () => root.getDirectoryHandle('theme-game');
  }, JSON.stringify(MAP));
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1500);
  await page.locator('[data-m="edit"]').click(); await sleep(600);
  await page.locator('.strip [data-lp="files"]').click().catch(() => {}); await sleep(300);

  const a0 = await accentOf(page);
  check('the project has its accent colour (a plain #rrggbb, set by the theme)', /^#[0-9a-f]{6}$/.test(a0), a0);

  // the four states of every kind of control: active = the grey fill + the grey ring, no bar; active + hover = the colour of the project
  const [r, g, b] = await rgbOf(page);
  const kinds = { 'left rail': '.strip button.on', 'right rail': '#stabs button.on', 'mode switch': '.seg button.on', 'file tab': '.tab.on', 'file in the tree': '.node.cur', 'filter chip': '.chip.on', 'row in the list': '.si.sel' };
  const read = sel => page.evaluate(sel => { const e = document.querySelector(sel); const c = getComputedStyle(e); const bf = getComputedStyle(e, '::before'); return { bg: c.backgroundColor, sh: c.boxShadow, bar: bf.content !== 'none' && bf.display !== 'none' && bf.content !== 'normal' }; }, sel);
  for (const [name, sel] of Object.entries(kinds)) {
    const el = page.locator(sel).first();
    if (!(await el.count())) { check(`${name}: is on the screen`, false, sel); continue; }
    await page.mouse.move(700, 820); await sleep(120);
    const act = await read(sel);
    check(`${name}: active = a grey fill and a grey ring`, act.bg === 'rgba(255, 255, 255, 0.09)' && /rgba\(255, 255, 255, 0\.24\)/.test(act.sh), JSON.stringify(act));
    check(`${name}: no bar`, !act.bar);
    await el.hover(); await sleep(180);
    const hov = await read(sel);
    check(`${name}: active + hover = the colour of the project`, hov.bg.startsWith(`rgba(${r}, ${g}, ${b},`) && hov.sh.includes(`rgba(${r}, ${g}, ${b}, 0.5)`), JSON.stringify(hov));
  }
  // hover on a resting control is only grey
  const rest = page.locator('.seg button:not(.on)').first();
  await rest.hover(); await sleep(150);
  const rh = await rest.evaluate(e => getComputedStyle(e).backgroundColor);
  check('a resting control under the cursor gets a grey fill only', rh === 'rgba(255, 255, 255, 0.09)', rh);

  // the dots of the status chips
  const dots = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.chip[data-filter]')].map(c => [c.dataset.filter, c.querySelector('.sd')?.className ?? ''])));
  check('the status chips wear the dot of their status', dots.new === 'sd new' && dots.draft === 'sd draft' && dots.done === 'sd done' && dots.appr === 'sd appr' && dots.qa === 'sd qa' && dots.auto === 'sd draft auto', JSON.stringify(dots));
  check('«Усі» has no dot', dots.all === '');

  // the accent colour in the settings
  await page.locator('#hamb').click(); await sleep(300); await page.locator('#menubar [data-mg="Файл"]').click(); await sleep(200);
  await page.locator('#mdd').getByText('Налаштування…').first().click(); await sleep(500);
  const hint0 = await page.locator('#th-hint').innerText();
  check('the settings say the colour comes from the name of the project', /назви проєкту/.test(hint0) && (await page.locator('#th-reset').isDisabled()), hint0);
  await page.locator('#th-hue').evaluate(e => { e.value = '40'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(200);
  const a1 = await accentOf(page);
  check('a hand-picked hue changes the accent at once', a1 !== a0 && /^#[0-9a-f]{6}$/.test(a1), `${a0} -> ${a1}`);
  check('and the settings say so', /вручну: 40°/.test(await page.locator('#th-hint').innerText()) && !(await page.locator('#th-reset').isDisabled()));
  await page.locator('#th-pre button[data-h="245"]').click(); await sleep(150);
  const a2 = await accentOf(page);
  check('a ready colour works too', a2 !== a1 && /вручну: 245°/.test(await page.locator('#th-hint').innerText()), `${a1} -> ${a2}`);
  await page.locator('#th-reset').click(); await sleep(150);
  check('«Взяти з назви проєкту» brings the first colour back', (await accentOf(page)) === a0 && /назви проєкту/.test(await page.locator('#th-hint').innerText()));
  check('no page errors on the PC', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

async function phonePart(browser) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 800 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PHONE); await sleep(600);
  const project = { version: 1, name: 'Theme project', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [],
    settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 } };
  const snapshot = { 'Map001.json': ['Take your hat off.', 'Hello there.'].map((src, i) => ({ key: 'k' + i, source: src, speaker: '', kind: 'dialogue', context: '' })) };
  await page.evaluate(({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); }), { text: JSON.stringify(project), snapshot });
  await page.reload(); await sleep(1500);
  const stored = () => page.evaluate(() => new Promise(res => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const g = o.result.transaction('projects').objectStore('projects').get('default'); g.onsuccess = () => { o.result.close(); res(JSON.parse(g.result).settings); }; }; }));

  const a0 = await accentOf(page);
  check('the phone has the accent colour of the project too', /^#[0-9a-f]{6}$/.test(a0), a0);
  const dots = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.m-chip[data-filter]')].map(c => [c.dataset.filter, c.querySelector('.sd')?.className ?? ''])));
  check('the status chips wear the dot of their status', dots.new === 'sd sd-new' && dots.draft === 'sd sd-draft' && dots.appr === 'sd sd-appr' && dots.qa === 'sd sd-qa' && dots.all === '', JSON.stringify(dots));
  const chip = await page.evaluate(() => { const c = document.querySelector('.m-chip.on'); const s = getComputedStyle(c); return { bg: s.backgroundColor, sh: s.boxShadow }; });
  check('the chosen chip is a grey fill and a grey ring', chip.bg === 'rgba(255, 255, 255, 0.09)' && /rgba\(255, 255, 255, 0\.24\)/.test(chip.sh), JSON.stringify(chip));

  await page.locator('[data-menu]').click(); await sleep(400);
  await page.locator('[data-sub="settings"]').first().click(); await sleep(500);
  await page.locator('#s-hue').evaluate(e => { e.value = '40'; e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); });
  await sleep(300);
  const a1 = await accentOf(page);
  check('a hand-picked hue changes the accent at once', a1 !== a0, `${a0} -> ${a1}`);
  await sleep(1500);
  check('and it is saved with the project', (await stored()).hue === 40);
  check('the screen says so', /вручну: 40°/.test(await page.locator('#s-hue-hint').innerText()) && !(await page.locator('#s-hue-reset').isDisabled()));
  await page.locator('#s-hue-pre button[data-hue="245"]').click(); await sleep(1800);
  check('a ready colour works too, and is saved', (await accentOf(page)) !== a1 && (await stored()).hue === 245);
  await page.locator('#s-hue-reset').click(); await sleep(1800);
  check('«Взяти з назви проєкту» brings the first colour back and forgets the choice', (await accentOf(page)) === a0 && (await stored()).hue === undefined);
  check('no page errors on the phone', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  await pcPart(browser);
  await phonePart(browser);
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
