// Browser regression check: the editing view as cards. The captions of the original and of the translation are one line between the two boxes,
// joined by an arrow; the field and its plate (the lighter strip with the tools) are one box with one ring; the counter is a fraction with no
// box of its own; the remarks of the row (QA) stand in one card under the field that is not there while there is nothing to say.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s35-card.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const SRC = 'Take your hat off.';
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' },
  files: { 'Map001.json': { a: { target: 'Зніми капелюх.', status: 'done', mt: 5 }, b: { target: 'Ок', status: 'draft', mt: 6 }, c: { target: 'Зніми шапку.', status: 'done', mt: 7 } } },
  snapshot: { 'Map001.json': [SRC, SRC, SRC].map((source, i) => ({ key: 'abc'[i], source, speaker: 'Hero', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => {
  const o = indexedDB.open('transly', 3);
  o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
  o.onerror = () => rej(o.error);
});
const sum = c => (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).reduce((a, b) => a + Number(b), 0);

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);
  await page.locator('[data-m="edit"]').click(); await sleep(500);
  await page.locator('#lp-rows .si').nth(1).click(); await sleep(700);

  // ---- the caption row between the boxes
  const g = await page.evaluate(() => {
    const r = q => document.querySelector(q)?.getBoundingClientRect();
    const o = r('.bridge > .lbl'), a = r('.bridge .arrow'), c = r('#f-eq .eqchip'), t = r('#f-trlbl'), src = r('#f-src'), box = r('.ebox');
    return { o: o && [Math.round(o.left), Math.round(o.right), Math.round(o.top)], a: a && [Math.round(a.left), Math.round(a.right), Math.round(a.height)], c: c && [Math.round(c.left), Math.round(c.right)], t: t && [Math.round(t.left), Math.round(t.right)], srcBottom: src && Math.round(src.bottom), srcLeft: src && Math.round(src.left), boxTop: box && Math.round(box.top), boxRight: box && Math.round(box.right), text: document.querySelector('.bridge')?.innerText.replace(/\s+/g, ' ') };
  });
  check('the caption of the original is under its box, at the left', !!g.o && g.o[2] >= g.srcBottom && g.o[0] - g.srcLeft < 12, JSON.stringify(g));
  check('the caption of the translation is at the right end, above the field', !!g.t && g.boxRight - g.t[1] < 12 && g.t[1] - 0 > g.o[1] && g.t[0] > g.a[0], JSON.stringify(g));
  check('between them is a long arrow (a line one pixel thick)', !!g.a && g.a[1] - g.a[0] > 200 && g.a[2] <= 2 && g.a[0] >= g.o[1] && g.a[1] <= g.c[0] + 2, JSON.stringify(g.a));
  check('the chip of the twins stands right before the caption of the translation', g.t[0] - g.c[1] >= 0 && g.t[0] - g.c[1] < 30, JSON.stringify(g));
  check('the row reads «ОРИГІНАЛ · EN … ≡ 2 ПЕРЕКЛАД · UK»', /Оригінал · EN.*≡\s*2.*Переклад · UK/i.test(g.text), g.text);
  check('the original box has no caption of its own any more', (await page.locator('#f-src').evaluate(e => e.parentElement.querySelector(':scope > .lbl') === null)));
  check('the translation field is close to the caption row', g.boxTop - (g.o[2] + 17) < 18, `${g.boxTop} vs ${g.o[2]}`);
  // the caption row stands in the middle between the box of the original and the field of the translation (the same space above and below)
  const mid = await page.evaluate(() => { const b = document.querySelector('.bridge').getBoundingClientRect(), s = document.querySelector('#f-src').getBoundingClientRect(), e = document.querySelector('.ebox').getBoundingClientRect(), c = b.top + b.height / 2; return { above: +(c - s.bottom).toFixed(1), below: +(e.top - c).toFixed(1) }; });
  const tri = await page.evaluate(() => { const a = document.querySelector('.bridge .arrow'); return { line: getComputedStyle(a).backgroundColor, head: getComputedStyle(a, '::after').borderLeftColor }; });
  check('the head of the arrow has the colour of its line', tri.line === tri.head, JSON.stringify(tri));
  check('the caption row stands in the middle between the two boxes', Math.abs(mid.above - mid.below) <= 1, JSON.stringify(mid));

  // ---- one box: the field over the plate, one ring
  const box = await page.evaluate(() => {
    const e = document.querySelector('.ebox'), te = e.querySelector('.te'), bar = e.querySelector('.edbar'), ta = e.querySelector('#i-tr');
    const c = x => getComputedStyle(x);
    return { has: !!e.querySelector('#i-tr') && !!e.querySelector('#b-save') && !!e.querySelector('#b-clear') && !!e.querySelector('#cnt2'), radius: c(e).borderTopLeftRadius, bodyBg: c(e).backgroundColor, plateBg: c(bar).backgroundColor, taBorder: c(ta).borderTopColor, order: te.getBoundingClientRect().bottom <= bar.getBoundingClientRect().top + 1 };
  });
  check('the field, the plate with the tools and the counter are one box', box.has && box.order, JSON.stringify(box));
  check('the box is rounded like the tool windows (12 px)', box.radius === '12px', box.radius);
  check('the plate is lighter than the field', sum(box.plateBg) > sum(box.bodyBg) + 20, `${box.plateBg} vs ${box.bodyBg}`);
  check('the field has no border of its own', box.taBorder === 'rgba(0, 0, 0, 0)' || /, 0\)$/.test(box.taBorder), box.taBorder);
  await page.locator('#i-tr').click(); await sleep(250);
  const ring = await page.evaluate(() => ({ field: getComputedStyle(document.querySelector('.ebox .te')).borderTopColor, box: getComputedStyle(document.querySelector('.ebox')).borderTopColor, plate: getComputedStyle(document.querySelector('.ebox .edbar')).borderBottomColor, accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() }));
  const hex = h => { const m = /^#(..)(..)(..)$/.exec(h); return m ? `rgb(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)})` : h; };
  check('the ring is the field\'s alone while you type: the plate and the border of the box stay neutral', ring.field === hex(ring.accent) && ring.plate !== hex(ring.accent) && ring.box !== hex(ring.accent), JSON.stringify(ring));

  // ---- the counter is a fraction
  const cnt = await page.evaluate(() => { const n = document.querySelector('#c-n').getBoundingClientRect(), o = document.querySelector('#c-o').getBoundingClientRect(), b = getComputedStyle(document.querySelector('#cnt2')); return { n: document.querySelector('#c-n').textContent, o: document.querySelector('#c-o').textContent, stacked: n.bottom <= o.top + 1, bg: b.backgroundColor, border: b.borderTopWidth, label: document.querySelector('#cnt2').getAttribute('aria-label') }; });
  check('the counter is the translation over the original', cnt.n === '2' && cnt.o === '18' && cnt.stacked, JSON.stringify(cnt));
  check('with no box of its own', /rgba\(0, 0, 0, 0\)/.test(cnt.bg) && cnt.border === '0px', JSON.stringify(cnt));
  check('and it says in words what it counts (for a screen reader)', /2 з 18/.test(cnt.label ?? ''), cnt.label ?? '');

  // ---- the remarks: one card that is there only when there is something to say
  const qa = await page.evaluate(() => { const c = document.getElementById('f-qacard'); if (!c || c.hidden) return null; const h = c.querySelector('.qh'), b = c.querySelector('.qb'); return { title: h.textContent.trim(), rows: c.querySelectorAll('.qa-row').length, hBg: getComputedStyle(h).backgroundColor, bBg: getComputedStyle(c).backgroundColor, radius: getComputedStyle(c).borderTopLeftRadius, after: c.getBoundingClientRect().top >= document.querySelector('.ebox').getBoundingClientRect().bottom, btn: !!c.querySelector('.ign, .fix') }; });
  check('a row with a remark has the card under the field, titled with the count', !!qa && /^Зауваження · 1$/.test(qa.title) && qa.rows === 1 && qa.after, JSON.stringify(qa));
  check('the card has a lighter header over a dark body and the same rounding', !!qa && sum(qa.hBg) > sum(qa.bBg) + 20 && qa.radius === '12px', JSON.stringify(qa));
  check('the buttons of the remark are in the card', !!qa && qa.btn);
  await page.locator('#lp-rows .si').nth(0).click(); await sleep(600);
  check('a row with nothing to say has no card', await page.evaluate(() => { const c = document.getElementById('f-qacard'); return !c || c.hidden || !c.getClientRects().length; }));
  check('no page errors', errors.length === 0, errors.join(' | '));
  if (process.env.SHOT_DIR) { await page.locator('#lp-rows .si').nth(1).click(); await sleep(600); await page.screenshot({ path: process.env.SHOT_DIR + '/s35-card.png' }); }
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
