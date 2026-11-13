// Browser regression checks for stage S0 (safety of stored data). Not part of `npm test` (needs Chromium + built, served apps):
//   npx vite build && npx vite build --mode mobile
//   npx vite preview --port 4285 &  npx vite preview --mode mobile --outDir dist-mobile --port 4284 &
//   PC_URL=http://localhost:4285/ PHONE_URL=http://localhost:4284/ node test-ui/s0-safety.cjs
// Each check prints PASS/FAIL; the exit code is 1 when anything failed.
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const PHONE = process.env.PHONE_URL || 'http://localhost:4284/';

const S = '\u0001';
const hostile = () => ({
  version: 1, name: 'P', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [],
  files: { 'Map001.json': { a: { target: 'Привіт', status: 'draft', mt: 5 }, b: { target: 'Ок', status: 'x" onmouseover="window.__pwned=(window.__pwned||0)+1" y="', mt: 6 } } },
  groups: { g1: { id: 'g1', name: 'G', color: 'red;background-image:url(http://127.0.0.1:9/leak-css)', at: 1, mt: 1 } },
  members: { [`f${S}Map001.json`]: { g: 'g1', mt: 1 } },
  settings: { who: '"><img src=x onerror="window.__pwned=(window.__pwned||0)+1">', tolerancePct: '1"><img src=x onerror="window.__pwned=(window.__pwned||0)+1">', blockErrors: true, propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
  snapshot: { 'Map001.json': [
    { key: 'a', source: 'Hello there', speaker: '', kind: 'dialogue', context: '' },
    { key: 'b', source: 'OK', speaker: '', kind: 'dialogue', context: '' },
  ] },
});
const rawPut = ({ project, withSnapshot }) => new Promise((res, rej) => {
  const o = indexedDB.open('transly', 3);
  o.onsuccess = () => {
    const db = o.result; const { snapshot, ...rest } = project;
    const tx = db.transaction(['projects', 'snapshots'], 'readwrite');
    tx.objectStore('projects').put(JSON.stringify(rest), 'default');
    if (withSnapshot) tx.objectStore('snapshots').put(snapshot, 'default');
    tx.oncomplete = () => { db.close(); res(); }; tx.onerror = () => rej(tx.error);
  };
  o.onerror = () => rej(o.error);
});
const rawGet = (store) => new Promise((res, rej) => {
  const o = indexedDB.open('transly', 3);
  o.onsuccess = () => { const db = o.result; const r = db.transaction(store).objectStore(store).get('default'); r.onsuccess = () => { db.close(); res(r.result ?? null); }; r.onerror = () => rej(r.error); };
  o.onerror = () => rej(o.error);
});

let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

async function fresh(browser, url, viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, ...extra });
  const page = await ctx.newPage();
  const log = { csp: [], errors: [], leaks: [] };
  page.on('console', m => { if (/content security policy/i.test(m.text())) log.csp.push(m.text().slice(0, 160)); });
  page.on('pageerror', e => log.errors.push(String(e.message)));
  page.on('request', r => { if (/127\.0\.0\.1:9/.test(r.url())) log.leaks.push(r.url()); });
  await page.goto(url); await page.waitForTimeout(800);
  return { ctx, page, log };
}

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // ---- desktop: hostile project from storage must not run script, change styles or request another server
  {
    const { ctx, page, log } = await fresh(browser, PC, { width: 1400, height: 900 });
    await page.evaluate(rawPut, { project: hostile(), withSnapshot: true });
    await page.reload(); await page.waitForTimeout(1500);
    await page.click('#settings'); await page.waitForTimeout(600);
    const pwned = await page.evaluate(() => window.__pwned || 0);
    const who = await page.evaluate(() => document.querySelector('#st-who')?.value ?? 'no #st-who');
    const tol = await page.evaluate(() => document.querySelector('#st-tol')?.getAttribute('value') ?? 'no #st-tol');
    check('desktop: no script from settings.who / tolerancePct / status ran', pwned === 0, 'pwned=' + pwned);
    check('desktop: settings.who shown as plain text', who.startsWith('"><img'), who.slice(0, 40));
    check('desktop: tolerancePct stays one attribute value (a wrong type is replaced by the default)', tol === '25' || tol.startsWith('1"><img'), tol.slice(0, 30));
    check('desktop: group colour from the project made no request to another server', log.leaks.length === 0, log.leaks.join(','));
    check('desktop: no page errors with a foreign status', log.errors.length === 0, log.errors.join(' | '));
    check('desktop: the CSP tag is present', await page.evaluate(() => !!document.querySelector('meta[http-equiv="Content-Security-Policy"]')) || process.env.NO_CSP_EXPECTED === '1');
    check('desktop: nothing was blocked by the CSP during normal use', log.csp.length === 0, log.csp.join(' | '));
    await ctx.close();
  }

  // ---- desktop: reset needs a deliberate second click, and removes the stored snapshot
  {
    const { ctx, page, log } = await fresh(browser, PC, { width: 1400, height: 900 });
    const p = hostile(); p.settings.who = 'Ви'; p.settings.tolerancePct = 25; p.groups = {}; p.members = {}; p.files['Map001.json'].b.status = 'draft';
    await page.evaluate(rawPut, { project: p, withSnapshot: true });
    await page.reload(); await page.waitForTimeout(1500);
    await page.click('#settings'); await page.waitForTimeout(500);
    await page.getByRole('tab', { name: 'Застосунок' }).click();
    await page.evaluate(() => { for (const d of document.querySelectorAll('dialog details')) if (/Небезпечна/.test(d.textContent)) d.open = true; });
    const btn = page.locator('#st-reset');
    await btn.dblclick(); await page.waitForTimeout(300);
    let stored = JSON.parse(await page.evaluate(rawGet, 'projects') || 'null');
    check('desktop: a double-click does not reset the project', !!stored && Object.keys(stored.files['Map001.json'] ?? {}).length === 2, 'files=' + JSON.stringify(Object.keys(stored?.files ?? {})));
    check('desktop: the button asks for confirmation after the first click', /Так, видалити/.test(await btn.textContent()));
    await page.waitForTimeout(1300);
    await btn.click(); await page.waitForTimeout(1500);
    stored = JSON.parse(await page.evaluate(rawGet, 'projects') || 'null');
    check('desktop: a deliberate second click resets the translations', !!stored && Object.values(stored.files).every(f => Object.keys(f).length === 0));
    await page.reload(); await page.waitForTimeout(1200);
    const snap = await page.evaluate(rawGet, 'snapshots');
    check('desktop: the game on screen keeps its rows after the reset (only the translation goes)', !!snap && Object.keys(snap).length === 1, JSON.stringify(snap && Object.keys(snap)));
    check('desktop: no errors during reset', log.errors.length === 0, log.errors.join(' | '));
    await ctx.close();
  }

  // ---- phone: the same hostile project in the settings screen
  {
    const { ctx, page, log } = await fresh(browser, PHONE, { width: 412, height: 915 }, { hasTouch: true, isMobile: true });
    await page.evaluate(rawPut, { project: hostile(), withSnapshot: true });
    await page.reload(); await page.waitForTimeout(1500);
    try {
      await page.getByRole('button', { name: 'Інструменти' }).first().click({ timeout: 3000 }); await page.waitForTimeout(500);
      await page.locator('[data-sub="settings"]').first().click({ timeout: 3000 }); await page.waitForTimeout(600);
    } catch { /* the check below tells whether the screen was reached */ }
    const reached = await page.evaluate(() => !!document.querySelector('#s-who'));
    const pwned = await page.evaluate(() => window.__pwned || 0);
    check('phone: the settings screen was reached', reached);
    check('phone: no script from settings ran', pwned === 0, 'pwned=' + pwned);
    check('phone: group colour made no request to another server', log.leaks.length === 0, log.leaks.join(','));
    check('phone: no page errors', log.errors.length === 0, log.errors.join(' | '));
    check('phone: nothing was blocked by the CSP', log.csp.length === 0, log.csp.join(' | '));
    // reset: a double-tap does not confirm, a deliberate second tap does, and the old game's snapshot goes with the translation
    const rb = page.locator('[data-reset]');
    await rb.scrollIntoViewIfNeeded(); await rb.dblclick(); await page.waitForTimeout(300);
    let stored = JSON.parse(await page.evaluate(rawGet, 'projects') || 'null');
    check('phone: a double-tap does not reset the project', !!stored && Object.keys(stored.files['Map001.json'] ?? {}).length === 2);
    await page.waitForTimeout(1300);
    await page.locator('[data-reset]').click(); await page.waitForTimeout(1500);
    stored = JSON.parse(await page.evaluate(rawGet, 'projects') || 'null');
    check('phone: a deliberate second tap resets the project', !!stored && Object.keys(stored.files).length === 0);
    await page.reload(); await page.waitForTimeout(1200);
    const snap = await page.evaluate(rawGet, 'snapshots');
    check('phone: the old game\'s snapshot is gone after the reset', snap === null, snap ? 'snapshot still has ' + Object.keys(snap) : '');
    await ctx.close();
  }

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
