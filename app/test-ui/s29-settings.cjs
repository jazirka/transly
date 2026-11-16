// Browser regression check: the settings are a tree of pages (search, groups that fold, breadcrumbs) with «Зберегти / Застосувати / Скасувати»:
// what is typed waits until it is applied, the accent colour is tried at once and goes back on «Скасувати», the dialog keeps its size.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s29-settings.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const cmd = (code, parameters, indent = 0) => ({ code, indent, parameters });
const say = (t, who = 'Cook') => [cmd(101, [who, 0, 0, 2, who]), cmd(401, [t])];
const MAP = { displayName: 'Town', events: [null, { id: 1, name: 'cook', x: 1, y: 1, pages: [{ list: [...say('Take your hat off.'), ...say('Hello there.'), cmd(0, [])] }] }] };

const accentOf = page => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
const stored = page => page.evaluate(() => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const g = db.transaction('projects').objectStore('projects').get('default'); g.onsuccess = () => { db.close(); res(g.result ? JSON.parse(g.result) : null); }; g.onerror = () => rej(g.error); }; o.onerror = () => rej(o.error); }));

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 860 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(800);
  await page.evaluate(async text => {
    const root = await navigator.storage.getDirectory();
    const game = await root.getDirectoryHandle('settings-game', { create: true });
    const data = await game.getDirectoryHandle('data', { create: true });
    const w = await (await data.getFileHandle('Map001.json', { create: true })).createWritable();
    await w.write(text); await w.close();
    window.showDirectoryPicker = async () => root.getDirectoryHandle('settings-game');
  }, JSON.stringify(MAP));
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1500);
  const a0 = await accentOf(page);

  const open = async () => { await page.locator('#hamb').click().catch(() => {}); await sleep(250); await page.locator('#menubar [data-mg="Файл"]').click(); await sleep(200); await page.locator('#mdd').getByText('Налаштування…').first().click(); await sleep(500); };
  const dlgBox = () => page.evaluate(() => { const r = document.querySelector('dialog[open]')?.getBoundingClientRect(); return r ? { w: Math.round(r.width), h: Math.round(r.height) } : null; });
  await open();

  // the tree: groups, pages, breadcrumbs
  const groups = await page.locator('.st-grp').allInnerTexts();
  check('the tree has the groups of the settings', JSON.stringify(groups.map(g => g.trim())) === JSON.stringify(['Проєкт', 'Пов’язане й пам’ять', 'Перевірка', 'Синхронізація', 'Застосунок']), JSON.stringify(groups));
  const sync = await page.evaluate(() => { const g = [...document.querySelectorAll('.st-grp')].find(b => b.textContent.trim() === 'Синхронізація'); const items = []; for (let e = g.nextElementSibling; e && e.classList.contains('st-ti'); e = e.nextElementSibling) items.push(e.textContent.trim()); return items; });
  check('git and the other ways to sync are pages of the tree, not tabs', sync.includes('GitHub') && sync.includes('Власний сервер') && sync.includes('Файл') && (await page.locator('dialog[open] [role=tab]').count()) === 0, JSON.stringify(sync));
  check('the crumbs name the group and the page (an arrow between them)', /Проєкт\s+Загальні/.test((await page.locator('#st-t').innerText()).replace(/\s+/g, ' ')), await page.locator('#st-t').innerText());
  await page.locator('.st-ti[data-p="github"]').click(); await sleep(150);
  check('a page opens from the tree', /Синхронізація\s+GitHub/.test((await page.locator('#st-t').innerText()).replace(/\s+/g, ' ')) && await page.locator('#gh-repo').isVisible() && !(await page.locator('#st-tol').isVisible()));
  const banner = await page.evaluate(() => { const w = document.querySelector('#stp-github .st-warn'); if (!w) return null; const c = getComputedStyle(w); return { bg: c.backgroundColor, bold: getComputedStyle(w.querySelector('b')).fontWeight }; });
  check('the warning of the token page is a coloured banner with a bold first line', !!banner && /rgba\(229, 160, 75/.test(banner.bg) && Number(banner.bold) >= 600, JSON.stringify(banner));
  await page.locator('.st-ti[data-p="danger"]').click(); await sleep(150);
  check('the danger page has a red banner', await page.evaluate(() => !!document.querySelector('#stp-danger .st-warn.bad')));

  // the dialog keeps its size on every page
  const sizes = [];
  for (const id of ['general', 'look', 'lang', 'terms', 'github', 'file', 'danger']) { await page.locator(`.st-ti[data-p="${id}"]`).click(); await sleep(100); sizes.push(await dlgBox()); }
  check('the dialog is the same size on every page', new Set(sizes.map(s => s.w + 'x' + s.h)).size === 1, JSON.stringify(sizes[0]));

  // groups fold
  const cnt = () => page.locator('.st-ti').count();
  const before = await cnt();
  await page.locator('.st-grp', { hasText: 'Перевірка' }).click(); await sleep(100);
  const after = await cnt();
  check('a group folds and unfolds', after === before - 2 && (await page.locator('.st-grp', { hasText: 'Перевірка' }).getAttribute('aria-expanded')) === 'false', `${before} -> ${after}`);
  await page.locator('.st-grp', { hasText: 'Перевірка' }).click(); await sleep(100);
  check('(and unfolds)', (await cnt()) === before);

  // the search: only the pages that have the words, the page on the right follows
  await page.locator('#st-q').fill('токен'); await sleep(200);
  const found = await page.locator('.st-ti').allInnerTexts();
  check('the search keeps the pages that have the words', found.length >= 1 && found.length < before && found.some(t => /GitHub/.test(t)), JSON.stringify(found));
  check('and opens the first of them', /GitHub|Оновлення/.test(await page.locator('#st-t').innerText()), await page.locator('#st-t').innerText());
  await page.locator('#st-q').fill('qqqzzz'); await sleep(150);
  check('a search with no result says so', /Нічого не знайдено/.test(await page.locator('#st-tree').innerText()));
  await page.locator('#st-q').fill(''); await sleep(150);

  // «Застосувати» waits for a change; a change shows it; the accent is tried and put back
  await page.locator('.st-ti[data-p="general"]').click(); await sleep(100);
  check('«Застосувати» is off and nothing waits', await page.locator('#st-apply').isDisabled() && await page.locator('#st-dirty').isHidden());
  await page.locator('#st-who').fill('Тестер'); await sleep(100);
  check('a change turns «Застосувати» on and says so', !(await page.locator('#st-apply').isDisabled()) && (await page.locator('#st-dirty').isVisible()));
  let p = await stored(page);
  check('and it is not saved yet (the settings wait for «Застосувати»)', !p || p.settings?.who !== 'Тестер', JSON.stringify(p?.settings?.who));
  await page.locator('.st-ti[data-p="look"]').click(); await sleep(100);
  await page.locator('#th-pre button[data-h="305"]').click(); await sleep(200);
  const a1 = await accentOf(page);
  check('a colour is tried on the whole app at once', a1 !== a0, `${a0} -> ${a1}`);
  await page.locator('#st-cancel').click(); await sleep(400);
  check('«Скасувати» closes the dialog and puts the colour back', !(await page.evaluate(() => !!document.querySelector('dialog[open]'))) && (await accentOf(page)) === a0, `${a0} / ${await accentOf(page)}`);
  p = await stored(page);
  check('and nothing was saved', !p || (p.settings?.who !== 'Тестер' && p.settings?.hue === undefined), JSON.stringify([p?.settings?.who, p?.settings?.hue]));

  await open();
  check('the dialog opens on the page that was open last', /Вигляд/.test(await page.locator('#st-t').innerText()));
  await page.locator('.st-ti[data-p="general"]').click(); await sleep(100);
  await page.locator('#st-who').fill('Тестер');
  await page.locator('.st-ti[data-p="look"]').click(); await sleep(100);
  await page.locator('#th-pre button[data-h="305"]').click(); await sleep(150);
  await page.locator('#st-apply').click(); await sleep(500);
  check('«Застосувати» applies and keeps the dialog open', (await page.evaluate(() => !!document.querySelector('dialog[open]'))) && await page.locator('#st-apply').isDisabled() && await page.locator('#st-dirty').isHidden());
  const a2 = await accentOf(page);
  check('the colour stays', a2 === a1, `${a1} / ${a2}`);
  await sleep(1000);
  p = await stored(page);
  check('and the settings are saved with the project', !!p && p.settings.who === 'Тестер' && p.settings.hue === 305, JSON.stringify([p?.settings?.who, p?.settings?.hue]));
  // Esc with a change waiting: the first one only says so, the second one throws the change away
  await page.locator('.st-ti[data-p="general"]').click();
  await page.locator('#st-who').fill('Інший'); await sleep(100);
  await page.keyboard.press('Escape'); await sleep(200);
  check('the first Esc does not close the dialog while a change waits', await page.evaluate(() => !!document.querySelector('dialog[open]')) && /Esc/.test(await page.locator('#st-dirty').innerText()));
  await page.keyboard.press('Escape'); await sleep(300);
  check('the second Esc closes it without the change', !(await page.evaluate(() => !!document.querySelector('dialog[open]'))));
  await open();
  check('the settings are shown as they were saved', /Проєкт\s+Загальні/.test((await page.locator('#st-t').innerText()).replace(/\s+/g, ' ')) && (await page.locator('#st-who').inputValue()) === 'Тестер');
  // «Зберегти» applies and closes; a wrong value stays on its page
  await page.locator('#st-tol').fill('500');
  await page.locator('.st-ti[data-p="look"]').click(); await sleep(100);
  await page.locator('#st-save').click(); await sleep(300);
  check('a wrong value is shown on its own page and the dialog stays', await page.evaluate(() => !!document.querySelector('dialog[open]')) && await page.locator('#st-tol').isVisible() && (await page.locator('#st-tol-err').innerText()).length > 0);
  await page.locator('#st-tol').fill('30'); await page.locator('#st-save').click(); await sleep(500);
  check('«Зберегти» closes the dialog', !(await page.evaluate(() => !!document.querySelector('dialog[open]'))));
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close(); await browser.close();
  if (failed) { console.log(`\n${failed} check(s) failed`); process.exit(1); }
  console.log('\nall checks passed');
})();
