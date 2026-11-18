// Browser regression check: the update in the background (the Windows app, a Tauri stand-in): a downloaded installer that waits shows the chip «↻ Оновлення готове» in the
// status bar (no dialog), the shell is told how to behave when the app closes, and a press on the chip asks for a start after the install and closes the window the usual way.
// In a plain browser there is no chip. See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s42-background-update.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const STUB = `(() => {
  window.__calls = [];
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: () => 1, unregisterCallback() {}, convertFileSrc: p => p,
    invoke: async (cmd, args) => {
      window.__calls.push({ cmd, args });
      if (cmd === 'pending_update') return 'bbbb2222';
      if (cmd === 'plugin:event|listen') return 1;
      if (cmd === 'plugin:window|is_maximized') return false;
      return null;
    },
  };
})();`;

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];

  // a plain browser: nothing to update in the background, no chip
  const plain = await (await browser.newContext({ viewport: { width: 1400, height: 860 } })).newPage();
  plain.on('pageerror', e => errors.push(String(e.message)));
  await plain.goto(PC); await sleep(5200);
  check('in a plain browser the chip of the update is not shown', !(await plain.locator('#sb-upd').isVisible()));
  await plain.close();

  // the Windows app
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' });
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.addInitScript(STUB);
  await page.goto(PC); await sleep(5500);
  const calls = () => page.evaluate(() => window.__calls.map(c => c.cmd));
  check('the shell is told that a waiting update is installed when the app closes (the setting is on by default)', (await page.evaluate(() => window.__calls.find(c => c.cmd === 'set_update_mode')))?.args?.auto === true);
  check('the app asks the shell which installer waits', (await calls()).includes('pending_update'));
  check('a waiting update shows the chip in the status bar', await page.locator('#sb-upd').isVisible(), await page.locator('#sb-upd').innerText().catch(() => ''));
  check('and no dialog stands in the way', (await page.locator('dialog[open]').count()) === 0);
  check('the chip says what it does', /Натисніть, щоб оновитися зараз/.test((await page.locator('#sb-upd').getAttribute('title')) ?? ''));
  await page.locator('#sb-upd').click(); await sleep(600);
  const after = await calls();
  check('a press asks the shell to start the app again after the install, then closes the window the usual way', after.includes('relaunch_on_exit') && after.indexOf('relaunch_on_exit') < after.findIndex(c => /^plugin:window\|(close|destroy)$/.test(c)), JSON.stringify(after.slice(-6)));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
