// Browser regression check: the catalog of plugins in the manager. The examples the application carries are listed and install without a network; a
// catalog the user adds (an https address, served here by the page's own network stub) lists more, each entry with its state; an entry installs through the
// same consent screen as any plugin; and a folder the application does not understand is suggested a plugin from the catalog, told from its files.
// Run as s0-safety.cjs:   PC_URL=http://localhost:4285/ node test-ui/s53-catalog.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + String(detail).slice(0, 220) : '')); if (!ok) failed++; };

const CATALOG = JSON.stringify({ catalogVersion: 1, name: 'Friends', plugins: [
  { id: 'acme.wolf', name: 'Wolf RPG', description: 'Games of Wolf RPG Editor', version: '1.2.0', author: 'Acme', tags: ['engine', 'format'], repo: 'acme/transly-wolf@v1.2.0', detect: { anyFiles: ['**/*.wolf'] } },
  { id: 'pl.lang', name: 'Polski', description: 'Interface in Polish', version: '0.3.0', tags: ['language'], languages: ['pl'], url: 'https://example.com/pl/transly-plugin.json' },
  { id: 'old.thing', name: 'Needs a newer Transly', version: '1.0.0', tags: ['help'], requires: { transly: '>=99.0.0' }, url: 'https://example.com/old/transly-plugin.json' },
  { id: 'Bad Id', name: 'Broken', url: 'https://example.com/x' },
] });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  // the page's network: the catalog answers, everything else is refused
  await ctx.route('https://example.com/**', r => (r.request().url().endsWith('/catalog.json') ? r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: CATALOG }) : r.fulfill({ status: 404, headers: { 'access-control-allow-origin': '*' }, body: 'no' })));
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(1200);

  const bar = async () => { if (!(await page.locator('#menubar').isVisible())) { await page.locator('#hamb').click({ timeout: 2000 }).catch(() => {}); await sleep(250); } };
  const menu = async name => { await bar(); await sleep(100); await page.locator('#menubar [data-mb], #menubar button').filter({ hasText: new RegExp('^' + name + '$') }).first().click(); await sleep(250); };
  await menu('Файл'); await page.locator('#mdd').getByText('Розширення…').first().click(); await sleep(500);
  const dlg = page.locator('dialog.exd-dlg');
  await dlg.locator('.st-ti', { hasText: 'Каталог' }).click(); await sleep(700);
  let list = await dlg.locator('#ex-clist').innerText();
  check('the catalog lists the examples the application carries', /Style pack/.test(list) && /Lang files/i.test(list) && /Приклади в застосунку/.test(list), list.replace(/\s+/g, ' ').slice(0, 160));

  // one of them installs, offline, through the consent screen
  await dlg.locator('.ex-row[data-entry="example.style-pack"] [data-act="cat-install"]').click(); await sleep(800);
  const consent = await dlg.locator('#ex-body').innerText();
  check('«Встановити» shows what the plugin adds before it writes anything', /Style pack/.test(consent) && /правила QA: 4/.test(consent), consent.replace(/\s+/g, ' ').slice(0, 160));
  await dlg.locator('[data-act="do-install"]').click(); await sleep(900);
  check('and installs it', /Style pack/.test(await dlg.locator('#ex-body').innerText()) && (await dlg.locator('#ex-body').innerText()).includes('Правила QA'));
  await dlg.locator('.st-ti', { hasText: 'Каталог' }).click(); await sleep(500);
  const row = await dlg.locator('.ex-row[data-entry="example.style-pack"]').innerText();
  check('in the catalog the installed entry offers «Докладніше», not «Встановити»', /Докладніше/.test(row) && !/Встановити/.test(row), row.replace(/\s+/g, ' '));

  // add a catalog of an address: the list is asked for, the bad entry is left out
  await dlg.locator('#ex-cat').fill('http://example.com/catalog.json'); await dlg.locator('[data-act="cat-add"]').click(); await sleep(400);
  check('an address that is not https is refused', /https/.test(await dlg.locator('#ex-body').innerText()) && !(await dlg.locator('.ex-row', { hasText: 'example.com' }).count()));
  await dlg.locator('#ex-cat').fill('https://example.com/catalog.json'); await dlg.locator('[data-act="cat-add"]').click(); await sleep(1200);
  list = await dlg.locator('#ex-clist').innerText();
  check('the added catalog\'s plugins are listed with their tags', /Wolf RPG/.test(list) && /Polski/.test(list) && /Friends/.test(list), list.replace(/\s+/g, ' ').slice(0, 200));
  check('an entry that is broken is not listed', !/Broken/.test(list));
  check('an entry for a newer Transly cannot be installed', await dlg.locator('.ex-row[data-entry="old.thing"] button[disabled]').count() === 1, await dlg.locator('.ex-row[data-entry="old.thing"]').innerText());
  const sources = await dlg.locator('#ex-body').innerText();
  check('the catalog says how many it has and that one entry was left out', /Розширень: 3/.test(sources) && /пропущено записів: 1/.test(sources), sources.replace(/\s+/g, ' ').slice(-300));

  // search and tags
  await dlg.locator('#ex-cq').fill('polish'); await sleep(250);
  let f = await dlg.locator('#ex-clist').innerText();
  check('the search narrows the list', /Polski/.test(f) && !/Wolf/.test(f), f.replace(/\s+/g, ' '));
  await dlg.locator('#ex-cq').fill('');
  await dlg.locator('[data-act="cat-tag"][data-tag="language"]').click(); await sleep(250);
  f = await dlg.locator('#ex-clist').innerText();
  check('a tag filters by what a plugin adds', /Polski/.test(f) && !/Wolf/.test(f) && !/Style pack/.test(f), f.replace(/\s+/g, ' '));

  // it is kept on the device: after a reload the list is there without asking the net
  await page.reload(); await sleep(1500);
  await menu('Файл'); await page.locator('#mdd').getByText('Розширення…').first().click(); await sleep(500);
  const d2 = page.locator('dialog.exd-dlg');
  await d2.locator('.st-ti', { hasText: 'Каталог' }).click(); await sleep(700);
  check('after a reload the added catalog is still there, with its plugins', /Wolf RPG/.test(await d2.locator('#ex-clist').innerText()));
  // a folder the application does not understand, but a catalog entry fits its files: the guidance offers it (last: a picked folder is kept, and a reload after it is not what is tested here)
  await d2.locator('#ex-done').click(); await sleep(300);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('fs-wolf', { create: true });
    const w = await (await game.getFileHandle('Data.wolf', { create: true })).createWritable();
    await w.write('binary-ish'); await w.close();
    window.showDirectoryPicker = async () => root.getDirectoryHandle('fs-wolf');
  });
  await page.locator('#proj-btn').click(); await sleep(250); await page.locator('#projpop [data-pj="folder"]').click(); await sleep(1500);
  const gd = page.locator('dialog.gd-dlg');
  const gt = await gd.innerText().catch(() => '');
  check('the guidance for an unknown folder suggests the plugin of the catalog that fits its files', /Можливо, підійде з каталогу/.test(gt) && /Wolf RPG/.test(gt) && !/Polski/.test(gt), gt.replace(/\s+/g, ' ').slice(0, 220));
  await gd.locator('[data-g="catalog"]').click(); await sleep(700);
  const d3 = page.locator('dialog.exd-dlg');
  const shown = await d3.locator('#ex-clist').innerText().catch(() => '');
  check('and «Показати в каталозі» opens the catalog on that plugin', /Wolf RPG/.test(shown) && !/Polski/.test(shown) && !/Style pack/.test(shown), shown.replace(/\s+/g, ' ').slice(0, 160));

  const d4 = d3;
  await d4.locator('[data-act="cat-remove"]').click(); await sleep(500);
  check('and can be taken away', !/Wolf RPG/.test(await d4.locator('#ex-clist').innerText()));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
