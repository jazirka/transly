// Browser regression check: the project is called after the folder of the game (or the game's own title, or a name written by hand), the icon has one or two
// letters, and the dialog of the project's settings (name, icon, colour, branches, danger zone) is apart from the settings of the app.
// See s0-safety.cjs for how to run:   PC_URL=http://localhost:4285/ node test-ui/s49-project.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };
const T = 1700000000000;
const project = () => ({
  version: 1, name: 'Гра', sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, memory: [], terms: [],
  settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0, linkMode: 'off' },
  files: { 'Map001.json': { k0: { target: 'Привіт', status: 'draft', mt: T } } },
  snapshot: { 'Map001.json': ['Hello', 'World'].map((source, i) => ({ key: 'k' + i, source, speaker: 'Hero', kind: 'dialogue', context: '' })) },
});
const put = ({ text, snapshot }) => new Promise((res, rej) => { const o = indexedDB.open('transly', 3); o.onsuccess = () => { const db = o.result; const tx = db.transaction(['projects', 'snapshots'], 'readwrite'); tx.objectStore('projects').put(text, 'default'); tx.objectStore('snapshots').put(snapshot, 'default'); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); }; o.onerror = () => rej(o.error); });

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.goto(PC); await sleep(600);
  const p = project(); const { snapshot } = p; delete p.snapshot;
  p.name = 'Новий проєкт';
  p.settings.folderName = 'Deserted cottage';
  snapshot['System.json'] = [{ key: 'gameTitle', source: 'The Deserted Cottage', speaker: '', kind: 'name', context: '' }];
  await page.evaluate(put, { text: JSON.stringify(p), snapshot }); await page.reload(); await sleep(1500);

  const top = () => page.evaluate(() => ({ name: document.querySelector('#proj-name').textContent, av: document.querySelector('#proj-av').textContent, two: document.querySelector('#proj-av').classList.contains('two'), hue: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() }));
  let t = await top();
  check('the project is called after the folder of the game, and the icon has two letters for two words', t.name === 'Deserted cottage' && t.av === 'DC' && t.two, JSON.stringify(t));
  const glyph = await page.evaluate(() => { const a = document.querySelector('#proj-av'), r = a.getBoundingClientRect(), s = a.scrollWidth; return { w: Math.round(r.width), sw: s }; });
  check('two letters fit the circle', glyph.sw <= glyph.w, JSON.stringify(glyph));

  await page.locator('#proj-btn').click(); await sleep(200);
  const card = await page.locator('#projpop .pj-card b').innerText();
  check('the project menu card shows the same name', card === 'Deserted cottage', card);
  check('the menu has both the settings of the project and of the app', (await page.locator('#projpop [data-pj="project"]').count()) === 1 && (await page.locator('#projpop [data-pj="settings"]').count()) === 1);
  await page.locator('#projpop [data-pj="project"]').click(); await sleep(500);
  const dlg = page.locator('dialog.pjs-dlg');
  check('the dialog of the project opens on «Назва й вигляд»', (await dlg.count()) === 1 && /Назва й вигляд/.test(await dlg.locator('#st-t').innerText()));
  const nav = await dlg.locator('.st-ti').allInnerTexts();
  check('its own sidebar lists the pages of the project', ['Назва й вигляд', 'Гілки', 'GitHub', 'Мови', 'Небезпечна зона'].every(n => nav.includes(n)), nav.join(' | '));
  check('the game title is offered as a source of the name', !(await dlg.locator('input[name=pjs-from][value=game]').isDisabled()));
  await dlg.locator('input[name=pjs-from][value=game]').check(); await sleep(150);
  check('the preview follows at once', (await dlg.locator('#pjs-title').innerText()) === 'The Deserted Cottage' && (await dlg.locator('#pjs-av').innerText()) === 'DC', await dlg.locator('#pjs-title').innerText());
  check('and the unsaved choice is marked', !(await dlg.locator('#st-dirty').isHidden()));
  await dlg.locator('#pjs-name').fill('Покинута хатина'); await sleep(150);
  check('a name typed by hand turns the source to «Своя» and the letters follow', (await dlg.locator('#pjs-title').innerText()) === 'Покинута хатина' && (await dlg.locator('#pjs-av').innerText()) === 'ПХ');
  const hue0 = t.hue;
  const hueLive = (await top()).hue;
  await dlg.locator('#th-pre button[data-h="305"]').click(); await sleep(150);
  check('the colour follows the name while it is not picked by hand, and a picked one is tried on the whole app at once', hueLive !== hue0 && (await top()).hue !== hueLive);
  await dlg.locator('#pjs-ico').fill('x'); await sleep(100);
  check('own letters beat the initials', (await dlg.locator('#pjs-av').innerText()) === 'X');
  await dlg.locator('#st-cancel').click(); await sleep(300);
  t = await top();
  check('cancel throws everything away: the name, the letters and the colour', t.name === 'Deserted cottage' && t.av === 'DC' && t.hue === hue0, JSON.stringify(t));

  // save
  await page.locator('#proj-btn').click(); await sleep(200); await page.locator('#projpop [data-pj="project"]').click(); await sleep(400);
  await dlg.locator('#pjs-name').fill('Покинута хатина'); await sleep(100);
  await dlg.locator('#pjs-ico').fill('ПХ'); await sleep(100);
  await dlg.locator('#st-save').click(); await sleep(500);
  t = await top();
  check('saved: the top bar shows the name and the letters', t.name === 'Покинута хатина' && t.av === 'ПХ', JSON.stringify(t));
  await page.reload(); await sleep(1500);
  t = await top();
  check('and they survive a reload', t.name === 'Покинута хатина' && t.av === 'ПХ', JSON.stringify(t));

  // branches page
  await page.locator('#proj-btn').click(); await sleep(200); await page.locator('#projpop [data-pj="project"]').click(); await sleep(400);
  await dlg.locator('.st-ti', { hasText: 'Гілки' }).click(); await sleep(200);
  check('the page of branches lists main', (await dlg.locator('.pjs-brt tbody tr').count()) === 1 && /main/.test(await dlg.locator('.pjs-brt').innerText()));
  await dlg.locator('#pjs-newbr').click(); await sleep(300);
  await page.locator('dialog#br-name, dialog input#br-name').first().fill('вичитка'); await page.locator('#br-ok').click(); await sleep(500);
  check('a branch made there shows in the list and is the current one', (await dlg.locator('.pjs-brt tbody tr').count()) === 2 && /поточна/.test(await dlg.locator('.pjs-brt tr.cur').innerText()) && /вичитка/.test(await dlg.locator('.pjs-brt tr.cur').innerText()));
  await dlg.locator('.pjs-brt button[data-bs="main"]').click(); await sleep(400);
  await dlg.locator('.pjs-brt button[data-bd="вичитка"]').click(); await sleep(100);
  check('delete asks once more on the same spot', /Так, видалити/.test(await dlg.locator('.pjs-brt button[data-bd="вичитка"]').innerText()));
  await dlg.locator('.pjs-brt button[data-bd="вичитка"]').click(); await sleep(400);
  check('and then the branch is gone', (await dlg.locator('.pjs-brt tbody tr').count()) === 1);

  // danger zone keeps the name
  await dlg.locator('.st-ti', { hasText: 'Небезпечна зона' }).click(); await sleep(150);
  await dlg.locator('#pjs-reset').click(); await sleep(1400); await dlg.locator('#pjs-reset').click(); await sleep(800);
  t = await top();
  check('after a reset the project keeps its name and the letters', t.name === 'Покинута хатина' && t.av === 'ПХ', JSON.stringify(t));

  // the app settings point to the project dialog and no longer carry the colour
  await page.locator('#proj-btn').click(); await sleep(200); await page.locator('#projpop [data-pj="settings"]').click(); await sleep(500);
  check('the settings of the app have no colour slider any more, only a way to the project settings', (await page.locator('dialog#st-t, dialog .st-page #th-hue').count()) === 0 && (await page.locator('#st-proj').count()) === 1);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
