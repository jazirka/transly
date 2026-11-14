// Browser regression checks: «Зібрати в папку» never replaces the files of a game unseen. See s0-safety.cjs for how to run:
//   PC_URL=http://localhost:4285/ node test-ui/s11-build-folder.cjs
const { chromium } = require('playwright');
const fs = require('fs'), os = require('os'), path = require('path');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const msg = text => [{ code: 101, indent: 0, parameters: ['', 0, 0, 2] }, { code: 401, indent: 0, parameters: [text] }];
const mapOf = lines => ({ displayName: 'T', events: [null, { id: 1, name: 'EV001', x: 0, y: 0, pages: [{ list: [...lines.flatMap(msg), { code: 0, indent: 0, parameters: [] }] }] }] });
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const ORIGINAL = JSON.stringify(mapOf(['The road north', 'Farewell']));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-'));
  const game = path.join(tmp, 'data'); fs.mkdirSync(game);
  fs.writeFileSync(path.join(game, 'Map001.json'), ORIGINAL);
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  // The game is opened through the file input; the folder picker of the build writes into a folder of the browser's private file system
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(window.__outDir || 'out', { create: true });
  });
  await page.goto(PC); await sleep(800);
  await page.evaluate(() => { document.documentElement.dataset.forceInput = '1'; });
  const [ch] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: /Відкрити папку гри/ }).first().click()]);
  await ch.setFiles(game); await sleep(1800);
  await page.locator('.gr .tr').nth(1).click(); await page.keyboard.type('Дорога на північ'); await page.keyboard.press('Control+Enter'); await sleep(900);

  const opfs = (dir, op, arg) => page.evaluate(async ({ dir, op, arg }) => {
    const root = await navigator.storage.getDirectory();
    const d = await root.getDirectoryHandle(dir, { create: true });
    if (op === 'put') { const w = await (await d.getFileHandle(arg.name, { create: true })).createWritable(); await w.write(arg.text); await w.close(); return null; }
    if (op === 'read') { try { const p = arg.split('/'); let x = d; for (const q of p.slice(0, -1)) x = await x.getDirectoryHandle(q); return await (await (await x.getFileHandle(p[p.length - 1])).getFile()).text(); } catch { return null; } }
    if (op === 'has') { try { await d.getFileHandle(arg); return true; } catch { return false; } }
    return null;
  }, { dir, op, arg });
  const build = async dir => {
    await page.evaluate(d => { window.__outDir = d; }, dir);
    await page.locator('#sb-build, [title^="Зібрати"]').first().evaluate(e => e.click()).catch(() => undefined);
    await page.keyboard.press('F5'); await sleep(500);
    await page.locator('#bd-dir').click(); await sleep(800);
  };

  // ---- 1. a folder that holds the game's own file: asked first, cancelling changes nothing
  await opfs('gamecopy', 'put', { name: 'Map001.json', text: ORIGINAL });
  await build('gamecopy');
  const dlg = await page.locator('dialog[open]').allInnerTexts();
  check('a folder with files of the game: the translator is asked before anything is replaced', dlg.some(t => /У цій папці вже є файли гри/.test(t)), JSON.stringify(dlg).slice(0, 160));
  await page.locator('#xo-no').click(); await sleep(500);
  check('cancelling leaves the file exactly as it was', (await opfs('gamecopy', 'read', 'Map001.json')) === ORIGINAL);
  check('cancelling writes no marker and no copy', !(await opfs('gamecopy', 'has', '.transly-build')) && (await opfs('gamecopy', 'read', '.transly-orig/Map001.json')) === null);

  // ---- 2. agreeing replaces the file and keeps the original next to it
  await page.keyboard.press('Escape'); await sleep(300);
  await build('gamecopy');
  await page.locator('#xo-yes').click(); await sleep(1000);
  const now = await opfs('gamecopy', 'read', 'Map001.json');
  check('agreeing replaces the file with the translation', now !== ORIGINAL && /Дорога на північ/.test(now ?? ''));
  check('the original is kept in .transly-orig', (await opfs('gamecopy', 'read', '.transly-orig/Map001.json')) === ORIGINAL);

  // ---- 3. a new empty folder: no question; building again into it (now an output folder): still no question, the first original copy is not replaced
  await page.keyboard.press('Escape'); await sleep(300);
  await build('fresh');
  check('an empty folder: written without a question', !(await page.locator('#xo-yes').count()) && /Дорога на північ/.test((await opfs('fresh', 'read', 'Map001.json')) ?? ''));
  await page.keyboard.press('Escape'); await sleep(300);
  await build('fresh');
  check('a folder of an earlier build: written again without a question', !(await page.locator('#xo-yes').count()) && await opfs('fresh', 'has', '.transly-build'));
  check('the output folder keeps no copies it did not need', (await opfs('fresh', 'read', '.transly-orig/Map001.json')) === null);
  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
