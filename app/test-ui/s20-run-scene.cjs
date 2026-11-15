// Browser regression check: the ▶ button in the «Поточна сцена» run configuration (desktop app, Tauri stand-in).
// A stub of window.__TAURI_INTERNALS__ plays the shell: it serves a virtual game folder and records every command, so the
// whole way button → build → apply_data → apply_jump → launch is walked without a real window. See s0-safety.cjs for how to run:
//   PC_URL=http://localhost:4285/ node test-ui/s20-run-scene.cjs
const { chromium } = require('playwright');
const PC = process.env.PC_URL || 'http://localhost:4285/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = '') => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + detail : '')); if (!ok) failed++; };

const cmd = (code, parameters, indent = 0) => ({ code, indent, parameters });
const say = text => [cmd(101, ['', 0, 0, 2, '']), cmd(401, [text])];
const GAME = {
  'Map001.json': { displayName: 'Town', events: [null,
    { id: 1, name: 'door', x: 4, y: 7, pages: [{ list: [...say('It is locked.'), cmd(0, [])] }] },
    { id: 2, name: 'cook', x: 9, y: 3, pages: [{ list: [...say('Hungry?'), ...say('Here you go.'), cmd(0, [])] }] },
  ] },
  'CommonEvents.json': [null, { id: 1, name: 'intro', list: [...say('A common line.'), cmd(0, [])] }],
  'Troops.json': [null, { id: 1, name: 'rats', members: [], pages: [{ list: [...say('Squeak!'), cmd(0, [])] }] }],
  'Items.json': [null, { id: 1, name: 'Potion', description: 'Heals a little.' }],
  'System.json': { gameTitle: 'Test', terms: { messages: {} } },
};

/** The stand-in for the Tauri shell. `opts.pluginsMissing` makes apply_jump refuse (a folder that is not RPG Maker's); `opts.noExe` cancels the program dialog. */
const STUB = (game, opts) => `(() => {
  const game = ${JSON.stringify(game)}, opts = ${JSON.stringify(opts)};
  window.__calls = [];
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: () => 1, unregisterCallback() {}, convertFileSrc: p => p,
    invoke: async (cmd, args) => {
      window.__calls.push({ cmd, args });
      switch (cmd) {
        case 'pick_dir': return '/game';
        case 'allow_again': return null;
        case 'list_json': return Object.keys(game).map(name => ({ name, path: '/game/data/' + name }));
        case 'read_text': return JSON.stringify(game[args.path.split('/').pop()]);
        case 'pick_exe': return opts.noExe ? null : '/game/Game.exe';
        case 'apply_data': return args.files.length;
        case 'apply_jump': if (opts.pluginsMissing) throw 'Це не папка даних RPG Maker MV/MZ: поруч немає js/plugins.js'; return null;
        case 'restore_jump': return false;
        case 'launch': return null;
        default: return null;
      }
    },
  };
})();`;

async function open(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await page.addInitScript(STUB(GAME, opts));
  await page.goto(PC); await sleep(900);
  await page.getByRole('button', { name: /Відкрити папку гри/ }).first().click(); await sleep(1500);
  return { ctx, page, errors };
}
const calls = page => page.evaluate(() => window.__calls.map(c => c.cmd));
const jumpOf = page => page.evaluate(() => { const c = window.__calls.find(x => x.cmd === 'apply_jump'); return c ? c.args : null; });
const toasts = async page => (await page.locator('.toast').allInnerTexts()).join(' | ');
const pickScene = async page => { await page.locator('#cfg-btn').click(); await page.locator('#cfgpop [data-cfg="scene"]').click(); await sleep(200); };
const openFile = async (page, name) => { await page.locator(`.node[data-file="${name}.json"]`).click(); await sleep(500); };

(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });

  // 1. a row of a map is selected: the game starts in its scene
  {
    const { ctx, page, errors } = await open(browser);
    check('the desktop stand-in opens the game: rows are there', (await page.locator('.gr').count()) > 0);
    await openFile(page, 'Map001');
    await pickScene(page);
    check('the run button names the scene configuration', /Поточна сцена/.test(await page.locator('#run-btn').getAttribute('aria-label')));
    await page.locator('.gr', { hasText: 'Here you go.' }).first().click(); await sleep(300);
    await page.locator('#run-btn').click(); await sleep(1200);
    const seq = await calls(page);
    const i = ['apply_data', 'apply_jump', 'launch'].map(c => seq.indexOf(c));
    check('▶ writes the translation, installs the jump plugin and launches, in that order', i.every(x => x >= 0) && i[0] < i[1] && i[1] < i[2], JSON.stringify(seq));
    const j = await jumpOf(page);
    check('the plugin targets the cook event of map 1 at its page start', !!j && /"mapId":1/.test(j.source) && /"eventIndex":2/.test(j.source) && /"index":0/.test(j.source), j ? j.source.match(/var J = (.*?);/)?.[1] : 'no apply_jump');
    check('the data dir goes to apply_jump', !!j && j.dataDir === '/game/data', JSON.stringify(j && j.dataDir));
    check('no error toast', !/Не вдалося|недоступний|Виберіть/.test(await toasts(page)), await toasts(page));
    check('no page errors', errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // 2. nothing was clicked yet in a freshly opened file (table): the row in focus or the first one with a scene is used
  {
    const { ctx, page } = await open(browser);
    await openFile(page, 'Map001');
    await pickScene(page);
    await page.keyboard.press('F5'); await sleep(1200);
    const seq = await calls(page);
    const j = await jumpOf(page);
    check('F5 with no row clicked still starts a scene (the first row of the file)', seq.includes('apply_jump') && seq.includes('launch') && !!j && /"eventIndex":1/.test(j.source), JSON.stringify(seq) + ' ' + await toasts(page));
    await ctx.close();
  }
  {
    // the file has no scene at all (the database file that opens first): the answer names the reason, nothing is written
    const { ctx, page } = await open(browser);
    await openFile(page, 'Items');
    await pickScene(page);
    await page.keyboard.press('F5'); await sleep(900);
    const seq = await calls(page);
    check('a file without scenes writes nothing and says so', !seq.includes('apply_data') && /немає рядків із сценою|не належить/.test(await toasts(page)), JSON.stringify(seq) + ' ' + await toasts(page));
    await ctx.close();
  }

  // 2b. the row is clicked first, the configuration is chosen afterwards
  {
    const { ctx, page } = await open(browser);
    await openFile(page, 'Map001');
    await page.locator('.gr', { hasText: 'It is locked.' }).first().click(); await sleep(300);
    await pickScene(page);
    await page.locator('#run-btn').click(); await sleep(1200);
    const j = await jumpOf(page);
    check('the row chosen before the configuration is the one used', !!j && /"eventIndex":1/.test(j.source), j ? j.source.match(/var J = (.*?);/)?.[1] : await toasts(page));
    await ctx.close();
  }

  // 2c. the scene mode (cards): the open card's scene
  {
    const { ctx, page } = await open(browser);
    await openFile(page, 'Map001');
    await pickScene(page);
    await page.locator('#m-scene').click(); await sleep(700);
    await page.keyboard.press('F5'); await sleep(1200);
    const j = await jumpOf(page);
    check('in the scene mode the game starts in the scene on screen', !!j && /"kind":"map"/.test(j.source), j ? j.source.match(/var J = (.*?);/)?.[1] : await toasts(page));
    await ctx.close();
  }

  // 2d. the program dialog is cancelled: nothing is written and nothing claims a launch
  {
    const { ctx, page } = await open(browser, { noExe: true });
    await openFile(page, 'Map001');
    await pickScene(page);
    await page.locator('.gr', { hasText: 'Here you go.' }).first().click(); await sleep(300);
    await page.locator('#run-btn').click(); await sleep(1000);
    const seq = await calls(page), t = await toasts(page);
    check('a cancelled program dialog writes nothing', !seq.includes('apply_data') && !seq.includes('apply_jump') && !seq.includes('launch'), JSON.stringify(seq));
    check('and the toast does not say the game started', /не вказано файл гри/.test(t) && !/Гру запущено/.test(t), t);
    await ctx.close();
  }

  // 3. a battle and a common event
  {
    const { ctx, page } = await open(browser);
    await pickScene(page);
    await openFile(page, 'Troops');
    await page.locator('.gr', { hasText: 'Squeak!' }).first().click(); await sleep(300);
    await page.locator('#run-btn').click(); await sleep(1000);
    const j = await jumpOf(page);
    check('a battle row starts that troop', !!j && /"kind":"troop"/.test(j.source) && /"troop":1/.test(j.source), j ? j.source.match(/var J = (.*?);/)?.[1] : await toasts(page));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(browser);
    await pickScene(page);
    await openFile(page, 'CommonEvents');
    await page.locator('.gr', { hasText: 'A common line.' }).first().click(); await sleep(300);
    await page.locator('#run-btn').click(); await sleep(1000);
    const j = await jumpOf(page);
    check('a common-event row starts that event', !!j && /"kind":"common"/.test(j.source) && /"common":1/.test(j.source), j ? j.source.match(/var J = (.*?);/)?.[1] : await toasts(page));
    await ctx.close();
  }

  // 4. a database row has no scene: the answer says so and nothing is written into the game
  {
    const { ctx, page } = await open(browser);
    await pickScene(page);
    await openFile(page, 'Items');
    await page.locator('.gr').first().click(); await sleep(300);
    await page.locator('#run-btn').click(); await sleep(800);
    const seq = await calls(page);
    check('a database row writes nothing and explains why', !seq.includes('apply_data') && !seq.includes('apply_jump') && /не належить|недоступн|сцен/i.test(await toasts(page)), JSON.stringify(seq) + ' ' + await toasts(page));
    await ctx.close();
  }

  // 5. the folder is not an RPG Maker one: the reason is shown (and the toast is not just «Не вдалося запустити»)
  {
    const { ctx, page } = await open(browser, { pluginsMissing: true });
    await openFile(page, 'Map001');
    await pickScene(page);
    await page.locator('.gr', { hasText: 'Hungry?' }).first().click(); await sleep(300);
    await page.locator('#run-btn').click(); await sleep(1000);
    const t = await toasts(page);
    check('a refused plugin install says why', /js\/plugins\.js/.test(t), t);
    check('and the game is not launched', !(await calls(page)).includes('launch'));
    await ctx.close();
  }

  await browser.close();
  console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
  process.exit(failed ? 1 : 0);
})();
