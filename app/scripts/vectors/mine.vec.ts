import { test } from 'vitest';
import type { Entry, Unit } from '../../src/core/model';
import type { FileView, SavedProject } from '../../src/core/project';
import { mineConstructions } from '../../src/core/mine';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

// verb + particle -> Ukrainian renderings (several forms of one verb, as the rows would have them)
const CONSTR: Record<string, string[]> = {
  'take off': ['зняти', 'зніми', 'знімає', 'знімаю'],
  'put on': ['одягти', 'одягни', 'одягає', 'одягаю'],
  'turn on': ['увімкнути', 'увімкни', 'вмикає'],
  'give up': ['здатися', 'здайся', 'здається'],
  'pick up': ['підняти', 'підніми', 'піднімає'],
  'look for': ['шукати', 'шукай', 'шукає'],
  'look at': ['дивитися', 'дивись', 'дивиться'],
};
const OBJ = ['your hat', 'the ring', 'my coat', 'the lamp', 'this thing', 'old boots', 'the key', 'it', ''];
const FILL = ['Please', 'Now', 'He said:', 'Quick!', 'Maybe', 'We should', 'I will', ''];
const NOISE_EN = ['The door is open.', 'Where are you going?', 'Nothing here.', 'Hello there, friend.', 'It was a long night.', 'Go to the town.', 'He runs away.', 'Wait for me.'];
const NOISE_UK = ['Двері відчинені.', 'Куди ти йдеш?', 'Тут нічого немає.', 'Привіт, друже.', 'Це була довга ніч.', 'Іди до міста.', 'Він тікає.', 'Чекай на мене.'];
const COMMON = ['будь ласка', 'потрібно', 'зараз', 'дуже'];

function gen(r: Rng, n: number): { views: FileView[]; files: SavedProject['files'] } {
  const views: FileView[] = [];
  const files: SavedProject['files'] = {};
  const names = ['a.json', 'b.json'];
  let k = 0;
  const rowsPerFile = Math.ceil(n / names.length);
  for (const name of names) {
    const units: Unit[] = [], rows: Record<string, Entry> = {};
    for (let i = 0; i < rowsPerFile; i++, k++) {
      const key = `${name}:${i}`;
      let source: string, target: string;
      const roll = r.next();
      if (roll < 0.55) {
        const c = r.pick(Object.keys(CONSTR));
        const [verb, part] = c.split(' ') as [string, string];
        const obj = r.pick(OBJ);
        // the verb alone (no particle) in some rows, to exercise the control pass
        const withPart = !r.chance(0.12);
        source = `${r.pick(FILL)} ${verb} ${withPart ? (obj ? obj + ' ' : '') + part : obj}${r.pick(['.', '!', ''])}`.trim();
        const uk = r.chance(0.85) ? r.pick(CONSTR[c]!) : r.pick(['інше', 'ще інакше', 'зробити']);
        target = `${r.pick(['Будь ласка,', '', 'Тепер'])} ${uk} ${r.pick(['це', 'його', ''])}${r.pick(['.', '!', ''])}`.replace(/\s+/g, ' ').trim();
        if (r.chance(0.2)) target += ' ' + r.pick(COMMON);
      } else {
        const j = r.int(NOISE_EN.length);
        source = NOISE_EN[j]!; target = NOISE_UK[j]! + (r.chance(0.5) ? ' ' + r.pick(COMMON) : '');
      }
      units.push({ key, source, speaker: '', kind: 'dialogue', context: '' });
      if (r.chance(0.97)) rows[key] = { target: r.chance(0.04) ? '' : target, status: r.pick(['done', 'done', 'appr', 'draft'] as const), mt: 1 };
    }
    views.push({ name, units });
    files[name] = rows;
  }
  return { views, files };
}

test('export mine vectors', async () => {
  const r = rng(909090);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });
  const sizes = [6, 20, 60, 120, 120, 200, 200, 60, 20, 120];
  for (let i = 0; i < sizes.length * 4; i++) {
    const { views, files } = gen(r, sizes[i % sizes.length]!);
    const terms = r.chance(0.4) ? [{ en: 'take … off' }, { en: 'put on' }] : [];
    const limit = r.pick([20000, 20000, 40, 7]);
    const slice = r.pick([2500, 3]);
    let pauses = 0;
    const res = await mineConstructions(views, { files } as unknown as SavedProject, terms, async () => { pauses++; }, limit, slice);
    add('mine', { views, files, terms, limit, slice }, { res, pauses });
  }
  writeVectors('mine', out);
});
