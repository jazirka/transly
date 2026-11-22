// Browser regression check: own tooltips. A hovered element with a title shows the application's tip (not the system's), the title is back when the pointer
// leaves, the tip stays inside the window, and a click or a key hides it. Run as s0-safety.cjs:   PC_URL=http://localhost:4285/ node test-ui/s54-tooltips.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + String(detail).slice(0, 200) : '')); if (!ok) failed++; };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(1500);
  const el = page.locator('#hamb');
  const title = await el.getAttribute('title');
  check('the button has a title to show', !!title, title);
  await el.hover(); await sleep(150);
  check('the system title is taken off while hovering (so the system draws nothing)', (await el.getAttribute('title')) === null);
  check('the tip is not shown at once', await page.locator('.tip').isHidden().catch(() => true));
  await sleep(600);
  const tt = page.locator('.tip');
  check('after a short wait the own tip shows the title', (await tt.isVisible()) && (await tt.innerText()) === title, await tt.innerText().catch(() => ''));
  const b = await tt.boundingBox();
  check('and it stays inside the window', !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= 1400 && b.y + b.height <= 900, JSON.stringify(b));
  check('it takes no pointer events', (await tt.evaluate(n => getComputedStyle(n).pointerEvents)) === 'none');
  await page.mouse.move(700, 500); await sleep(150);
  check('leaving hides it and puts the title back', (await tt.isHidden()) && (await el.getAttribute('title')) === title);
  await el.hover(); await sleep(700);
  await page.keyboard.press('Shift');
  check('a key hides the tip', await tt.isHidden());
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
