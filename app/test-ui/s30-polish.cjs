// Browser regression check: scrollbars that take no room and show only under the pointer, the fade at the edges of the tab strip, the background
// of the «Сцени» window, the send button that is grey while you work elsewhere, and the primary button that follows the theme when hovered.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s30-polish.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const cmd = (code, parameters, indent = 0) => ({ code, indent, parameters });
const say = (t, who = 'Cook') => [cmd(101, [who, 0, 0, 2, who]), cmd(401, [t])];
const mapOf = (name, n) => ({ displayName: name, events: [null, { id: 1, name: 'e', x: 1, y: 1, pages: [{ list: [...Array.from({ length: n }, (_, i) => say(`${name} line ${i + 1}`)).flat(), cmd(0, [])] }] }] });
const NAMES = ['Town', 'Forest', 'Old house', 'Harbour', 'Market square', 'Castle hall', 'Dungeon one', 'Dungeon two', 'Library', 'Mountain pass', 'Frozen lake', 'Desert camp'];

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  await page.evaluate(async ({ maps }) => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('polish-game', { create: true });
    const data = await game.getDirectoryHandle('data', { create: true });
    for (let i = 0; i < maps.length; i++) { const w = await (await data.getFileHandle(`Map${String(i + 1).padStart(3, '0')}.json`, { create: true })).createWritable(); await w.write(maps[i]); await w.close(); }
    window.showDirectoryPicker = async () => root.getDirectoryHandle('polish-game');
  }, { maps: NAMES.map((n, i) => JSON.stringify(mapOf(n, i === 0 ? 60 : 6))) });
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1800);

  // ---- the scrollbars of the table take no room and show only while you point at it
  await page.locator('[data-m="table"]').click(); await sleep(500);
  const gw = await page.evaluate(() => { const g = document.querySelector('.gridwrap'); return { off: g.offsetWidth, cl: g.clientWidth, sh: g.scrollHeight, ch: g.clientHeight }; });
  check('the table has rows to scroll', gw.sh > gw.ch + 50, JSON.stringify(gw));
  check('the table has no gutter for a scrollbar (its rows reach the edge)', gw.off === gw.cl, JSON.stringify(gw));
  check('the browser bars are hidden and the thumb is not shown at rest', await page.evaluate(() => document.documentElement.classList.contains('ovsb') && !document.querySelector('.ovs-y.on')));
  const box = await page.locator('.gridwrap').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.move(box.x + box.width / 2 + 3, box.y + box.height / 2 + 3); await sleep(350);
  const shown = await page.evaluate(() => { const b = document.querySelector('.ovs-y'); const r = b.getBoundingClientRect(); return { on: b.classList.contains('on'), op: getComputedStyle(b).opacity, r: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }; });
  check('pointing at the table shows the thumb over its right edge', shown.on && shown.op === '1' && Math.abs(shown.r.x + shown.r.w - (box.x + box.width)) <= 6, JSON.stringify(shown) + ' vs ' + JSON.stringify(box));
  // dragging the thumb scrolls the table
  const top0 = await page.evaluate(() => document.querySelector('.gridwrap').scrollTop);
  await page.mouse.move(shown.r.x + shown.r.w / 2, shown.r.y + shown.r.h / 2); await page.mouse.down();
  await page.mouse.move(shown.r.x + shown.r.w / 2, shown.r.y + shown.r.h / 2 + 120, { steps: 6 }); await page.mouse.up(); await sleep(200);
  const top1 = await page.evaluate(() => document.querySelector('.gridwrap').scrollTop);
  check('dragging the thumb scrolls the table', top1 > top0 + 30, `${top0} -> ${top1}`);
  // pointing somewhere that does not scroll hides it
  await page.mouse.move(700, 20); await page.mouse.move(705, 22); await sleep(350);
  check('and it goes when the pointer leaves the area', await page.evaluate(() => !document.querySelector('.ovs-y.on')));

  // ---- the tab strip fades at the edge that has more tabs behind it
  const nodes = page.locator('#tree .node').filter({ hasText: 'Map0' });
  const count = await nodes.count();
  for (let i = 0; i < Math.min(count, NAMES.length); i++) { await nodes.nth(i).click().catch(() => {}); await sleep(150); }
  await sleep(300);
  const fade0 = await page.evaluate(() => { const h = document.getElementById('tabs-host'); return { over: h.scrollWidth - h.clientWidth, left: h.classList.contains('fade-l'), right: h.classList.contains('fade-r'), mask: getComputedStyle(h).maskImage || getComputedStyle(h).webkitMaskImage }; });
  check('many tabs overflow the strip', fade0.over > 20, JSON.stringify(fade0));
  check('the strip scrolled to the last tab fades on the left only', fade0.left && !fade0.right && /gradient/.test(fade0.mask), JSON.stringify(fade0));
  await page.evaluate(() => { const h = document.getElementById('tabs-host'); h.scrollLeft = 0; }); await sleep(200);
  const fade1 = await page.evaluate(() => { const h = document.getElementById('tabs-host'); return { left: h.classList.contains('fade-l'), right: h.classList.contains('fade-r') }; });
  check('at the start it fades on the right only', !fade1.left && fade1.right, JSON.stringify(fade1));
  await page.evaluate(() => { const h = document.getElementById('tabs-host'); h.scrollLeft = (h.scrollWidth - h.clientWidth) / 2; }); await sleep(200);
  const fade2 = await page.evaluate(() => { const h = document.getElementById('tabs-host'); return { left: h.classList.contains('fade-l'), right: h.classList.contains('fade-r') }; });
  check('in the middle it fades on both sides', fade2.left && fade2.right, JSON.stringify(fade2));

  // ---- Files and Scenes together: both windows are cards
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  const open = async lp => { await page.locator(`.strip [data-lp="${lp}"]`).click(); await sleep(350); };
  if (!(await page.locator('#tree').isVisible())) await open('files');
  await open('scenes');
  const cards = await page.evaluate(() => { const g = s => { const e = document.querySelector(s); if (!e || e.hidden || !e.getClientRects().length) return null; const c = getComputedStyle(e); return { bg: c.backgroundColor, r: c.borderTopLeftRadius, b: c.borderTopWidth }; }; return { files: g('#tree'), scenes: g('#lp-sc'), rows: g('#lp-rows') }; });
  check('the Scenes window is a card like the Files window (background, rounded, bordered)', !!cards.files && !!cards.scenes && cards.scenes.bg === cards.files.bg && cards.scenes.r === cards.files.r && cards.scenes.b === cards.files.b && cards.scenes.bg !== 'rgba(0, 0, 0, 0)', JSON.stringify(cards));

  // ---- the send button is grey while you work in another window
  await open('rows');
  await page.locator('#lp-rows .si').nth(1).click(); await sleep(500);
  await page.locator('#f-tr, textarea.tr-in').first().click(); await sleep(250);
  const send = () => page.evaluate(() => { const b = document.querySelector('#main #b-save') || document.querySelector('#b-save'); const c = getComputedStyle(b); return { pane: document.documentElement.dataset.pane, bg: c.backgroundColor, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent-solid').trim() }; });
  const hex = h => { const m = /^#(..)(..)(..)$/.exec(h); return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : h; };
  let s = await send();
  check('in the window you work in the send button is the colour of the project', s.pane === 'centre' && s.bg === hex(s.accent), JSON.stringify(s));
  await page.locator('#tree .node.cur, #tree .node[data-n]').first().click({ force: true }); await sleep(300);
  s = await send();
  check('in a window you are not in it is grey', s.pane !== 'centre' && /rgba\(255, 255, 255, 0\.15\)/.test(s.bg), JSON.stringify(s));

  // ---- a primary button follows the theme when hovered (it was a fixed purple)
  await page.locator('#hamb').click().catch(() => {}); await sleep(200);
  await page.locator('#settings').click().catch(() => {}); await sleep(500);
  const save = page.locator('#st-save');
  if (await save.count()) {
    await save.hover(); await sleep(250);
    const h = await page.evaluate(() => ({ bg: getComputedStyle(document.querySelector('#st-save')).backgroundColor, hi: getComputedStyle(document.documentElement).getPropertyValue('--accent-hi').trim() }));
    check('a hovered primary button wears the theme colour', h.bg === hex(h.hi), JSON.stringify(h));
  } else check('settings opened', false, 'no #st-save');
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close(); await browser.close();
  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nall checks passed');
})();
