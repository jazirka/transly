// Browser regression check for the new-version-of-the-game handling (line up by the text of the original). See s0-safety.cjs for how to run:
//   PC_URL=http://localhost:4285/ node test-ui/s8-ingest.cjs
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const msg = text => [{ code: 101, indent: 0, parameters: ['', 0, 0, 2] }, { code: 401, indent: 0, parameters: [text] }];
const mapOf = lines => ({ displayName: 'T', events: [null, { id: 1, name: 'EV001', x: 0, y: 0, pages: [{ list: [...lines.flatMap(msg), { code: 0, indent: 0, parameters: [] }] }] }] });
const write = (dir, lines) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'Map001.json'), JSON.stringify(mapOf(lines))); return dir; };
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const stored = () => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const g = db.transaction('projects').objectStore('projects').get('default'); g.onsuccess = () => { db.close(); res(JSON.parse(g.result)); }; g.onerror = () => rej(g.error); }; o.onerror = () => rej(o.error); });

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-'));
  const v1 = write(path.join(tmp, 'v1'), ['The road north', 'The river runs red', 'Farewell']);
  const v2 = write(path.join(tmp, 'v2'), ['Welcome, traveler.', 'The road north', 'The river runs red', 'Farewell']);
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
  await open(v1);
  const type = async (n, text) => { await page.locator('.gr .tr').nth(n).click(); await page.keyboard.type(text); await page.keyboard.press('Control+Enter'); await sleep(900); };
  await type(1, 'Дорога на північ'); await type(2, 'Річка червона');   // row 0 is the game's display name
  await sleep(800);
  await open(v2, true);
  const toasts = await page.locator('.toast').allInnerTexts();
  check('opening the new version says what happened', toasts.some(t => /Нова версія гри: перенесено за текстом оригіналу: 2 · нових рядків: 1/.test(t)), JSON.stringify(toasts));
  const rows = await page.locator('.gr').evaluateAll(r => r.map(x => x.innerText.replace(/\s+/g, ' ')));
  check('the new line is empty and the translations stayed with their lines', /Welcome, traveler\./.test(rows[1]) && !/Дорога|Річка/.test(rows[1]) && /The road north.*Дорога на північ/.test(rows[2]) && /The river runs red.*Річка червона/.test(rows[3]), JSON.stringify(rows));
  const p = await page.evaluate(stored);
  check('both translations are still stored as sent', Object.values(p.files['Map001.json']).filter(e => e.status === 'done').length === 2);
  await page.locator('.toast', { hasText: 'Нова версія гри' }).getByRole('button', { name: 'Показати' }).click(); await sleep(500);
  const dlg = await page.locator('dialog').innerText();
  check('the report lists the new line', /Нові рядки \(1\)/.test(dlg) && /Welcome, traveler\./.test(dlg), dlg.slice(0, 200));
  await page.locator('#ig-undo').click(); await sleep(900);
  const rows2 = await page.locator('.gr').evaluateAll(r => r.map(x => x.innerText.replace(/\s+/g, ' ')));
  check('«Скасувати зіставлення» puts the translations back where they were (the old behaviour)', /Welcome, traveler\.\s*Дорога на північ/.test(rows2[1]), JSON.stringify(rows2));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
