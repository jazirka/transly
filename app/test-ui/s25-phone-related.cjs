// Browser regression check: «Пов’язане» on the phone: the words and constructions of the open row wear the colours of their threads in
// the original, the sheet has one tab for terms and memory together, and the glossary screen has kinds. See s0-safety.cjs for how to run:
//   PHONE_URL=http://localhost:4284/ node test-ui/s25-phone-related.cjs
const { chromium } = require('playwright');
const PHONE = process.env.PHONE_URL || 'http://localhost:4284/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [],
  terms: [{ en: 'take … off', uk: 'зняти', mt: 1 }, { en: 'hat', uk: 'капелюх', mt: 1 }],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': ['Take your hat off, please.', 'Hello there.'].map((src, i) => ({ key: 'k' + i, source: src, speaker: '', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 800 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PHONE); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);

  await page.locator('.m-row').first().click(); await sleep(700);
  const marks = await page.locator('#m-source .th').evaluateAll(els => els.map(e => ({ t: e.textContent, ci: e.dataset.ci, part: e.dataset.part ?? '' })));
  check('the original has a coloured mark for every part: «Take», «hat», «off»', marks.map(m => m.t).join('|') === 'Take|hat|off' && new Set(marks.map(m => m.ci)).size === 2, JSON.stringify(marks));

  await page.locator('[data-sheet]').click(); await sleep(600);
  const tabs = await page.locator('.m-stabs button').allInnerTexts();
  check('the sheet has «Пов’язане», «Коментарі», «Історія» (the memory is not a tab of its own any more)', tabs.length === 3 && /Пов’язане/.test(tabs[0]) && !tabs.some(t => /Пам’ять|Глосарій/.test(t)), JSON.stringify(tabs));
  const strands = await page.locator('.m-strand').evaluateAll(els => els.map(e => ({ ci: e.dataset.ci, text: e.innerText.replace(/\s+/g, ' ') })));
  check('it lists the construction and the word, each in its colour, with what they are', strands.length === 2 && /конструкція/.test(strands[0].text) && /слово/.test(strands[1].text) && strands[0].ci !== strands[1].ci, JSON.stringify(strands));
  await page.locator('.m-strand').nth(1).click(); await sleep(500);
  check('a tap puts the rendering into the translation', (await page.locator('#m-tr').inputValue()).includes('капелюх'), await page.locator('#m-tr').inputValue());

  await page.locator('[data-menu]').first().click(); await sleep(500);
  await page.locator('.m-menu button', { hasText: 'Пов’язане' }).first().click(); await sleep(600);
  const kinds = await page.locator('.gl-kinds .m-chip').allInnerTexts();
  check('the glossary screen is «Пов’язане» with kinds', kinds.join('|') === 'Усе|Слова|Конструкції', JSON.stringify(kinds));
  await page.locator('[data-glk="construction"]').click(); await sleep(400);
  const rows = await page.locator('.m-term-t').allInnerTexts();
  check('«Конструкції» lists only the construction', rows.length === 1 && /take … off/.test(rows[0]), JSON.stringify(rows));
  await page.locator('#g-en').fill('take …'); await page.locator('#g-uk').fill('зняти'); await page.locator('[data-gsave]').click(); await sleep(400);
  check('a construction with one part is refused with the reason', /принаймні два слова/.test(await page.locator('body').innerText()));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
