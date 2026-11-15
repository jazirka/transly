// Browser regression check: the threads of «Пов’язане» (PC): constructions with a gap («take … off»), their colours and dashed arcs
// in the editor, the cards under the translation, and the right panel split into «Рядок» and «Обговорення».
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s21-threads.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHOT = process.env.SHOT_DIR || '';
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const cmd = (code, parameters, indent = 0) => ({ code, indent, parameters });
const say = (t, who = 'Cook') => [cmd(101, [who, 0, 0, 2, who]), cmd(401, [t])];
const MAP = { displayName: 'Town', events: [null, { id: 1, name: 'cook', x: 1, y: 1, pages: [{ list: [
  ...say('Take your hat off, then pick the red apple up.'), ...say('Please take the cloak off.'), ...say('He took his boots off.'), ...say('You can pick it up later.'), cmd(0, []),
] }] }] };

async function addTerm(page, en, uk, alt = '') {
  await page.locator('#gl-new').click(); await sleep(150);
  await page.locator('#gl-en').fill(en); await page.locator('#gl-uk').fill(uk);
  if (alt) await page.locator('#gl-alt').fill(alt);
  await page.locator('#gl-save').click(); await sleep(250);
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  await page.evaluate(async text => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('threads-game', { create: true });
    const data = await game.getDirectoryHandle('data', { create: true });
    const w = await (await data.getFileHandle('Map001.json', { create: true })).createWritable();
    await w.write(text); await w.close();
    window.showDirectoryPicker = async () => root.getDirectoryHandle('threads-game');
  }, JSON.stringify(MAP));
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1500);

  // the glossary: a pattern typed with three dots, words, and an alternative
  await page.locator('#mtabs [data-lt="glossary"], nav [data-lp="glossary"]').first().click(); await sleep(300);
  await addTerm(page, 'take ... off', 'зняти');
  await addTerm(page, 'pick … up', 'підняти');
  await addTerm(page, 'hat', 'капелюх', 'шапка');
  await addTerm(page, 'apple', 'яблуко');

  // the editor on the first row
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  await page.locator('#mtabs [data-lt="rows"]').first().click().catch(() => {}); await sleep(200);
  await page.locator('.row, .rw, [data-key]').filter({ hasText: 'Take your hat off' }).first().click().catch(() => {}); await sleep(400);
  const ta = page.locator('#i-tr');
  await ta.click(); await ta.fill('Зняти капелюх, потім підняти червоне яблуко.'); await sleep(500);

  const parts = await page.locator('#f-src .th').evaluateAll(els => els.map(e => ({ t: e.textContent, hk: e.dataset.hk, ci: e.dataset.ci, part: e.dataset.part ?? '' })));
  check('the original has a mark for every part: «Take», «hat», «off», «pick», «apple», «up»', parts.map(p => p.t).join('|') === 'Take|hat|off|pick|apple|up', JSON.stringify(parts));
  const take = parts.filter(p => p.hk === 'take … off');
  check('the pattern was typed with three dots and stored with the gap mark', take.length === 2 && take[0].part === '0' && take[1].part === '1', JSON.stringify(take));
  check('each entry has its own colour in the row', new Set(parts.map(p => p.ci)).size === 4, JSON.stringify(parts.map(p => p.ci)));
  const targetMarks = await page.locator('#te-layer mark.tt').evaluateAll(els => els.map(e => ({ t: e.textContent, hk: e.dataset.hk, ci: e.dataset.ci })));
  check('the translation underlines where each entry stands, with the same colour', targetMarks.length >= 4 && targetMarks.every(m => m.ci !== undefined), JSON.stringify(targetMarks));
  const arcs = await page.locator('#te-links .lk-arc').count();
  check('a dashed arc joins the parts of each pattern', arcs === 2, String(arcs));
  const arrows = await page.locator('#te-links path.lk-p').count();
  check('and each part has its arrow (2 + 1 + 2 + 1)', arrows === 6, String(arrows));
  // the cards under the translation
  await sleep(900);
  const cards = await page.locator('#f-threads .thc[data-hk]').evaluateAll(els => els.map(e => ({ hk: e.dataset.hk, ci: e.dataset.ci, text: e.innerText.replace(/\s+/g, ' ') })));
  check('a card for each entry of the row, in the colour of its thread', cards.length === 4 && cards.map(c => c.ci).join('') === '0123', JSON.stringify(cards.map(c => c.hk + ':' + c.ci)));
  check('the construction card says what it is and where it is used across the game', /конструкція/.test(cards[0].text) && /рядк/.test(cards[0].text) && !/рахую/.test(cards[0].text), cards[0] && cards[0].text);
  check('the verdict for this row is on the card', /є в перекладі/.test(cards[2].text) || /альтернатива/.test(cards[2].text), cards[2] && cards[2].text);
  check('«take … off» is used in two more rows of the game (took, take)', /ще 2 рядки/.test(cards[0].text), cards[0] && cards[0].text);
  // the right panel: two tabs
  const tabs = await page.locator('#rp-tabs [data-rt]').allInnerTexts();
  check('the right panel has two tabs: «Рядок» and «Обговорення»', tabs.length === 2 && /Рядок/.test(tabs[0]) && /Обговорення/.test(tabs[1]), JSON.stringify(tabs));
  check('the old sections «Терміни й назви з гри» and «Зв’язані рядки» are gone from it', (await page.locator('#pn-tm, #pn-lk').count()) === 0);
  check('the discussion is on its own tab: hidden while the row tab is open', !(await page.locator('#cm-in').isVisible()) && (await page.locator('.pn-sec[data-sec="tr"]').isVisible()));
  await page.locator('#rp-tabs [data-rt="cm"]').click(); await sleep(250);
  check('the discussion tab shows the discussion and hides the translation', (await page.locator('#cm-in').isVisible()) && !(await page.locator('.pn-sec[data-sec="tr"]').isVisible()));
  await page.locator('#rp-tabs [data-rt="row"]').click(); await sleep(250);
  // the table has no editor: the cards stand at the end of the row tab
  await page.locator('[data-m="table"]').click(); await sleep(500);
  await page.locator('.gr', { hasText: 'Take your hat off' }).first().click(); await sleep(500);
  const inPanel = await page.locator('#pn-th .thc[data-hk]').count();
  check('in the table the cards of the threads are in the right panel', inPanel === 4, String(inPanel));
  check('and not twice: the block under the editor is empty', (await page.locator('#f-threads-b .thc').count()) === 0);
  check('no page errors', errors.length === 0, errors.join(' | '));
  if (SHOT) await page.screenshot({ path: SHOT + '/s21-threads.png' });

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
