import { test } from 'vitest';
import type { Entry, Unit } from '../../src/core/model';
import type { FileView, SavedProject } from '../../src/core/project';
import { inboxOf } from '../../src/core/inbox';
import { nextIn, positionOf, queueRows } from '../../src/core/queue';
import type { QueueKind } from '../../src/core/queue';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const KINDS: QueueKind[] = ['untranslated', 'error', 'advice', 'unreviewed', 'sourceChanged'];
const TARGETS = ['', ' ', 'Привіт', 'Привіт!', 'привіт', '\\C[2]Привіт', 'Hello', 'Привіт  світе', 'Це дуже довгий переклад, що значно перевищує довжину оригіналу, щоб викликати примітку про довжину', 'x'];
const SOURCES = ['Hello', 'Hello!', '\\C[2]Hello\\C[0]', 'Hello world', 'Long text here to be translated now', 'Sword', 'ab'];
const WHO = ['me', 'Аня', 'Борис', 'інший пристрій', ''];

function genEntry(r: Rng, src: string): Entry {
  const e: Entry = { target: r.pick(TARGETS), status: r.pick(['new', 'draft', 'done', 'appr', 'weird'] as never[]), mt: 1000 + r.int(1000) };
  if (r.chance(0.5)) e.src = r.chance(0.7) ? src : 'other source';
  if (r.chance(0.15)) e.ign = ['len', 'codes'];
  if (r.chance(0.4)) e.comments = Array.from({ length: 1 + r.int(3) }, () => ({ who: r.pick(WHO), at: r.pick([0, 500, 1500, 2500]), text: 'c', ...(r.chance(0.2) ? { del: true } : {}) })) as never;
  if (r.chance(0.5)) e.history = Array.from({ length: 1 + r.int(4) }, () => ({ at: r.pick([0, 500, 1500, 2500]), who: r.pick(WHO), what: r.pick(['send', 'надіслано', 'вичитано', 'відновлено', 'повернено', 'правка', 'затверджено']), text: 't' })) as never;
  return e;
}

test('export queue vectors', () => {
  const r = rng(24680);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });
  for (let i = 0; i < 150; i++) {
    const views: FileView[] = [];
    const files: SavedProject['files'] = {};
    for (const name of ['a.json', 'b.json', 'c.json']) {
      if (r.chance(0.15)) continue;
      const units: Unit[] = Array.from({ length: r.int(6) }, (_, k) => ({ key: `${name}:${k}`, source: r.pick(SOURCES), speaker: '', kind: r.pick(['dialogue', 'name', 'choice'] as const), context: '' }));
      views.push({ name, units });
      if (r.chance(0.9)) { const rows: Record<string, Entry> = {}; for (const u of units) if (r.chance(0.8)) rows[u.key] = genEntry(r, u.source); files[name] = rows; }
    }
    const terms = r.chance(0.5) ? [{ en: 'Sword', uk: 'Меч', mt: 1 }] : [];
    const qa = { tolerancePct: r.pick([25, 10]), terms, ...(r.chance(0.3) ? { lineLimit: 30 } : {}) };
    const saved = { files } as unknown as SavedProject;
    const res: Record<string, unknown> = {};
    for (const k of KINDS) res[k] = queueRows(views, saved, k, qa);
    const err = res.error as { file: string; key: string }[];
    const who = r.pick(['me', 'Аня', '']), seen = r.pick([0, 1000, 2000]);
    const inbox = inboxOf({ views, saved, who, seen, errors: err.map(x => ({ file: x.file, key: x.key })) });
    const some = views.flatMap(v => v.units.map(u => ({ file: v.name, key: u.key })));
    const froms = [null, { file: 'zzz', key: 'k' }, ...(some.length ? [r.pick(some), r.pick(some)] : []), { file: 'a.json', key: 'nokey' }];
    const positions = froms.map(f => positionOf(views, f));
    const nexts = KINDS.flatMap(k => { const rows = res[k] as { at: number }[]; return [-1, 0, 3, 7, 100].flatMap(at => ([1, -1] as const).map(dir => nextIn(rows as never, at, dir))); });
    add('queue', { views, files, qa, who, seen }, { res, inbox, positions, froms, nexts });
  }
  writeVectors('queue', out);
});
