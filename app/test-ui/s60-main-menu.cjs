// Browser regression check: the main menu opens from the button at the left, from the one at the right, and with F10.
//   PC_URL=http://localhost:4285/ node test-ui/s60-main-menu.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 800 } })).newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  const open = () => page.locator('#menubar').isVisible();
  check('the menu is closed at first', !(await open()));
  await page.locator('#hamb').click(); await sleep(200);
  check('the button at the left opens it', await open());
  await page.locator('#hamb').click(); await sleep(200);
  check('and closes it', !(await open()));
  check('the button at the right is visible', await page.locator('#hamb2').isVisible());
  await page.locator('#hamb2').click(); await sleep(200);
  check('the button at the right opens it', await open());
  check('both buttons say it is open', (await page.locator('#hamb').getAttribute('aria-expanded')) === 'true' && (await page.locator('#hamb2').getAttribute('aria-expanded')) === 'true');
  await page.locator('#hamb2').click(); await sleep(200);
  check('it closes from there too', !(await open()));
  await page.mouse.click(2, 795); await page.keyboard.press('F10'); await sleep(200);
  check('F10 opens it', await open());
  await page.keyboard.press('F10'); await sleep(200);
  check('F10 closes it', !(await open()));
  check('no page errors', errors.length === 0, errors.join('|'));
  await browser.close();
  process.exit(failed ? 1 : 0);
})();
