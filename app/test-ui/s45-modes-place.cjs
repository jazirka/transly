// Browser regression check: the top bar. Two clusters glued to the edges of the window (left: the project, its branch, the mode; right: run, notifications, window
// controls), the modes are three icons without words, nothing moves or is squeezed when the window is scaled (the logo and the branch button keep their size), the arrow
// of a menu button is small, the close button stands on the same axis as the icons of the right rail (and the logo on that of the left rail), and the left rail only
// has the windows the mode needs (the table is the rows already: no «Рядки» and «Сцени» in it).
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
    await page.evaluate(() => { document.documentElement.classList.add('chrome-own'); const w = document.getElementById('wctl'); if (w) w.hidden = false; });
    await sleep(250);
    return page;
  };
  const geo = page => page.evaluate(() => {
    const r = s => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { l: Math.round(b.left * 10) / 10, r: Math.round(b.right * 10) / 10, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, cx: Math.round((b.left + b.width / 2) * 10) / 10 }; };
    const seg = [...document.querySelectorAll('#seg button')];
    const caret = document.querySelector('#proj-btn .caret').getBoundingClientRect();
    const txt = document.querySelector('#pg-txt');
    return {
      win: innerWidth, logo: r('.logo'), hamb: r('#hamb'), proj: r('#proj-btn'), br: r('#br-btn'), seg: r('#seg'), pg: r('#pg'), cfg: r('#cfg-btn'), close: r('#wc-close'),
      segText: seg.map(b => b.textContent.trim()), segNames: seg.map(b => !!b.title && !!b.getAttribute('aria-label')), segSize: seg.map(b => { const x = b.getBoundingClientRect(); return Math.round(x.width) + 'x' + Math.round(x.height); }),
      caret: Math.round(caret.width) + 'x' + Math.round(caret.height), txt: txt.textContent, txtVis: txt.clientWidth,
      rail: [...document.querySelectorAll('#stabs button')].map(b => Math.round((b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2) * 10) / 10),
      lrail: [...document.querySelectorAll('#strip button')].filter(b => b.offsetParent).map(b => ({ id: b.dataset.lp, cx: Math.round((b.getBoundingClientRect().left + b.getBoundingClientRect().width / 2) * 10) / 10 })),
    };
  });
  const widths = [1920, 1400, 1180, 1000, 780], at = {};
  for (const w of widths) {
    const page = await open(w); const g = at[w] = await geo(page);
    check(`${w}: project → branch → mode, in this order and without overlap`, g.logo.r <= g.hamb.l && g.hamb.r <= g.proj.l && g.proj.r <= g.br.l && g.br.r <= g.seg.l, JSON.stringify([g.logo, g.hamb, g.proj, g.br, g.seg]));
    check(`${w}: the logo is not squeezed and stands where it stood`, g.logo.w === 20 && g.logo.h === 20 && g.logo.l === 10, JSON.stringify(g.logo));
    check(`${w}: the branch button keeps its size`, g.br.w === at[widths[0]].br.w, `${g.br.w} / ${at[widths[0]].br.w}`);
    check(`${w}: the modes are three icons without words, each with a name and a tip`, g.segText.every(t => t === '') && g.segNames.every(Boolean) && g.segSize.every(s => s === '28x28'), JSON.stringify([g.segText, g.segNames, g.segSize]));
    check(`${w}: the progress gives way to its neighbours and never overlaps them`, g.pg.w === 0 || (g.pg.l >= g.seg.r && g.pg.r <= g.cfg.l), JSON.stringify([g.pg, g.seg, g.cfg]));
    check(`${w}: the arrow of a menu button is small`, g.caret === '10x10', g.caret);
    check(`${w}: the close button and the icons of the right rail are on one axis`, g.rail.length >= 3 && g.rail.every(x => x === g.close.cx), JSON.stringify([g.close.cx, g.rail]));
    check(`${w}: the logo and the icons of the left rail are on one axis`, g.lrail.length >= 2 && g.lrail.every(b => b.cx === g.logo.cx), JSON.stringify([g.logo.cx, g.lrail]));
    if (w === 1400) {
      check('1400: the progress is cut, not hidden (the whole text is still there for a screen reader)', g.txt.startsWith('Перекладено') && g.txtVis > 20, `${g.txt} | ${g.txtVis}`);
      // the left rail follows the mode: the table has no «Рядки» and no «Сцени» (it is the rows already)
      const rail = async () => page.evaluate(() => [...document.querySelectorAll('#strip button')].filter(b => b.offsetParent).map(b => b.dataset.lp).join(','));
      check('the table: only the files and the related window in the left rail', (await rail()) === 'files,glossary', await rail());
      check('and only one hairline between the two', (await page.evaluate(() => [...document.querySelectorAll('#strip hr')].filter(h => h.offsetParent).length)) === 1);
      await page.locator('[data-m="edit"]').click(); await sleep(400);
      check('the editing mode has the rows and the scenes as well', (await rail()) === 'files,rows,scenes,glossary', await rail());
      await page.locator('[data-m="table"]').click(); await sleep(400);
      check('back in the table the rows and scenes go again and the files open', (await rail()) === 'files,glossary' && (await page.locator('#strip button[data-lp="files"].on').count()) === 1, await rail());
    }
    await page.context().close();
  }
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
