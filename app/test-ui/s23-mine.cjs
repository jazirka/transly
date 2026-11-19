// Browser regression check: a construction found in the translator's own rows is proposed as a card, and added only on confirmation.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s23-mine.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const cmd = (code, parameters, indent = 0) => ({ code, indent, parameters });
const say = (t, who = 'Cook') => [cmd(101, [who, 0, 0, 2, who]), cmd(401, [t])];
const ROWS = [['Take it off.', 'Зніми це.'], ['Take that off.', 'Зніми те.'], ['Take them off.', 'Зніми їх.'], ['Take this off.', 'Зніми цей.'], ['Take the key.', 'Візьми ключ.'], ['Take the road.', 'Іди дорогою.']];
const MAP = { displayName: 'Town', events: [null, { id: 1, name: 'cook', x: 1, y: 1, pages: [{ list: [...ROWS.flatMap(([s]) => say(s)), cmd(0, [])] }] }] };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  await page.evaluate(async text => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('mine-game', { create: true });
    const data = await game.getDirectoryHandle('data', { create: true });
    const w = await (await data.getFileHandle('Map001.json', { create: true })).createWritable();
    await w.write(text); await w.close();
    window.showDirectoryPicker = async () => root.getDirectoryHandle('mine-game');
    try { localStorage.removeItem('transly.mine.no'); } catch (e) { /* none */ }
  }, JSON.stringify(MAP));
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1500);
  await page.locator('[data-m="edit"]').click(); await sleep(500);

  const row = text => page.locator('#lp-rows [data-key], .slist [data-key]').filter({ hasText: text }).first();
  for (const [src, tr] of ROWS) {
    await row(src).click(); await sleep(250);
    const ta = page.locator('#i-tr'); await ta.click(); await ta.fill(tr); await page.keyboard.press('Control+Enter'); await sleep(350);
  }
  // the proposals are looked for again some seconds after the translations changed (not on every send)
  await sleep(10500);
  await row('Take that off').click(); await sleep(400); await row('Take it off').click(); await sleep(2500);
  const card = page.locator('#pn-th .thc.new');
  check('a construction rendered the same way in four rows is proposed under the cards of a row that has it', (await card.count()) === 1 && /take … off/.test(await card.innerText()) && /нова конструкція/.test(await card.innerText()), await page.locator('#pn-th').innerText());
  check('the card says how many rows it comes from', /4 рядках/.test(await card.innerText()), await card.innerText());
  check('nothing was added to the glossary by itself', (await page.evaluate(() => JSON.parse(localStorage.getItem('transly.mine.no') ?? '[]').length)) === 0);

  await card.locator('[data-mn="show"]').click(); await sleep(600);
  check('«Показати» opens exactly those rows', (await page.locator('#lp-rows [data-key]:visible').count()) === 4, String(await page.locator('#lp-rows [data-key]:visible').count()));
  await row('Take it off').click(); await sleep(900);

  await page.locator('#pn-th .thc.new [data-mn="no"]').click(); await sleep(500);
  check('«Не зараз» takes it away', (await page.locator('#pn-th .thc.new').count()) === 0);
  await page.evaluate(() => { try { localStorage.removeItem('transly.mine.no'); } catch (e) { /* none */ } });
  await row('Take that off').click(); await sleep(500); await row('Take it off').click(); await sleep(900);
  check('and it comes back when the choice is forgotten', (await page.locator('#pn-th .thc.new').count()) === 1);

  await page.locator('#pn-th .thc.new [data-mn="add"]').click(); await sleep(600);
  check('«Додати» opens the form with the pattern and the Ukrainian word filled in', (await page.locator('#gl-en').inputValue()) === 'take … off' && /^зн/.test(await page.locator('#gl-uk').inputValue()), (await page.locator('#gl-en').inputValue()) + ' → ' + (await page.locator('#gl-uk').inputValue()));
  check('and nothing is stored before it is saved', (await page.evaluate(() => (window.__t || 0))) === 0);
  await page.locator('#gl-uk').fill('зняти'); await page.locator('#gl-save').click(); await sleep(500);
  await page.locator('#mtabs [data-lt="rows"], nav [data-lp="rows"]').first().click().catch(() => {}); await sleep(300);
  await row('Take it off').click(); await sleep(1500);
  check('after saving, the proposal is gone and the construction has its own card', (await page.locator('#pn-th .thc.new').count()) === 0 && (await page.locator('#pn-th .thc2[data-ck="take … off"]').count()) === 1, await page.locator('#pn-th').innerText());
  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
