// Browser regression checks for the findings of the blind first-timer and the careless user (the PC app). See s0-safety.cjs:
//   PC_URL=http://localhost:4285/ node test-ui/s16-pc-blind.cjs
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const msg = text => [{ code: 101, indent: 0, parameters: ['', 0, 0, 2] }, { code: 401, indent: 0, parameters: [text] }];
const mapOf = (name, lines) => ({ displayName: name, events: [null, { id: 1, name: 'EV001', x: 0, y: 0, pages: [{ list: [...lines.flatMap(msg), { code: 0, indent: 0, parameters: [] }] }] }] });
const write = (dir, files) => { fs.mkdirSync(dir, { recursive: true }); for (const [n, d] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), typeof d === 'string' ? d : JSON.stringify(d)); return dir; };
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const stored = () => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const g = db.transaction('projects').objectStore('projects').get('default'); g.onsuccess = () => { db.close(); res(g.result ?? ''); }; g.onerror = () => rej(g.error); }; o.onerror = () => rej(o.error); });

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pcb-'));
  const A = write(path.join(tmp, 'A'), { 'Map001.json': mapOf('T', ['Line one', 'Line two', 'Line three', 'Line four', 'Line five', 'Line six']), 'Map002.json': mapOf('U', ['Other one', 'Other two']) });
  const B = write(path.join(tmp, 'B'), { 'Map001.json': mapOf('Z', ['Totally different alpha', 'Totally different beta', 'Totally different gamma', 'Totally different delta', 'Totally different epsilon', 'Totally different zeta']) });
  const broken = write(path.join(tmp, 'C'), { 'Map001.json': '{"displayName":"T","events":[null,{"id":1,', 'Map002.json': mapOf('U', ['Other one', 'Other two']) });
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.addInitScript(() => { delete window.showDirectoryPicker; });
  await page.goto(PC); await sleep(800);
  const open = async (files, again) => {
    if (again) { await page.getByTitle('Проєкт: відкрити іншу гру, налаштування').click(); await sleep(300); }
    const [ch] = await Promise.all([page.waitForEvent('filechooser'), (again ? page.getByText('Відкрити папку гри…') : page.getByRole('button', { name: /Відкрити папку гри/ })).first().click()]);
    await ch.setFiles(files); await sleep(1800);
  };
  await open(A);
  const cell = n => page.locator('.gr .tr').nth(n);

  // ---- Ctrl+Enter in a cell: the row is sent and the next cell is open for writing
  await cell(1).click(); await page.keyboard.type('Перший'); await page.keyboard.press('Control+Enter'); await sleep(700);
  check('Ctrl+Enter in a cell: the next cell is open (focus in a textarea)', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('cell-ed')), String(await page.evaluate(() => document.activeElement && document.activeElement.tagName)));
  await page.keyboard.type('Другий'); await page.keyboard.press('Enter'); await sleep(700);
  const t1 = await page.evaluate(stored);
  check('what is typed after Ctrl+Enter is kept', t1.includes('Перший') && t1.includes('Другий'));

  // ---- Ctrl+Z takes back a change of a cell (an overwritten draft is not lost)
  await cell(3).click(); await page.keyboard.type('Чернетка'); await page.keyboard.press('Enter'); await sleep(500);
  await cell(3).click(); await page.keyboard.press('Control+A'); await page.keyboard.type('Переписана'); await page.keyboard.press('Enter'); await sleep(600);
  await page.keyboard.press('Escape'); await page.locator('.gr .src').first().click(); await sleep(300);
  await page.keyboard.press('Control+z'); await sleep(700);
  const rows = await page.locator('.gr').evaluateAll(r => r.map(x => x.innerText.replace(/\s+/g, ' ')));
  check('Ctrl+Z after a change of a cell brings the draft back', rows.some(r => /Чернетка/.test(r)) && !rows.some(r => /Переписана/.test(r)), JSON.stringify(rows).slice(0, 200));

  // ---- text written in a cell and not confirmed survives a reload
  await cell(4).click(); await page.keyboard.type('Незатверджений'); await page.reload(); await sleep(1800);
  const t2 = await page.evaluate(stored);
  check('text typed in a cell without Enter survives a reload', t2.includes('Незатверджений'));

  // ---- a build with no game files in the session says what is missing and offers the folder (not a bare message)
  await page.locator('#hamb').click(); await sleep(300); await page.locator('#menubar [data-mg="Файл"]').click(); await sleep(200); await page.locator('#mdd').getByText('Зібрати…').first().click(); await sleep(500);
  const bt = await page.locator('.toast').allInnerTexts();
  check('the build without game files names what is missing', bt.some(t => /файлів гри зараз немає/.test(t) && /Відкрити папку гри/.test(t)), JSON.stringify(bt).slice(0, 200));
  await page.keyboard.press('Escape');

  // ---- the filter bar keeps its height when a new kind of row appears
  {
    const h0 = await page.locator('.filters').first().evaluate(e => Math.round(e.getBoundingClientRect().height));
    const chips = await page.$$eval('.chip[data-filter]', cs => cs.map(c => c.textContent.trim().replace(/\s+/g, ' ')));
    await cell(0).click(); await page.keyboard.type('Новий'); await page.keyboard.press('Control+Enter'); await sleep(700); await page.keyboard.press('Escape');
    const h1 = await page.locator('.filters').first().evaluate(e => Math.round(e.getBoundingClientRect().height));
    check('the filter bar does not change height when a new kind of row appears', h0 === h1 && chips.length >= 9, `${h0} -> ${h1}, ${chips.length} chips`);
    const idle = await page.$$eval('.chip.idle', cs => cs.every(c => c.disabled));
    check('a filter with nothing in it is dimmed and cannot be pressed', idle);
  }

  // ---- settings: a threshold out of range is explained next to the field
  await page.locator('#hamb').click(); await sleep(300); await page.locator('#menubar [data-mg="Файл"]').click(); await sleep(200); await page.locator('#mdd').getByText('Налаштування…').first().click(); await sleep(500);
  const lab = await page.locator('label[for="st-tol"]').innerText();
  check('the threshold label says the range', /5.*100/.test(lab), lab);
  await page.locator('#st-tol').fill('300'); await page.locator('#st-save').click(); await sleep(500);
  const st = await page.evaluate(() => ({ open: !!document.querySelector('dialog[open] #st-tol'), inv: document.getElementById('st-tol')?.getAttribute('aria-invalid'), err: document.getElementById('st-tol-err')?.textContent ?? '', focus: document.activeElement?.id }));
  check('a wrong threshold keeps the dialog open, marks the field, explains and focuses it', st.open && st.inv === 'true' && /від 5 до 100/.test(st.err) && st.focus === 'st-tol', JSON.stringify(st));
  await page.locator('#st-tol').fill('30'); await page.locator('#st-save').click(); await sleep(1200);
  check('a good value closes it', !(await page.evaluate(() => !!document.querySelector('dialog[open] #st-tol'))), await page.evaluate(() => JSON.stringify({ v: document.getElementById('st-tol')?.value, inv: document.getElementById('st-tol')?.getAttribute('aria-invalid'), err: document.getElementById('st-tol-err')?.textContent })));

  // ---- the file dialog starts with what can be chosen, and the transfer instructions are folded
  await page.locator('#hamb').click(); await sleep(300); await page.locator('#menubar [data-mg="Файл"]').click(); await sleep(200); await page.locator('#mdd').getByText('Відкрити файли або вставити JSON…').first().click(); await sleep(500);
  const im = await page.evaluate(() => { const d = document.querySelector('dialog[open]'); const first = d?.querySelector('p.hint')?.textContent ?? ''; return { first, details: !!d?.querySelector('details') }; });
  check('the file dialog opens with what can be chosen, not with the transfer from a computer', /Оберіть файли гри/.test(im.first) && im.details, JSON.stringify(im).slice(0, 160));
  await page.keyboard.press('Escape'); await sleep(300);

  // ---- the first click on a file in the tree is not swallowed while a cell is open
  await page.locator('.gr .tr').nth(5).click(); await page.keyboard.type('x');
  const before = await page.locator('.node.cur[data-file]').first().getAttribute('data-file').catch(() => '');
  await page.locator('#tree [data-file], .tree [data-file], .tr-file').filter({ hasText: 'Map002' }).first().click().catch(() => undefined); await sleep(700);
  const after = await page.locator('.node.cur[data-file]').first().getAttribute('data-file').catch(() => '');
  check('the first click on another file opens it (the cell editor does not swallow it)', /Map002/.test(after || '') && after !== before, `${before} -> ${after}`);

  // ---- another game: asked before the rows are mixed
  await open(B, true);
  const ask = await page.locator('dialog[open]').allInnerTexts();
  check('another game: the translator is asked first', ask.some(t => /Схоже, це інша гра/.test(t)), JSON.stringify(ask).slice(0, 80));
  await page.locator('#ag-no').click().catch(() => undefined); await sleep(600);
  const t3 = await page.evaluate(stored);
  check('and «Не відкривати» leaves the project as it was', !t3.includes('Totally different'), '');
  check('no «Missing element» error from the report of a new version', !errors.some(e => /Missing element/.test(e)), errors.join(' | '));

  // ---- a damaged file is named, and the message stays
  await open(broken, true);
  await page.locator('#ag-yes').click().catch(() => undefined); await sleep(500);
  const toast = await page.locator('.toast').allInnerTexts();
  check('a damaged file is named in the message', toast.some(t => /Map001\.json/.test(t)), JSON.stringify(toast).slice(0, 160));
  await sleep(5000);
  check('and the message is still there after five seconds', (await page.locator('.toast').allInnerTexts()).some(t => /Map001\.json/.test(t)));
  check('no page errors', errors.filter(e => !/Missing element/.test(e)).length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
