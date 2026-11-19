// Browser regression check: the translation memory is a kind of thread in «Пов’язане»: its matches are cards under the translation,
// the old «Пропозиції» section is gone from the right panel, and the memory can be searched in the left list.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s24-memory.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const cmd = (code, parameters, indent = 0) => ({ code, indent, parameters });
const say = (t, who = 'Cook') => [cmd(101, [who, 0, 0, 2, who]), cmd(401, [t])];
const MAP = { displayName: 'Town', events: [null, { id: 1, name: 'cook', x: 1, y: 1, pages: [{ list: [...say('The road north is long and cold.'), ...say('The road south is long and cold.'), ...say('Farewell.'), cmd(0, [])] }] }] };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  await page.evaluate(async text => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('memory-game', { create: true });
    const data = await game.getDirectoryHandle('data', { create: true });
    const w = await (await data.getFileHandle('Map001.json', { create: true })).createWritable();
    await w.write(text); await w.close();
    window.showDirectoryPicker = async () => root.getDirectoryHandle('memory-game');
  }, JSON.stringify(MAP));
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1500);
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  const row = text => page.locator('#lp-rows [data-key], .slist [data-key]').filter({ hasText: text }).first();

  await row('road north').click(); await sleep(300);
  const ta = page.locator('#i-tr'); await ta.click(); await ta.fill('Дорога на північ довга й холодна.'); await page.keyboard.press('Control+Enter'); await sleep(500);
  await row('road south').click(); await sleep(1200);

  const mem = page.locator('#pn-th .thc.mem');
  check('a row that reads like a translated one gets the memory card under the translation', (await mem.count()) === 1 && /Дорога на північ/.test(await mem.innerText()) && /пам’ять \d+%/.test(await mem.innerText()), await page.locator('#pn-th').innerText());
  check('the old «Пропозиції» section is gone from the right panel', (await page.locator('.pn-sec[data-sec="sg"], #pn-sg').count()) === 0);
  await mem.locator('[data-tm]').click(); await sleep(400);
  check('«Підставити» puts the translation into the field', (await page.locator('#i-tr').inputValue()) === 'Дорога на північ довга й холодна.', await page.locator('#i-tr').inputValue());

  await page.locator('nav [data-lp="glossary"], #mtabs [data-lt="glossary"]').first().click(); await sleep(300);
  await page.locator('#gl-chips [data-glk="memory"]').click(); await sleep(400);
  check('the left list has «Пам’ять» and asks for a word', /Введіть слово/.test(await page.locator('#gl-list').innerText()));
  await page.locator('#gl-q').fill('road'); await sleep(500);
  const found = await page.locator('#gl-list .gt-card.mem').allInnerTexts();
  check('a word finds the pairs of the memory', found.length >= 1 && /road north/.test(found[0]) && /Дорога на північ/.test(found[0]), JSON.stringify(found));
  const chip = await page.locator('#gl-chips [data-glk="memory"]').innerText();
  check('and the chip counts the memory once it was asked for', /\d/.test(chip), chip);
  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
