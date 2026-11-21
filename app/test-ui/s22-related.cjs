// Browser regression check: the left panel «Пов’язане» (PC), the old glossary and the identical rows in one list: filters by kind,
// a construction made through the form, the groups of identical rows, and the entries that are rendered differently somewhere.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s22-related.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const cmd = (code, parameters, indent = 0) => ({ code, indent, parameters });
const say = (t, who = 'Cook') => [cmd(101, [who, 0, 0, 2, who]), cmd(401, [t])];
const MAP = { displayName: 'Town', events: [null, { id: 1, name: 'cook', x: 1, y: 1, pages: [{ list: [
  ...say('Take it off, please.'), ...say('Take that off now.'), ...say('It is locked.'), ...say('It is locked.'), cmd(0, []),
] }] }] };

async function addTerm(page, en, uk) {
  await page.locator('#gl-new').click(); await sleep(150);
  await page.locator('#gl-en').fill(en); await page.locator('#gl-uk').fill(uk);
  await page.locator('#gl-save').click(); await sleep(250);
}
const chips = page => page.locator('#gl-chips .chip').evaluateAll(els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  await page.evaluate(async text => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('related-game', { create: true });
    const data = await game.getDirectoryHandle('data', { create: true });
    const w = await (await data.getFileHandle('Map001.json', { create: true })).createWritable();
    await w.write(text); await w.close();
    window.showDirectoryPicker = async () => root.getDirectoryHandle('related-game');
  }, JSON.stringify(MAP));
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1500);

  // translate the first two rows in the editor: the first renders the construction as the entry says, the second does not
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  const send = async (rowText, tr) => {
    await page.locator('.row, .rw, [data-key]').filter({ hasText: rowText }).first().click(); await sleep(300);
    const ta = page.locator('#i-tr'); await ta.click(); await ta.fill(tr); await page.keyboard.press('Control+Enter'); await sleep(400);
  };
  await send('Take it off', 'Зняти це, будь ласка.');
  await send('Take that off', 'Щось інше.');

  await page.locator('#mtabs [data-lt="glossary"], nav [data-lp="glossary"]').first().click(); await sleep(300);
  const head = await page.locator('#lp-gl .ph .grow').innerText(), rail = await page.locator('nav [data-lp="glossary"]').getAttribute('title');
  check('the panel is called «Пов’язане», not «Глосарій»', head === 'Пов’язане' && !rail.includes('Глосарій'), head + ' | ' + rail);
  await addTerm(page, 'take ... off', 'зняти');
  await addTerm(page, 'hat', 'капелюх');

  let c = await chips(page);
  check('the chips count the kinds: all 2, words 1, constructions 1, identical rows 1', c[0] === 'Усе 2' && c[1] === 'Слова 1' && c[2] === 'Конструкції 1' && c[3] === 'Рядки 1', JSON.stringify(c));
  check('each entry says what it is', (await page.locator('#gl-list .gt-card .tg.k').allInnerTexts()).sort().join(',') === 'конструкція,слово', (await page.locator('#gl-list .gt-card .tg.k').allInnerTexts()).join(','));

  await page.locator('#gl-chips [data-glk="construction"]').click(); await sleep(250);
  const cons = await page.locator('#gl-list .gt-card').evaluateAll(els => els.map(e => e.dataset.term));
  check('«Конструкції» shows only the construction, stored with the gap mark', cons.length === 1 && cons[0] === 'take … off', JSON.stringify(cons));
  await page.locator('#gl-chips [data-glk="word"]').click(); await sleep(250);
  check('«Слова» shows only the word', (await page.locator('#gl-list .gt-card').evaluateAll(els => els.map(e => e.dataset.term))).join() === 'hat');

  await page.locator('#gl-chips [data-glk="rows"]').click(); await sleep(250);
  const groups = await page.locator('#gl-list .gt-card[data-cluster]').evaluateAll(els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
  check('«Рядки» lists the group of identical rows with how many', groups.length === 1 && /It is locked/.test(groups[0]) && /× 2/.test(groups[0]), JSON.stringify(groups));
  check('and the old action is on it', (await page.locator('#gl-list [data-gt="sync-rows"]').count()) === 1);

  await page.locator('#gl-chips [data-glk="diff"]').click(); await sleep(1500);
  const diff = await page.locator('#gl-list .gt-card').evaluateAll(els => els.map(e => e.dataset.term));
  check('«Розбіжності» lists the entry that one row renders differently', diff.length === 1 && diff[0] === 'take … off', JSON.stringify(diff) + ' ' + (await chips(page)).join('|'));
  c = await chips(page);
  check('and the chip counts it', /Розбіжності 1/.test(c[5]), c[5]);

  if (process.env.SHOT_DIR) { await page.locator('#gl-chips [data-glk="all"]').click(); await sleep(400); await page.screenshot({ path: process.env.SHOT_DIR + '/s22-related.png' }); }
  // the card of the thread in the editor offers to go through the rows that render the entry another way
  await page.locator('[data-m="edit"]').click(); await sleep(400);
  await page.locator('#mtabs [data-lt="rows"], nav [data-lp="rows"]').first().click(); await sleep(300);
  await page.locator('#lp-rows [data-key], .slist [data-key]').filter({ hasText: 'Take it off' }).first().click(); await sleep(900);
  const fixBtn = page.locator('#pn-th [data-th="fix"]');
  check('the card of a construction used differently elsewhere has «≠ 1»', (await fixBtn.count()) === 1 && /≠ 1/.test(await fixBtn.innerText()), await page.locator('#pn-th').innerText());
  await fixBtn.click(); await sleep(700);
  const queue = await page.locator('#lp-rows [data-key]:visible').allInnerTexts();
  check('and it opens exactly the rows rendered differently', queue.length === 1 && /Take that off now/.test(queue[0].replace(/\s+/g, ' ')), JSON.stringify(queue));
  // a pattern needs two parts
  await page.locator('#mtabs [data-lt="glossary"], nav [data-lp="glossary"]').first().click(); await sleep(300);
  await page.locator('#gl-chips [data-glk="all"]').click(); await sleep(200);
  await page.locator('#gl-new').click(); await sleep(150);
  await page.locator('#gl-en').fill('take …'); await page.locator('#gl-uk').fill('зняти'); await page.locator('#gl-save').click(); await sleep(300);
  const t = (await page.locator('.toast').allInnerTexts()).join(' | ');
  check('a construction with one part is refused with the reason', /принаймні два слова/.test(t), t);
  check('no page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
