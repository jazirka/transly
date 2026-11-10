#!/usr/bin/env node
// Generates independent test games in the RPG Maker MV `data/` format, from the format alone (no project internals):
//   node make-fixtures.mjs <out-dir>
//   <out>/clean-game/data    a small ordinary English game (a normal user's project)
//   <out>/hostile-game/data  the same shapes filled with hostile strings and structural oddities
//   <out>/big-game/data      ~100 000 message lines over 40 maps
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] ?? 'fixtures');
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const pick = a => a[Math.floor(rnd() * a.length)];
const write = (dir, name, data) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, name), typeof data === 'string' ? data : JSON.stringify(data)); };

const cmd = (code, parameters = [], indent = 0) => ({ code, indent, parameters });
const message = (lines, { face = '', faceIndex = 0, position = 2, speaker } = {}) => [cmd(101, [face, faceIndex, 0, position, ...(speaker !== undefined ? [speaker] : [])]), ...lines.map(l => cmd(401, [l]))];

const SENTENCES = [
  'The road north is closed after the storm.', 'Take this key, and do not lose it.', 'I have not seen anyone pass the gate since dawn.',
  'Your sword is dull; the smith in town can help.', 'Be careful: the \\C[2]old bridge\\C[0] will not hold two people.', 'Welcome back, \\N[1]. We were worried.',
  'You found \\V[3] gold coins in the chest.', 'The lantern flickers, then goes out.', 'Nobody speaks in the Hall of Echoes.',
  'Half the village has fallen ill; the healer needs herbs.', 'If you see the captain, tell him the harbour is not safe.', 'This is not a place for children.',
  'The river runs red at midnight, they say.', 'Press \\!the lever\\| and wait.', 'A cold wind carries the smell of smoke.', 'We march at first light.',
  'The merchant counts his coins twice, then smiles.', 'You cannot open this door yet.', 'Rest here; the inn is warm and the beds are clean.', 'I swear it on my mother\'s grave.',
];
const NAMES = ['Aldric', 'Mira', 'Tomas', 'Elena', 'Old Bram', 'Sister Vey', 'Captain Roth', 'Pip'];
const ITEMS = ['Healing Herb', 'Iron Key', 'Lantern Flail', 'Silver Ring', 'Old Map', 'Bread', 'Rope', 'Moonstone'];

function map(displayName, events) {
  return { displayName, tilesetId: 1, width: 17, height: 13, data: [], events: [null, ...events.map((list, i) => ({ id: i + 1, name: `EV${i + 1}`, x: i, y: 0, note: '', pages: [{ list: [...list, cmd(0)] }] }))] };
}
function database(prefix, names, descs) {
  return [null, ...names.map((n, i) => ({ id: i + 1, name: n, description: descs?.[i] ?? `${prefix} ${i + 1}`, note: '' }))];
}
function system(title, extra = {}) {
  return { gameTitle: title, currencyUnit: 'G', terms: { basic: ['Level', 'Lv', 'HP', 'HP', 'MP', 'MP', 'TP', 'TP', 'EXP', 'EXP'], commands: ['Fight', 'Escape', 'Attack', 'Guard', 'Item', 'Skill', 'Equip', 'Status', 'Formation', 'Save', 'Game End', 'Options', 'Weapon', 'Armor', 'Key Item', 'Equip', 'Optimize', 'Clear', 'New Game', 'Continue', null, 'To Title', 'Cancel', null, 'Buy', 'Sell'], params: ['Max HP', 'Max MP', 'Attack', 'Defense', 'M.Attack', 'M.Defense', 'Agility', 'Luck', 'Hit', 'Evasion'], messages: { actionFailure: 'There was no effect on %1!', actorDamage: '%1 took %2 damage!', victory: '%1 was victorious!', levelUp: '%1 is now %2 %3!', obtainGold: '%1\\G found!' } }, ...extra };
}

/* ---------- clean game ---------- */
{
  const dir = path.join(out, 'clean-game', 'data');
  write(dir, 'System.json', system('Lanternfall'));
  write(dir, 'Actors.json', database('Actor', ['Aldric', 'Mira', 'Tomas']));
  write(dir, 'Items.json', database('Item', ITEMS, ITEMS.map(n => `A ${n.toLowerCase()} that someone left behind.`)));
  write(dir, 'MapInfos.json', [null, { id: 1, name: 'Harbour', parentId: 0, order: 1 }, { id: 2, name: 'Old Bridge', parentId: 0, order: 2 }, { id: 3, name: 'Hall of Echoes', parentId: 0, order: 3 }]);
  for (let m = 1; m <= 3; m++) {
    const events = [];
    for (let e = 0; e < 8; e++) {
      const lines = Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => pick(SENTENCES));
      events.push([...message(lines, { face: 'Actor1', faceIndex: e % 8 }), ...(e % 3 === 0 ? [cmd(102, [['Yes', 'No', 'Later'], 1, 0, 2, 0]), cmd(402, [0, 'Yes'], 0), ...message([pick(SENTENCES)]), cmd(0, [], 1), cmd(404)] : [])]);
    }
    write(dir, `Map00${m}.json`, map(['Harbour', 'Old Bridge', 'Hall of Echoes'][m - 1], events));
  }
}

/* ---------- hostile game ---------- */
const HOSTILE = [
  '<img src=x onerror="window.__pwn=1">', '<script>window.__pwn=2</script>', '"><svg onload=window.__pwn=3>', "' onmouseover='window.__pwn=4' x='", 'javascript:window.__pwn=5',
  '</textarea><b>closed</b>', '&lt;b&gt;&amp;', '${7*7} {{7*7}} `${7*7}`', 'line\u2028separator and \u2029paragraph', 'rtl \u202Eoverride \u202C text', 'zero\u200Bwidth\u200Djoin\u2060ed',
  'lone surrogate \uD800 here', 'family \u{1F468}\u200D\u{1F469}\u200D\u{1F467} emoji', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'events[1].pages[0].list[0]',
  '\\C[2]unclosed', '\\C[', '\\N[1', 'trailing backslash \\', 'double \\\\ backslash', '\\\\C[2]not a code', '../../etc/passwd', 'C:\\Windows\\System32\\cmd.exe', 'file:///etc/passwd',
  'null\u0000byte', 'tab\tinside', 'very long: ' + 'A'.repeat(20000), 'x'.repeat(100000), '', ' ', '\n\n\n', '\\C[2]\\C[0]', 'ǅ ß İ ı Σ ς', '‮', 'Привіт, світе', 'Ёж ы э ъ', '"quotes" and \'apostrophes\' and `backticks`',
];
{
  const dir = path.join(out, 'hostile-game', 'data');
  const h = i => HOSTILE[i % HOSTILE.length];
  write(dir, 'System.json', system(h(0), { currencyUnit: h(1) }));
  write(dir, 'Actors.json', database('Actor', HOSTILE.slice(0, 12), HOSTILE.slice(12, 24)));
  write(dir, 'Items.json', database('Item', HOSTILE.slice(2, 20), HOSTILE.slice(8, 30)));
  write(dir, 'Skills.json', database('Skill', HOSTILE.slice(5, 15)));
  write(dir, 'MapInfos.json', [null, { id: 1, name: h(0), parentId: 0, order: 1 }, { id: 2, name: h(3), parentId: 0, order: 2 }]);
  const events = HOSTILE.map((t, i) => [
    ...message([t, h(i + 1)], { speaker: h(i + 2) }),
    cmd(102, [[h(i), h(i + 3), h(i + 4)], 1, 0, 2, 0]),
    cmd(105, [2, false]), cmd(405, [t]),
    cmd(108, [h(i)]), cmd(408, [h(i + 1)]),
    cmd(356, [`GabText ${t}`]),
  ]);
  const m1 = map(h(5), events);
  // structural oddities that real, hand-edited games contain
  m1.events.push(null, { id: 3, name: 'duplicate id', x: 0, y: 0, note: '', pages: [{ list: [cmd(0)] }] });
  m1.events.push({ id: 3, name: 'duplicate id again', x: 1, y: 0, note: '<xml>', pages: [{ list: [...message(['same id twice']), cmd(0)] }] });
  m1.events.push({ id: 99, name: 'no pages', x: 2, y: 0, note: '', pages: [] });
  m1.events.push({ id: 100, name: 'empty list', x: 3, y: 0, note: '', pages: [{ list: [] }] });
  m1.events.push({ id: 101, name: 'odd parameters', x: 4, y: 0, note: '', pages: [{ list: [cmd(101, []), cmd(401, [42]), cmd(401, [null]), cmd(401, [['nested']]), cmd(401), cmd(102, [[1, 2, 3]]), cmd(0)] }] });
  write(dir, 'Map001.json', m1);
  write(dir, 'Map002.json', map(h(7), [message(['identical line', 'identical line']), message(['identical line', 'identical line'])]));
  write(dir, 'Map003.json', '{"displayName": "truncated", "events": [null, {"id": 1, "pages": [{"list": [{"code": 101,');
  write(dir, 'CommonEvents.json', [null, { id: 1, name: h(9), list: [...message([h(10)]), cmd(0)] }]);
}

/* ---------- big game ---------- */
{
  const dir = path.join(out, 'big-game', 'data');
  const words = 'the road north river old bridge village captain gold coin storm night lantern door open close key sword wind cold smoke harbour merchant healer herb bread fire stone moon silent quiet march dawn dusk'.split(' ');
  const sentence = () => { const n = 4 + Math.floor(rnd() * 14); let s = Array.from({ length: n }, () => pick(words)).join(' '); s = s[0].toUpperCase() + s.slice(1) + pick(['.', '.', '!', '?', '...']); if (rnd() < 0.04) s = `\\C[${1 + Math.floor(rnd() * 7)}]${s}\\C[0]`; if (rnd() < 0.02) s = `\\N[${1 + Math.floor(rnd() * 4)}] ${s}`; return s; };
  write(dir, 'System.json', system('Epic'));
  write(dir, 'Actors.json', database('Actor', NAMES));
  write(dir, 'Items.json', database('Item', Array.from({ length: 400 }, (_, i) => `${pick(words)} ${pick(words)} ${i}`), Array.from({ length: 400 }, sentence)));
  const infos = [null];
  for (let m = 1; m <= 40; m++) {
    infos.push({ id: m, name: `Area ${m}`, parentId: 0, order: m });
    const events = [];
    for (let e = 0; e < 1000; e++) events.push(message(Array.from({ length: 1 + Math.floor(rnd() * 4) }, sentence), { face: 'Actor1', faceIndex: e % 8 }));
    write(dir, `Map${String(m).padStart(3, '0')}.json`, map(`Area ${m}`, events));
  }
  write(dir, 'MapInfos.json', infos);
}
console.log('fixtures written to', out);
for (const g of ['clean-game', 'hostile-game', 'big-game']) {
  let n = 0; for (const f of fs.readdirSync(path.join(out, g, 'data'))) { const t = fs.readFileSync(path.join(out, g, 'data', f), 'utf8'); n += (t.match(/"code":401/g) ?? []).length; }
  console.log(g, 'message lines:', n);
}
