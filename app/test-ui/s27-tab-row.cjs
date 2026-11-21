// Browser regression check: a tab of a file remembers the row it was left on: it comes back on that row when the tab is opened again,
// and also after the app is reloaded. See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s27-tab-row.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const cmd = (code, parameters, indent = 0) => ({ code, indent, parameters });
const say = (t, who = 'Cook') => [cmd(101, [who, 0, 0, 2, who]), cmd(401, [t])];
const mapOf = (name, lines) => ({ displayName: name, events: [null, { id: 1, name: 'e', x: 1, y: 1, pages: [{ list: [...lines.flatMap(l => say(l)), cmd(0, [])] }] }] });
const A = mapOf('Town', Array.from({ length: 12 }, (_, i) => 'Town line ' + (i + 1)));
const B = mapOf('Forest', Array.from({ length: 8 }, (_, i) => 'Forest line ' + (i + 1)));

async function putGame(page, write = true) {
  await page.evaluate(async ({ a, b, write }) => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('memo-game', { create: true });
    const data = await game.getDirectoryHandle('data', { create: true });
    if (write) for (const [n, t] of [['Map001.json', a], ['Map002.json', b]]) { const w = await (await data.getFileHandle(n, { create: true })).createWritable(); await w.write(t); await w.close(); }
    window.showDirectoryPicker = async () => root.getDirectoryHandle('memo-game');
  }, { a: JSON.stringify(A), b: JSON.stringify(B), write });
}
const selKey = page => page.evaluate(() => document.querySelector('#grid .gr.sel')?.dataset.key ?? null);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  await putGame(page);
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1500);
  await page.locator('[data-m="table"]').click(); await sleep(500);
  if (!(await page.locator('#tree .node[data-file]').first().isVisible())) { await page.locator('.strip [data-lp="files"]').click(); await sleep(300); }

  await page.locator('#tree .node[data-file*="Map001"]').first().click(); await sleep(500);
  await page.locator('#grid .gr').nth(6).click(); await sleep(300);
  const kA = await selKey(page);
  check('a row is chosen in the first file', !!kA, String(kA));
  await page.locator('#tree .node[data-file*="Map002"]').first().click(); await sleep(500);
  check('the second file opens with no row chosen (it was never opened)', (await selKey(page)) === null);
  await page.locator('#grid .gr').nth(3).click(); await sleep(300);
  const kB = await selKey(page);
  await page.locator('[data-tab*="Map001"]').first().click(); await sleep(500);
  check('the tab of the first file comes back on the row it was left on', (await selKey(page)) === kA, `${kA} -> ${await selKey(page)}`);
  await page.mouse.move(700, 8); await sleep(200);
  const title = await page.locator('[data-tab*="Map001"]').first().getAttribute('title');
  check('and its title says where the translator stopped', /на рядку 7/.test(title), title);
  await page.locator('[data-tab*="Map002"]').first().click(); await sleep(500);
  check('the second tab comes back on its own row', (await selKey(page)) === kB, `${kB} -> ${await selKey(page)}`);

  // the memory is kept on this device, so it survives a restart of the app
  await sleep(700);
  const saved = await page.evaluate(() => { const k = Object.keys(localStorage).find(x => x.startsWith('transly.rowat:')); return k ? JSON.parse(localStorage.getItem(k)) : null; });
  const vals = saved ? Object.values(saved) : [];
  check('the rows are saved with the device storage, one per file', saved && vals.includes(kA) && vals.includes(kB), JSON.stringify(saved));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
