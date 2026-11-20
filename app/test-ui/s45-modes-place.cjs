// Browser regression check: the modes (Таблиця · Редагування · Сцена) look like the strips at the sides (separate rounded squares with hairlines, no pill round the group)
// and stand in the middle of the top bar on a wide window (they open the middle of the window from above); the progress stands beside the project name and is cut with «…», not hidden.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s45-modes-place.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });

const T = 1700000000000;
const project = () => ({ version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [], settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' }, files: { 'Map001.json': { k0: { target: 'Нокаут', status: 'done', mt: T + 3000 } } }, snapshot: { 'Map001.json': ['Knockout', 'Another line here'].map((source, i) => ({ key: 'k' + i, source, speaker: 'Hero', kind: 'dialogue', context: '' })) } });
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const errors = [];
  const open = async w => {
    const page = await (await browser.newContext({ viewport: { width: w, height: 700 } })).newPage();
    page.on('pageerror', e => errors.push(String(e.message)));
    await page.goto(PC); await sleep(500);
    const p = project(); const { snapshot } = p; delete p.snapshot;
    await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);
    return page;
  };
  const geo = page => page.evaluate(() => { const r = s => { const b = document.querySelector(s).getBoundingClientRect(); return { l: b.left, r: b.right, w: b.width }; }; const cs = getComputedStyle(document.querySelector('#seg')); const b = getComputedStyle(document.querySelector('#seg button[data-m="edit"]')); return { win: innerWidth, seg: r('#seg'), pg: r('#pg'), proj: r('#proj-btn'), cfg: r('#cfg-btn'), shadow: cs.boxShadow, bg: cs.backgroundColor, radius: b.borderRadius, divider: getComputedStyle(document.querySelector('#seg button[data-m="edit"]'), '::before').content, txt: document.querySelector('#pg-txt').innerText, txtVis: document.querySelector('#pg-txt').getBoundingClientRect().width }; });
  for (const w of [1400, 1920]) {
    const page = await open(w); const g = await geo(page);
    check(`${w}: the modes stand in the middle of the top bar`, Math.abs((g.seg.l + g.seg.r) / 2 - w / 2) <= 3, JSON.stringify(g.seg));
    check(`${w}: they do not touch the progress or the build button`, g.pg.r + 6 <= g.seg.l && g.seg.r + 6 <= g.cfg.l, JSON.stringify(g));
    check(`${w}: the progress stands beside the name of the project (to the left of the modes)`, g.pg.l >= g.proj.r && g.pg.l < g.seg.l);
    check(`${w}: the progress is cut, not hidden (the whole text is still there for a screen reader)`, g.txt.startsWith('Перекладено') && g.txtVis > 20, `${g.txt} | ${g.txtVis}`);
    check(`${w}: no pill round the group, rounded squares with a hairline between them`, g.shadow === 'none' && g.bg === 'rgba(0, 0, 0, 0)' && g.divider === '""', JSON.stringify([g.shadow, g.bg, g.radius, g.divider]));
    if (w === 1400) { await page.locator('[data-m="table"]').click(); await sleep(300); check('the modes still work', (await page.locator('[data-m="table"].on').count()) === 1); }
    await page.context().close();
  }
  const narrow = await open(1100); const n = await geo(narrow);
  check('on a narrow window the modes keep their old place (right after the project and its branch button)', n.seg.l < 300 && n.seg.l > n.proj.r, JSON.stringify(n.seg));
  await narrow.context().close();
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
