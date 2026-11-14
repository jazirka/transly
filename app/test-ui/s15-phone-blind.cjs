// Browser regression checks for the findings of the blind phone user. See s0-safety.cjs for how to run:
//   PHONE_URL=http://localhost:4284/ node test-ui/s15-phone-blind.cjs
const { chromium } = require('playwright');
const PHONE = process.env.PHONE_URL || 'http://localhost:4284/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const long = 'The captain walked along the old harbour wall for a very long time before he finally said that the captain would come back';
const project = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files: {}, memory: [], terms: [{ en: 'harbour', uk: 'гавань', mt: 1 }],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': [long, 'Second line', 'Third line', 'Fourth line'].map((src, i) => ({ key: 'k' + i, source: src, speaker: '', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 700 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PHONE); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);

  // ---- search: the part around the match is shown, the match is marked
  await page.locator('[data-tab="rows"], .m-tab:has-text("Рядки")').first().click().catch(() => undefined); await sleep(500);
  await page.locator('#m-q').fill('would come').catch(() => undefined);
  await page.locator('#m-q').fill('captain would'); await sleep(700);
  const mark = await page.locator('.m-row .m-src mark').first().innerText().catch(() => '');
  check('search: the match is marked in the list (it is far from the start of the line)', /captain would/i.test(mark), mark);
  const srcText = await page.locator('.m-row .m-src').first().innerText().catch(() => '');
  check('search: the excerpt is cut with … around the match', /…/.test(srcText) && /captain would/i.test(srcText), srcText.slice(0, 90));

  // ---- the filter and the search are still there after a reload
  await page.reload(); await sleep(1500);
  const qv = await page.locator('#m-q').inputValue().catch(() => '');
  check('after a reload the search text is kept', qv === 'captain would', qv);
  await page.locator('#m-q').fill(''); await sleep(500);

  const mask = await page.evaluate(() => { const c = document.querySelector('.m-chips'); return c ? getComputedStyle(c).maskImage || getComputedStyle(c).webkitMaskImage || '' : 'no chips'; });
  check('a row of chips fades out at its edge', /gradient/.test(mask), mask);
  // ---- send: the keyboard stays up (the next field has the focus)
  await page.locator('.m-row').first().click(); await sleep(600);
  await page.locator('#m-tr').click(); await page.keyboard.type('Капітан'); await sleep(400);
  await page.locator('.m-primary[data-send]').click(); await sleep(900);
  const active = await page.evaluate(() => document.activeElement && document.activeElement.id);
  check('after «Надіслати» the next field has the focus (the keyboard stays up)', active === 'm-tr', String(active));
  const tundo = await page.locator('.m-tundo').first().getAttribute('aria-label').catch(() => null);
  check('the «Скасувати» of a toast names its action', /^Скасувати: /.test(tundo || ''), String(tundo));
  const fieldBox = await page.locator('#m-tr').boundingBox();
  check('the field is on the screen after the send', !!fieldBox && fieldBox.y >= 0 && fieldBox.y < 700, JSON.stringify(fieldBox));

  // ---- the notices do not cover the translation field; the placeholder is readable; a long row of chips fades out at the edge
  const geo = await page.evaluate(() => {
    const r = e => e && e.getBoundingClientRect();
    const t = [...document.querySelectorAll('.m-toast')].map(r), f = r(document.getElementById('m-tr'));
    const ph = getComputedStyle(document.getElementById('m-tr'), '::placeholder').color;
    return { overlap: t.some(b => f && b.bottom > f.top && b.top < f.bottom && b.right > f.left && b.left < f.right), toasts: t.length, ph };
  });
  check('the notices do not cover the translation field', !geo.overlap, JSON.stringify(geo));
  check('the placeholder of the field is lighter than before (contrast)', /154, 156, 163/.test(geo.ph), geo.ph);
  
  // ---- a sent row: the big button proofreads and goes on (it used to answer with an error); the clear button is itself again after the second tap
  await page.locator('#m-tr').blur(); await sleep(200);
  await page.locator('[data-step="-1"]').click(); await sleep(700);
  const lab1 = await page.locator('.m-act1 .m-primary').innerText();
  check('on a sent row the big button says «Вичитати й далі»', /Вичитати й далі/.test(lab1), lab1);
  await page.locator('.m-act1 .m-primary').click(); await sleep(800);
  const lab2 = await page.locator('.m-act1 .m-primary').innerText();
  check('it proofreads the row and the next row opens with «Надіслати»', /Надіслати/.test(lab2), lab2);
  await page.locator('#m-tr').click(); await page.keyboard.type('Тест'); await sleep(300);
  await page.locator('#m-tr').blur(); await sleep(300);
  await page.locator('[data-clear]').click(); await sleep(200);
  check('the clear button asks once', /Точно очистити/.test(await page.locator('[data-clear]').innerText()));
  await page.locator('[data-clear]').click(); await sleep(500);
  const lab3 = (await page.locator('[data-clear]').innerText()).trim();
  check('and is «Очистити» again after the confirmed tap', lab3 === 'Очистити', lab3);

  // ---- the glossary: the word for the number, one tap does not delete
  await page.locator('#m-tr').blur(); await sleep(300);
  await page.locator('[data-menu]').first().click(); await sleep(500);
  const glBtn = page.locator('.m-menu button', { hasText: 'Глосарій' });
  const hasGl = await glBtn.count();
  if (hasGl) {
    await glBtn.first().click(); await sleep(600);
    const ph = await page.locator('#g-q').getAttribute('placeholder');
    check('the glossary counter says «1 терміна»', /1 терміна/.test(ph || ''), String(ph));
    await page.locator('[data-tdel]').first().click(); await sleep(400);
    check('one tap does not delete a term (it asks again)', (await page.locator('[data-tdel]').count()) === 1 && /Точно видалити/.test(await page.locator('[data-tdel]').first().innerText()));
    await page.locator('[data-tdel]').first().click(); await sleep(500);
    check('the second tap deletes it', (await page.locator('[data-tdel]').count()) === 0);
  } else check('the glossary screen is reachable', false);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
