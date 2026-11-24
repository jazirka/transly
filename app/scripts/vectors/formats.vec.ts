import { test } from 'vitest';
import type { Entry, GameFile, Translations, Unit } from '../../src/core/model';
import { apply, extract, formatOf, isTextFormat } from '../../src/core/engine';
import { build } from '../../src/core/build';
import { canonicalRpgMakerName, hasText, isRpgMakerFile, splitPluginCommand } from '../../src/core/rpgmaker';
import { safeKey } from '../../src/core/keys';
import { edgesOf, withEdges } from '../../src/core/edges';
import { branchOf } from '../../src/core/branches';
import { defaultDecision, diffBranches, planMerge, rowId } from '../../src/core/branches';
import type { DiffRow } from '../../src/core/branches';
import { qaOf } from '../../src/core/qaconfig';
import { wrapOf } from '../../src/core/wrapconfig';
import { emptyProject } from '../../src/core/project';
import type { FileView, SavedProject } from '../../src/core/project';
import { genEntry } from './entrygen';
import { genPlan } from './wrapgen';
import { rng, text, writeVectors } from './util';
import type { Rng } from './util';

const W = ['Hello', 'Hi there', 'Take it', 'Run!', 'Ok', '\\C[2]Fire\\C[0]', '\\N[1] says hi', '...', '---', 'Привіт', 'Ґанок', 'Item', 'Potion: heals', '  padded  ', 'a"b', "it's", 'tab\there', 'line1\nline2'];
const NAMES = ['Anna', 'Bob', '', 'EV003', 'ev003', 'Старий солдат'];
const rw = (r: Rng): string => r.pick(W);

type J = Record<string, unknown>;
function genList(r: Rng, cmds: string[]): J[] {
  const list: J[] = [];
  for (let n = 0; n < 2 + r.int(10); n++) {
    const roll = r.next(), indent = r.int(3);
    if (roll < 0.3) {
      list.push({ code: 101, indent, parameters: [r.pick(['', 'Actor1', 'Evil']), r.pick([0, 3, 1.5]), 0, 2, r.pick(['', 'Hero'])] });
      for (let k = 0; k < r.int(4); k++) list.push({ code: 401, indent, parameters: [rw(r)] });
    } else if (roll < 0.4) list.push({ code: 102, indent, parameters: [[rw(r), rw(r), ''].slice(0, 1 + r.int(3)), 0, 0, 2, 0] });
    else if (roll < 0.5) { list.push({ code: 105, indent, parameters: [2, 0] }); for (let k = 0; k < r.int(3); k++) list.push({ code: 405, indent, parameters: [rw(r)] }); }
    else if (roll < 0.6) list.push({ code: r.pick([108, 408]), indent, parameters: [r.pick(['MARCOH', 'SMALL_TALK', 'lower', 'AB', 'START OF SCENE', 5])] });
    else if (roll < 0.7) list.push({ code: 356, indent, parameters: [r.pick([...cmds.map(c => `${c} 2 ${rw(r)}`), `${r.pick(cmds)} ${rw(r)}`, 'Other cmd x', '', 'GabText 1 2 3 Text'])] });
    else if (roll < 0.75) list.push({ code: 101, indent, parameters: [] });
    else if (roll < 0.8) list.push(r.pick([null, 5, 'x', {}]) as never);
    else list.push({ code: r.pick([0, 111, 401, 402, 412]), indent, parameters: [rw(r)] });
  }
  return list;
}
const PAGE_COND = (r: Rng) => ({ switch1Valid: r.chance(0.5), switch1Id: 3, switch2Valid: r.chance(0.3), switch2Id: 4, variableValid: r.chance(0.3), variableId: 2, variableValue: r.pick([1, 5.5]), selfSwitchValid: r.chance(0.3), selfSwitchCh: r.pick(['A', 'B', 5]), itemValid: r.chance(0.2), itemId: 7, actorValid: r.chance(0.2), actorId: 1 });

function genRpg(r: Rng, name: string, cmds: string[]): GameFile {
  const L = () => genList(r, cmds);
  let json: unknown;
  if (/^Map/.test(name)) {
    json = {
      displayName: r.pick(['Forest', '', 'Ліс', 5]), tilesetId: 1,
      events: [null, ...Array.from({ length: r.int(4) }, (_, i) => r.chance(0.1) ? 5 : ({ id: r.pick([i + 1, i + 1, 12, 'x']), name: r.pick(NAMES), x: r.int(9), y: r.int(9), pages: Array.from({ length: r.int(3) }, () => r.chance(0.1) ? null : ({ conditions: PAGE_COND(r), trigger: r.int(5), list: r.chance(0.1) ? 5 : L() })) }))],
    };
  } else if (name === 'CommonEvents.json') json = [null, ...Array.from({ length: r.int(3) }, (_, i) => ({ id: i + 1, name: r.pick(NAMES), list: L() }))];
  else if (name === 'Troops.json') json = [null, ...Array.from({ length: r.int(3) }, (_, i) => ({ id: i + 1, name: r.pick(NAMES), pages: Array.from({ length: 1 + r.int(2) }, () => ({ list: L() })) }))];
  else if (name === 'System.json') json = { gameTitle: r.pick(['My Game', '', 'Гра']), currencyUnit: r.pick(['G', '']), elements: ['', 'Fire', 'Ice'], skillTypes: ['', 'Magic'], weaponTypes: [], armorTypes: ['', 'Shield'], equipTypes: ['', 'Weapon'], terms: { basic: ['Level', 'LV', ''], commands: ['Fight', 'Escape'], params: ['Max HP'], messages: { actionFailure: 'There was no effect on %1!', alwaysDash: 'Always Dash', emptyKey: '' } } };
  else {
    const fields: Record<string, string[]> = { 'Actors.json': ['name', 'nickname', 'profile'], 'Items.json': ['name', 'description'], 'Skills.json': ['name', 'description', 'message1', 'message2'], 'States.json': ['name', 'message1', 'message2', 'message3', 'message4'], 'Classes.json': ['name'], 'Enemies.json': ['name'], 'Weapons.json': ['name', 'description'], 'Armors.json': ['name', 'description'] };
    json = [null, ...Array.from({ length: r.int(4) }, (_, i) => Object.fromEntries([['id', i + 1], ...(fields[name] ?? ['name']).map(f => [f, r.pick([rw(r), '', 5])]), ...(r.chance(0.6) ? [['note', r.pick(['<Cost: 50>', '  ', 'x'.repeat(450)])]] : [])]))];
  }
  return { name, json };
}
const RPG_NAMES = ['Map001.json', 'Map012.json', 'CommonEvents.json', 'Troops.json', 'System.json', 'Actors.json', 'Items.json', 'Skills.json', 'States.json', 'Classes.json', 'Enemies.json', 'Weapons.json', 'Armors.json'];

function transFor(r: Rng, units: Unit[], extra: string[]): Translations {
  const tr: Translations = {};
  for (const u of units) if (r.chance(0.8)) tr[u.key] = { target: r.pick(['Привіт', 'Так\nНі', '  ', '', 'Line one\nline two', 'x', '"q"', "it's", 'tab\tx', '\\n', 'ґ']), status: 'done', mt: 1 };
  for (const k of extra) if (r.chance(0.5)) tr[k] = { target: 'Extra', status: 'done', mt: 1 };
  return tr;
}

// ---- текстові формати ----
function genCsv(r: Rng): string {
  const delim = r.pick([',', ';', '\t']), eol = r.pick(['\n', '\r\n']), bom = r.chance(0.2) ? '\uFEFF' : '';
  const header = r.pick([['key', 'source', 'target'], ['id', 'text', 'translation'], ['Ключ', 'Оригінал', 'Переклад'], ['source'], ['x', 'y', 'z'], ['name', 'en', 'uk']]);
  const noHeader = r.chance(0.25) || header[0] === 'x';
  const rows: string[][] = noHeader ? [] : [header];
  const wide = header.length;
  for (let i = 0; i < 1 + r.int(6); i++) {
    const row = [r.pick(['k1', 'k2', 'k1', `key${i}`, 'valueOf', '', ' ']), rw(r), r.pick(['', 'old', 'пер'])].slice(0, noHeader ? r.pick([2, 3]) : wide);
    rows.push(row);
  }
  const q = (c: string) => (c.includes(delim) || /["\n\r]/.test(c) || r.chance(0.1) ? `"${c.replace(/"/g, '""')}"` : c);
  return bom + rows.map(row => row.map(q).join(delim)).join(eol) + (r.chance(0.8) ? eol : '');
}
function genPo(r: Rng): string {
  const eol = r.pick(['\n', '\r\n']);
  const parts: string[] = [`msgid ""${eol}msgstr ""${eol}"Project-Id-Version: x\\n"${eol}"Plural-Forms: nplurals=${r.pick([2, 3])}; plural=(n != 1);\\n"`];
  for (let i = 0; i < 1 + r.int(5); i++) {
    const lines: string[] = [];
    if (r.chance(0.5)) lines.push(`#: src/file.c:${i}`);
    if (r.chance(0.2)) lines.push('#, fuzzy');
    if (r.chance(0.2)) lines.push('# translator comment');
    if (r.chance(0.2)) lines.push(`msgctxt "ctx${i}"`);
    const id = rw(r).replace(/\n/g, '\\n').replace(/"/g, '\\"');
    lines.push(`msgid "${id}"`);
    if (r.chance(0.3)) { lines.push(`msgid_plural "${id}s"`); lines.push('msgstr[0] ""'); lines.push('msgstr[1] ""'); if (r.chance(0.5)) lines.push('msgstr[2] "old"'); }
    else if (r.chance(0.2)) { lines.push('msgstr ""'); lines.push('"continued"'); }
    else lines.push(`msgstr "${r.pick(['', 'ст'])}"`);
    parts.push(lines.join(eol));
  }
  if (r.chance(0.2)) parts.push(`#~ msgid "gone"${eol}#~ msgstr "зникло"`);
  return parts.join(eol + eol) + eol;
}
function genRpy(r: Rng): string {
  const lines: string[] = ['label start:', '    scene bg room', '    "Narration line."', '    e "Hello, \\"world\\"!"', '    "Eileen" "Hi there"', '    e "with transition" with dissolve', '    menu:', '        "Go left":', '            jump left', '        "Go right" if flag:', '            jump right', '    $ x = "not text"', '    python:', '        y = "inside python"', '    define e = Character("Eileen")', '    # "commented"', '    """', '    triple "quoted"', '    """', '    e "after triple\\nnewline"', '    e "It\\\'s fine"'];
  return lines.filter(() => r.chance(0.8)).join(r.pick(['\n', '\r\n'])) + (r.chance(0.5) ? '\n' : '');
}
function genLocale(r: Rng): unknown {
  const walk = (d: number): unknown => (d > 2 || r.chance(0.35) ? r.pick([rw(r), 'x', '...', 5, null, true]) : r.chance(0.3) ? Array.from({ length: r.int(3) }, () => walk(d + 1)) : Object.fromEntries(Array.from({ length: 1 + r.int(3) }, () => [r.pick(['a', 'b', 'menu', 'constructor', '__proto__', 'ok.k']), walk(d + 1)])));
  return walk(0);
}

test('export formats vectors', () => {
  const r = rng(9090);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  for (const n of ['Map001.json', 'map001.json', 'Map001 (1).json', 'Items.json.txt', 'items.json', 'dir/Map12.json', 'C:\\x\\System.json', 'Mapx.json', 'foo.json', 'MapInfos.json.bak', 'ACTORS.JSON', 'Map001(2).json', 'Map001 (a).json', 'CommonEvents (3).json.txt']) add('canon', n, { canon: canonicalRpgMakerName(n), is: isRpgMakerFile(n.split(/[\\/]/).pop()!) });
  for (const s of ['abc', '\\p[1]', '...', 'a', '\\C[2]', '12', 'Привіт', '---\\{']) add('hasText', s, hasText(s));
  for (const c of ['GabText 1 2 hello world', 'Name', 'Name  ', 'Name 5 six', '', ' x', 'N 1  2  3 text\nmore']) add('splitCmd', c, splitPluginCommand(c));
  for (const k of ['a', 'constructor', '__proto__', 'toString', 'x.y', '']) add('safeKey', k, safeKey(k));
  for (const [s, t] of [[' Continue', 'Далі'], ['Go ', ' Йти'], ['A', 'Б'], ['  x  ', 'y'], ['x', '  '], ['  ', 'y'], ['\u00A0x\n', 'z'], ['x', '\n z \n']]) add('edges', { s, t }, { with: withEdges(s!, t!), s: edgesOf(s!), t: edgesOf(t!) });

  // RPG Maker
  for (let i = 0; i < 90; i++) {
    const name = r.pick(RPG_NAMES), cmds = r.pick([[], ['GabText'], ['GabText', 'ShowTip']]);
    const file = genRpg(r, name, cmds);
    const opts = { pluginCommands: cmds };
    const units = extract(file, opts);
    const tr = transFor(r, units, ['displayName', 'gameTitle', 'currencyUnit', 'nope']);
    const orig = JSON.stringify(file.json);
    const res = apply(file, tr);
    add('rpg', { file, opts, tr }, { units, applied: res, untouched: JSON.stringify(file.json) === orig, fmt: formatOf(file), text: isTextFormat(formatOf(file)) });
  }
  // нестандартні файли
  for (const f of [{ name: 'Map001.json', json: null }, { name: 'Map001.json', json: { events: 5 } }, { name: 'Items.json', json: {} }, { name: 'Unknown.json', json: [1] }, { name: 'dir/Map003.json', json: { displayName: 'X', events: [] } }] as GameFile[]) add('rpg', { file: f, opts: {}, tr: {} }, { units: extract(f), applied: apply(f, {}), untouched: true, fmt: formatOf(f), text: false });

  // текстові формати
  const textFile = (name: string, t: string): GameFile => ({ name, json: null, text: t });
  for (let i = 0; i < 40; i++) { const f = textFile(r.pick(['a.csv', 'b.tsv']), genCsv(r)); const units = extract(f); const tr = transFor(r, units, []); add('text', { file: f, tr }, { units, applied: apply(f, tr), fmt: formatOf(f) }); }
  for (let i = 0; i < 40; i++) { const f = textFile(r.pick(['a.po', 'b.pot']), genPo(r)); const units = extract(f); const tr = transFor(r, units, []); add('text', { file: f, tr }, { units, applied: apply(f, tr), fmt: formatOf(f) }); }
  for (let i = 0; i < 40; i++) { const f = textFile('script.rpy', genRpy(r)); const units = extract(f); const tr = transFor(r, units, []); add('text', { file: f, tr }, { units, applied: apply(f, tr), fmt: formatOf(f) }); }
  for (let i = 0; i < 40; i++) { const f: GameFile = { name: r.pick(['en.json', 'locales/uk.json', 'strings.json', 'package.json', 'data.json', 'i18n/messages.json']), json: genLocale(r) }; const units = extract(f); const tr = transFor(r, units, []); add('text', { file: f, tr }, { units, applied: apply(f, tr), fmt: formatOf(f) }); }
  add('text', { file: { name: 'a.po', json: null }, tr: {} }, { units: extract({ name: 'a.po', json: null }), applied: apply({ name: 'a.po', json: null }, {}), fmt: 'gettext' });
  for (const n of ['a.po', 'x.PO', 'f.csv', 'g.rpy', 'en.json', 'Map001.json', 'x.txt', 'noext', 'dir.po/file', 'a.b.tsv', 'strings.json']) add('format', n, formatOf({ name: n }));

  // збірка
  for (let i = 0; i < 40; i++) {
    const names = RPG_NAMES.filter(() => r.chance(0.25)).concat(r.chance(0.3) ? ['a.po'] : [], r.chance(0.2) ? ['x.csv'] : [], r.chance(0.2) ? ['weird.bin'] : []);
    const cmds = ['GabText'];
    const game: GameFile[] = names.map(n => (/\.(po|csv)$/.test(n) ? { name: n, json: null, text: n.endsWith('po') ? genPo(r) : genCsv(r) } : n.endsWith('.bin') ? { name: n, json: null } : genRpg(r, n, cmds)));
    const views: FileView[] = [];
    const saved: SavedProject = emptyProject('x');
    for (const f of game) {
      const units = extract(f, { pluginCommands: cmds });
      views.push({ name: f.name, units });
      const files: Translations = {};
      for (const u of units) if (r.chance(0.8)) { const e: Entry = { target: r.pick(['Привіт', 'Так\nНі', '  ', '', ' Рядок ', 'A very long line that will not fit in the window at all, really', 'Дуже довгий рядок діалогу, який точно не влізе у вузьке вікно гри', 'Дуже довгий рядок діалогу, який точно не влізе у вузьке вікно гри']), status: r.pick(['new', 'draft', 'done', 'appr']), mt: 1 }; files[u.key] = e; }
      saved.files[f.name] = files;
    }
    if (r.chance(0.2)) saved.files['missing.json'] = {};
    if (game.some(f => f.name === 'weird.bin')) saved.files['weird.bin'] = { k: { target: 'x', status: 'appr', mt: 1 } };
    let wrapDesc: { plan: unknown; desc: unknown } | null = r.chance(0.35) ? genPlan(r) : null;
    if (!wrapDesc && r.chance(0.6)) { const settings = wrapOf({ wrap: { mode: 'build', unit: 'chars', hyphen: r.pick(['off', 'needed', 'fill']), maxLines: r.pick([0, 2]), keep: r.pick(['reflow', 'long']) } as never }); wrapDesc = { plan: { settings, limit: 20, disabled: false }, desc: { settings, limit: 20, disabled: false, measure: false } }; }
    const settings = r.chance(0.6) ? { rules: { 'ws-edges': r.pick(['off', 'warn', 'bad']) } } : null;
    const qa = { tolerancePct: 25, terms: [], ...(wrapDesc ? { wrap: wrapDesc.plan } : {}), ...(settings ? { rules: qaOf({ qa: settings as never }) } : {}) };
    const o = { onlyApproved: r.chance(0.5), includeDrafts: r.chance(0.3), blockErrors: r.chance(0.5), qa };
    const desc = { onlyApproved: o.onlyApproved, includeDrafts: o.includeDrafts, blockErrors: o.blockErrors, qa: { tolerancePct: 25, wrap: wrapDesc ? wrapDesc.desc : null, settings } };
    add('build', { game, views, files: saved.files, opts: desc, cmds }, build(game, views, saved, o));
  }

  // порівняння гілок
  const KEYS = ['k0', 'k1', 'k2', 'k3'];
  const gen = (): Record<string, Translations> => Object.fromEntries(['F0.json', 'F1.json'].filter(() => r.chance(0.8)).map(f => [f, Object.fromEntries(KEYS.filter(() => r.chance(0.6)).map(k => [k, { ...genEntry(r), target: r.pick(['', 'a', 'b', 'c', ' ']), status: r.pick(['draft', 'done', 'appr'] as const) } as Entry]))]));
  for (let i = 0; i < 80; i++) {
    const base = gen(), mineF = r.chance(0.7) ? { ...base, ...gen() } : gen(), theirF = r.chance(0.7) ? { ...base, ...gen() } : gen();
    const cur = r.pick(['main', 'dev']), other = cur === 'main' ? 'dev' : 'main', link = r.pick(['theirs-from-mine', 'mine-from-theirs', 'none'] as const);
    const p = { ...emptyProject('x'), files: mineF, ...(cur !== 'main' ? { branch: cur } : {}), branches: { [other]: { at: 1, ...(link === 'theirs-from-mine' ? { from: cur, base } : {}), files: theirF }, [cur]: { at: 0, ...(link === 'mine-from-theirs' ? { from: other, base } : {}) } } } as SavedProject;
    let rows: DiffRow[] = [], err: string | null = null;
    try { rows = diffBranches(p, r.chance(0.9) ? other : 'nope'); } catch (e) { err = (e as Error).message; }
    const src = err ? 'nope' : other;
    const pick = r.pick(['default', 'all-theirs', 'all-custom', 'mixed'] as const), now = r.pick([5, 1000]);
    const decide = (x: DiffRow) => (pick === 'default' ? defaultDecision(x) : pick === 'all-theirs' ? { take: 'theirs' as const } : pick === 'all-custom' ? { take: 'custom' as const, text: rowId(x).length % 2 ? 'cust' : '' } : (rowId(x).length % 3 === 0 ? undefined : rowId(x).length % 3 === 1 ? { take: 'mine' as const } : { take: 'theirs' as const }));
    add('diff', { p, source: src, pick, now }, { err, rows, cur: branchOf(p), plan: planMerge(p, rows, decide, now), ids: rows.map(rowId) });
  }
  void text;
  writeVectors('formats', out);
});
