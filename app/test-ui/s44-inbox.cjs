// Browser regression check: the bell (notifications) and the state of the last build in the build menu.
// The bell lists what needs attention (QA errors of the whole project, drafts, rows waiting for proofreading) and what the others did since the translator last looked;
// the build menu starts with the state of the last build and what was written after it. See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s44-inbox.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });

const T = 1700000000000;
const project = (build) => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' },
  ...(build ? { stamps: { build } } : {}),
  files: { 'Map001.json': {
    k0: { target: 'Привіт', status: 'draft', mt: T + 100 },
    k1: { target: 'Нокаут', status: 'done', mt: T + 3000, history: [{ at: T + 3000, who: 'Іван', what: 'надіслано', text: 'Нокаут' }, { at: T + 3100, who: 'Іван', what: 'вичитано', text: 'Нокаут' }] },
    k2: { target: 'Удар', status: 'appr', mt: T + 4000, comments: [{ who: 'Оля', at: T + 4000, text: 'Може, інакше?' }] },
    k3: { target: 'Тест', status: 'done', mt: T + 5000 },
    k5: { target: 'Привіт', status: 'done', mt: T + 6000 },
  } },
  snapshot: { 'Map001.json': ['Hello', 'Knockout', 'Strike', 'Test line', 'Untouched', 'Hi \\C[2]there\\C[0]'].map((source, i) => ({ key: 'k' + i, source, speaker: 'Hero', kind: 'dialogue', context: '' })) },
});
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];
  const open = async (build, seen = T + 500) => {
    const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
    page.on('pageerror', e => errors.push(String(e.message)));
    await page.goto(PC); await sleep(500);
    const p = project(build); const { snapshot } = p; delete p.snapshot;
    await page.evaluate(put, { text: JSON.stringify(p), snapshot });
    await page.evaluate(s => localStorage.setItem('transly.inboxSeen', String(s)), seen);
    await page.reload(); await sleep(1500);
    await page.locator('#lp-files .node, #tree .node').first().waitFor({ timeout: 5000 }).catch(() => {});
    return page;
  };
  // --- the build menu
  let page = await open({ mt: T + 1500, how: 'збірка', n: 2 });
  await page.locator('#cfg-btn').click(); await sleep(300);
  const bs = await page.locator('#cfgpop .bs').innerText();
  check('the build menu starts with «Остання збірка» and says the build is out of date, and by how many rows (sent and proofread, after it)', /Збірка застаріла/.test(bs) && /змінено 4 рядки/.test(bs) && /1 вичитано, 3 надіслано/.test(bs), bs.replace(/\n/g, ' | '));
  check('it has «Зібрати зараз» and «Що змінилося»', (await page.locator('#cfgpop [data-bs="build"]').count()) === 1 && (await page.locator('#cfgpop [data-bs="changes"]').count()) === 1);
  check('the run button carries the mark of an out-of-date build', await page.locator('#run-btn.stale').count() === 1 && /змінено 4 рядки/.test(await page.locator('#run-btn').getAttribute('title')));
  await page.locator('#cfgpop [data-bs="changes"]').click(); await sleep(700);
  check('«Що змінилося» opens exactly those rows (in the table)', (await page.locator('#grid .gr').count()) === 4, String(await page.locator('#grid .gr').count()));
  await page.context().close();
  page = await open({ mt: T + 9000, how: 'збірка', n: 4 });
  await page.locator('#cfg-btn').click(); await sleep(300);
  check('a build with nothing after it is «свіжа» and the run button has no mark', /Збірка свіжа/.test(await page.locator('#cfgpop .bs').innerText()) && (await page.locator('#run-btn.stale').count()) === 0);
  await page.context().close();
  page = await open(null);
  await page.locator('#cfg-btn').click(); await sleep(300);
  check('no build yet: the menu says so, nothing is marked', /Збірки ще не було/.test(await page.locator('#cfgpop .bs').innerText()) && (await page.locator('#run-btn.stale').count()) === 0);
  await page.context().close();

  // --- the bell
  page = await open({ mt: T + 1500, how: 'збірка', n: 2 });
  await sleep(3500); // the QA of the whole project is made when the data has been still for a moment
  const badge = async () => ({ n: await page.locator('#bell-n').innerText().catch(() => ''), shown: await page.locator('#bell-n').isVisible(), bad: await page.locator('#bell-n.bad').count() });
  let b = await badge();
  check('the bell shows how many things wait (the QA error counts: it is red)', b.shown && b.n === '5' && b.bad === 1, JSON.stringify(b));
  await page.locator('#bell').click(); await sleep(300);
  const heads = await page.locator('#inboxpop .pj-h').allInnerTexts();
  const rows = await page.locator('#inboxpop [data-ib]').allInnerTexts();
  check('the menu has «Потребує уваги» and «Нове від інших»', heads.join('|') === 'Потребує уваги|Нове від інших', heads.join('|'));
  check('it lists the QA error, the comment and the work of the others, rows waiting for proofreading and drafts', /помилка QA/.test(rows.join('\n')) && /Оля: 1 новий коментар/.test(rows.join('\n')) && /Зміни від Іван/.test(rows.join('\n')) && /надіслано 1 · вичитано 1/.test(rows.join('\n')) && /3 рядки чекають вичитки/.test(rows.join('\n')) && /1 чернетка не надіслано/.test(rows.join('\n')), rows.join(' | ').replace(/\n/g, ' '));
  check('the state of the build is not in the bell (it is in the build menu)', !/застар/i.test(rows.join(' ')) && !/збірк/i.test(rows.join(' ').replace(/Збірка/g, '')));
  check('the menu looks like the other menus (the same popup, the same rows)', (await page.locator('#inboxpop.pop.cfgpop').count()) === 1 && (await page.locator('#inboxpop [role="menuitem"] .cfg-t').count()) >= 5);
  await page.locator('#inboxpop [data-ib="unreviewed"]').click(); await sleep(700);
  check('a click shows those rows (three waiting for proofreading)', (await page.locator('#grid .gr').count()) === 3, String(await page.locator('#grid .gr').count()));
  await page.locator('#bell').click(); await sleep(300);
  await page.locator('#inboxpop [data-ib="~read"]').click(); await sleep(500);
  b = await badge();
  check('«Позначити нове прочитаним» takes the news off (3 things are left, the state stays)', b.n === '3', JSON.stringify(b));
  const seen = await page.evaluate(() => Number(localStorage.getItem('transly.inboxSeen')));
  check('the mark is kept', seen > T + 10000, String(seen));
  await page.locator('#bell').click(); await sleep(300);
  check('and the menu has no news now', !(await page.locator('#inboxpop .pj-h', { hasText: 'Нове від інших' }).count()));
  await page.keyboard.press('Escape'); await sleep(200);
  check('Esc closes it', await page.locator('#inboxpop').isHidden());
  if (process.env.SHOT_DIR) { await page.locator('#bell').click(); await sleep(300); await page.screenshot({ path: process.env.SHOT_DIR + '/s44-inbox.png', clip: { x: 700, y: 0, width: 700, height: 400 } }); await page.keyboard.press('Escape'); await page.locator('#cfg-btn').click(); await sleep(300); await page.screenshot({ path: process.env.SHOT_DIR + '/s44-build.png', clip: { x: 700, y: 0, width: 700, height: 460 } }); }
  await page.context().close();
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
