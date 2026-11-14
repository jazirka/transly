// Browser regression checks for the rest of the accessibility audit: narrow windows, touch targets, grid row counts,
// one name for a status, QA announcements while typing. See s0-safety.cjs for how to run:
//   PC_URL=http://localhost:4285/ PHONE_URL=http://localhost:4284/ node test-ui/s14-a11y-extra.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const PHONE = process.env.PHONE_URL || 'http://localhost:4284/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': ['a', 'b', 'c'].map((k, i) => ({ key: k, source: i === 0 ? '\\N[1], line number 1 with a few more words in it' : 'Line number ' + (i + 1) + ' with a few more words in it', speaker: 'Hero', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => {
  const o = indexedDB.open('transly', 3);
  o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
  o.onerror = () => rej(o.error);
});
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const seed = async page => { const p = project(); const { snapshot } = p; delete p.snapshot; await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500); };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ---- phone: nothing leaves the screen at 320 px, touch targets are 44 px
  for (const w of [320, 340]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 700 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(PHONE); await sleep(600); await seed(page);
    await page.locator('.m-row').first().click(); await sleep(600);
    const off = await page.evaluate(() => [...document.querySelectorAll('button, select, input')].filter(e => { const b = e.getBoundingClientRect(); return b.width && (b.right > innerWidth + 0.5 || b.left < -0.5); }).map(e => e.className || e.tagName).slice(0, 5));
    check(`phone ${w} px: every control is on the screen (the main «Надіслати» button included)`, off.length === 0, JSON.stringify(off));
    const send = await page.locator('.m-act1 .m-primary').first().boundingBox();
    check(`phone ${w} px: the send button is whole`, !!send && send.x >= 0 && send.x + send.width <= w + 0.5, JSON.stringify(send));
    await page.locator('.m-tab, [data-tab="rows"]').first().click().catch(() => undefined);
    const small = await page.evaluate(() => [...document.querySelectorAll('.m-chip,.m-mini')].filter(e => e.getBoundingClientRect().width && e.getBoundingClientRect().height < 43.5).length);
    check(`phone ${w} px: chips and mini buttons are at least 44 px high`, small === 0, String(small));
    await ctx.close();
  }

  // ---- PC: narrow windows
  for (const w of [761, 800, 960, 1100]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: 800 } });
    const page = await ctx.newPage();
    await page.goto(PC); await sleep(600); await seed(page);
    await page.locator('.gr').nth(1).click(); await sleep(400);
    const r = await page.evaluate(() => {
      const box = e => e.getBoundingClientRect();
      const kids = [...document.querySelectorAll('.filters .fin, .filters .r > *, .filters .chipsHost > *')].map(box).filter(b => b.width);
      let overlap = 0;
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) { const a = kids[i], b = kids[j]; if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) overlap++; }
      const seg = document.querySelector('.seg'), last = seg && seg.lastElementChild;
      const st = [...document.querySelectorAll('footer.status > *')].map(box).filter(b => b.width);
      return { overlap, segWhole: !!seg && box(last).right <= box(seg).right + 0.5 && box(seg).right <= innerWidth, statusInside: st.every(b => b.left >= -0.5 && b.right <= innerWidth + 0.5), docW: document.documentElement.scrollWidth };
    });
    check(`PC ${w} px: filter controls do not overlap`, r.overlap === 0, JSON.stringify(r));
    check(`PC ${w} px: the mode switch is whole`, r.segWhole);
    check(`PC ${w} px: the status bar is inside the window`, r.statusInside);
    check(`PC ${w} px: no sideways scroll`, r.docW <= w);
    await ctx.close();
  }

  // ---- PC: grid row counts, one name for a status, QA announcements while typing
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await page.goto(PC); await sleep(600); await seed(page);
    const g = await page.evaluate(() => { const grid = document.getElementById('grid'); const rows = [...grid.querySelectorAll('.gr:not(.lazy)')]; return { count: grid.getAttribute('aria-rowcount'), cols: grid.getAttribute('aria-colcount'), header: grid.querySelector('.gh')?.getAttribute('aria-rowindex'), idx: rows.map(r => r.getAttribute('aria-rowindex')) }; });
    check('the grid says how many rows it has (4 = header + 3 rows)', g.count === '4', JSON.stringify(g));
    check('the header is row 1 and the drawn rows are 2, 3, 4', g.header === '1' && g.idx.join() === '2,3,4', JSON.stringify(g));
    check('the grid says how many columns it has', Number(g.cols) >= 6, g.cols);
    const dots = await page.evaluate(() => [...document.querySelectorAll('.gr .st .sd')].every(d => d.getAttribute('aria-hidden') === 'true'));
    check('a status has one name (the dot is hidden from screen readers, the text stays)', dots);
    // typing a row with an error: the field says so, in a live region, once the typing pauses
    await page.locator('.gr .tr').nth(0).click(); await page.keyboard.press('Escape'); await sleep(200);
    await page.locator('[data-m="edit"]').click(); await sleep(500);
    await page.locator('#i-tr').click(); await page.keyboard.type('Привіт без коду'); await sleep(1600);
    const live = await page.evaluate(() => ({ text: document.getElementById('qa-live')?.textContent ?? '', role: document.getElementById('qa-live')?.getAttribute('role'), inv: document.getElementById('i-tr').getAttribute('aria-invalid'), by: document.getElementById('i-tr').getAttribute('aria-describedby') }));
    check('the field points to the live region', live.by === 'qa-live' && live.role === 'status', JSON.stringify(live));
    check('a QA error is put into the live region while typing', /^Помилка QA/.test(live.text) && live.inv === 'true', JSON.stringify(live));
    await page.locator('#i-tr').fill(''); await page.keyboard.type('\\N[1], привіт'); await sleep(1600);
    const live2 = await page.evaluate(() => ({ text: document.getElementById('qa-live')?.textContent ?? '', inv: document.getElementById('i-tr').getAttribute('aria-invalid') }));
    check('with the error gone the field is valid again and the region says no error', live2.inv === 'false' && !/^Помилка QA/.test(live2.text), JSON.stringify(live2));
    check('no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
