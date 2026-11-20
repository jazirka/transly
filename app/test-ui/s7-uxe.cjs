// Browser regression checks for the findings of the "connections" audit (ux-e). See s0-safety.cjs for how to run:
//   PC_URL=http://localhost:4285/ node test-ui/s7-uxe.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const project = (sources) => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [],
  settings: { tolerancePct: 1000, blockErrors: false, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': sources.map((src, i) => ({ key: 'k' + i, source: src, speaker: '', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => {
  const o = indexedDB.open('transly', 3);
  o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); };
  o.onerror = () => rej(o.error);
});
const stored = () => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const g = db.transaction('projects').objectStore('projects').get('default'); g.onsuccess = () => { db.close(); res(JSON.parse(g.result)); }; g.onerror = () => rej(g.error); }; o.onerror = () => rej(o.error); });
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const load = async (browser, sources) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  const { snapshot, ...rest } = project(sources);
  await page.evaluate(put, { text: JSON.stringify(rest), snapshot });
  await page.reload(); await sleep(1500);
  return { ctx, page, errors };
};

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ---- uxe-08: Ctrl+Z reaches the actions of an earlier session
  {
    const { ctx, page, errors } = await load(browser, ['One', 'Two', 'Three']);
    const send = async (n, text) => { await page.locator('.gr .tr').nth(n).click(); await page.keyboard.type(text); await page.keyboard.press('Control+Enter'); await sleep(900); };
    await send(0, 'Один'); await send(1, 'Два'); await send(2, 'Три');
    await page.reload(); await sleep(1800);
    await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await page.keyboard.press('Control+z'); await sleep(900);
    let p = await page.evaluate(stored); const e = () => ['k0', 'k1', 'k2'].map(k => p.files['Map001.json'][k]?.status);
    p = await page.evaluate(stored);
    check('Ctrl+Z after a reload takes back the newest action of the journal', e()[2] === 'draft' && e()[1] === 'done', JSON.stringify(e()));
    await page.keyboard.press('Control+z'); await sleep(900);
    p = await page.evaluate(stored);
    check('a second Ctrl+Z walks on to the one before it', e()[1] === 'draft' && e()[0] === 'done', JSON.stringify(e()));
    check('no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ---- uxe-06 / uxe-07: filled-in drafts are marked, can be filtered, and a bulk review says how many of them it approved
  {
    const { ctx, page, errors } = await load(browser, ['Yes', 'Yes', 'Yes', 'Other line']);
    await page.locator('.gr .tr').nth(0).click(); await page.keyboard.type('Так'); await page.keyboard.press('Control+Enter'); await sleep(1500);
    await page.locator('.filters [data-more]').first().click(); await sleep(250);
    const chips = await page.$$eval('#fpop .fi', cs => cs.map(c => c.textContent.trim().replace(/\s+/g, ' ')));
    check('«Ще ▾» offers «Авто» with the count of filled-in drafts', chips.some(c => /^Авто\s*2$/.test(c)), JSON.stringify(chips));
    const dashed = await page.$$eval('.gr .sd.draft.auto', d => d.length);
    check('filled-in drafts have their own dot in the table (dashed ring)', dashed === 2, 'n=' + dashed);
    await page.locator('#fpop .fi[data-filter="auto"]').click(); await sleep(500); await page.keyboard.press('Escape'); await sleep(150);
    check('the chosen filter shows as a chip', await page.locator('.filters .chip.on[data-filter="auto"]').count() === 1);
    const shown = await page.$$eval('.gr', r => r.length);
    check('the «Авто» filter shows only them', shown === 2, 'rows=' + shown);
    await page.getByLabel('Вибрати всі видимі рядки').click(); await sleep(300);
    await page.getByRole('button', { name: 'Вичитати' }).first().click(); await sleep(900);
    const body = await page.locator('body').innerText();
    check('the bulk review message says how many of the rows were filled in by the program', /Із них заповнених автоматично: 2/.test(body), (body.match(/Вичитано[^\n]*/) || [''])[0]);
    check('no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }


  // ---- uxe-05: the linked-rows dialog does not pre-tick proofread rows, and an update leaves them alone unless ticked
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await page.goto(PC); await sleep(800);
    const proj = { version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [],
      files: { 'Map001.json': { k0: { target: 'Так', status: 'done', mt: 5, src: 'Yes', orig: 'Так' }, k1: { target: 'Ага', status: 'appr', mt: 3, src: 'Yes' }, k2: { target: 'Угу', status: 'done', mt: 3, src: 'Yes', orig: 'Угу' } } },
      settings: { tolerancePct: 1000, blockErrors: false, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 } };
    const snapshot = { 'Map001.json': ['Yes', 'Yes', 'Yes'].map((src, i) => ({ key: 'k' + i, source: src, speaker: '', kind: 'dialogue', context: '' })) };
    await page.evaluate(put, { text: JSON.stringify(proj), snapshot });
    await page.reload(); await sleep(1500);
    await page.locator('.gr .src').nth(0).click(); await sleep(700);
    await page.locator('#pn-th .eqchip').click(); await sleep(300);
    await page.getByRole('button', { name: /Звірити/ }).click(); await sleep(700);
    const boxes = await page.$$eval('#lk-list input[type=checkbox]', b => b.map(x => x.checked));
    const labels = await page.$$eval('#lk-list .hint', h => h.map(x => x.textContent));
    check('the dialog lists the sent row ticked and the proofread row not ticked', boxes.length === 2 && boxes.filter(Boolean).length === 1, JSON.stringify(boxes) + ' ' + JSON.stringify(labels));
    check('the proofread row says it would become a draft', labels.some(l => /вичитано \(стане чернеткою\)/.test(l)), JSON.stringify(labels));
    await page.locator('#lk-go').click(); await sleep(900);
    const p = await page.evaluate(stored); const f = p.files['Map001.json'];
    check('«Оновити вибрані» leaves the proofread row as it was', f.k1.target === 'Ага' && f.k1.status === 'appr', JSON.stringify([f.k1.target, f.k1.status]));
    check('and updates the ticked one (as a draft)', f.k2.target === 'Так' && f.k2.status === 'draft', JSON.stringify([f.k2.target, f.k2.status]));
    check('no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
