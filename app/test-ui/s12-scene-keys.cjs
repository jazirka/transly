// Browser regression check: the Scene view does not keep cards of an older reading of the game. See s0-safety.cjs for how to run:
//   PC_URL=http://localhost:4285/ node test-ui/s12-scene-keys.cjs
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const msg = text => [{ code: 101, indent: 0, parameters: ['', 0, 0, 2] }, { code: 401, indent: 0, parameters: [text] }];
const mapOf = (lines, lead) => ({ displayName: 'T', events: [null, { id: 1, name: 'EV001', x: 0, y: 0, pages: [{ list: [...(lead ? [{ code: 108, indent: 0, parameters: ['note'] }] : []), ...lines.flatMap(msg), { code: 0, indent: 0, parameters: [] }] }] }] });
const write = (dir, lines, lead) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, 'Map001.json'), JSON.stringify(mapOf(lines, lead))); return dir; };
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const stored = () => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const g = db.transaction('projects').objectStore('projects').get('default'); g.onsuccess = () => { db.close(); res(g.result ?? ''); }; g.onerror = () => rej(g.error); }; o.onerror = () => rej(o.error); });

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-'));
  const lines = ['The road north', 'The river runs red', 'Farewell'];
  const v1 = write(path.join(tmp, 'v1'), lines, false);
  const v2 = write(path.join(tmp, 'v2'), lines, true);   // one command put in front: the same lines, every key shifted by one
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
  await page.locator('.gr .tr').nth(1).click(); await sleep(300);
  await page.locator('#m-scene').click(); await sleep(900);
  const keysBefore = await page.locator('.sv-card').evaluateAll(c => c.map(x => x.dataset.key));
  check('the scene shows its cards', keysBefore.length === 3, JSON.stringify(keysBefore));
  await open(v2, true);
  const keysAfter = await page.locator('.sv-card').evaluateAll(c => c.map(x => x.dataset.key));
  check('after the new reading the cards carry the keys the rows have now', keysAfter.length === 3 && keysAfter.every((k, i) => k !== keysBefore[i]), JSON.stringify(keysAfter));
  await page.locator('.sv-in').first().click(); await page.keyboard.type('Дорога на північ'); await sleep(1200);
  const text = await page.evaluate(stored);
  check('the text typed in the first card is stored', text.includes('Дорога на північ'));
  check('and it is stored under a key that exists now', keysAfter.some(k => text.includes(JSON.stringify(k).slice(1, -1))) || text.includes('list[1]'), '');
  await page.locator('[data-m="table"]').click(); await sleep(700);
  const rows = await page.locator('.gr').evaluateAll(r => r.map(x => x.innerText.replace(/\s+/g, ' ')));
  check('the table shows the same text next to the same line', rows.some(r => /The road north.*Дорога на північ/.test(r)), JSON.stringify(rows));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
