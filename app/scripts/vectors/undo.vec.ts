import { test } from 'vitest';
import type { Entry } from '../../src/core/model';
import type { FileView, SavedProject } from '../../src/core/project';
import { sendBatches, undoBatch, undoneBatches } from '../../src/core/undosend';
import { UndoStack } from '../../src/core/undostack';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const T0 = 1_700_000_000_000;
const WHATS = ['надіслано', 'надіслано (масово)', 'вичитано', 'send', 'правка', 'автозаповнення', 'надсилання скасовано', 'вичитування скасовано', 'відновлено'];

function genEntry(r: Rng): Entry {
  const hist = Array.from({ length: r.int(4) }, (_, k) => ({ at: T0 + r.pick([0, 1000, 60_000, 179_000, 181_000, 600_000, 3_600_000]) + k, who: 'me', what: r.pick(WHATS), text: 't', ...(r.chance(0.1) ? { batch: 'b1' } : {}) }));
  const last = hist[hist.length - 1];
  const e: Entry = { target: r.pick(['Привіт', 'x', '', 'Text']), status: r.pick(['draft', 'done', 'appr', 'new'] as const), mt: last && r.chance(0.7) ? last.at - r.pick([0, 0, 5]) : T0 + r.int(4_000_000) };
  if (hist.length || r.chance(0.2)) e.history = hist;
  return e;
}

test('export undo vectors', () => {
  const r = rng(97531);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  for (let i = 0; i < 250; i++) {
    const views: FileView[] = [];
    const files: SavedProject['files'] = {};
    for (const name of ['a.json', 'b.json']) {
      const units = Array.from({ length: r.int(8) }, (_, k) => ({ key: `${name}:${k}`, source: `S${k}`, speaker: '', kind: 'dialogue' as const, context: '' }));
      views.push({ name, units });
      if (r.chance(0.9)) { const rows: Record<string, Entry> = {}; for (const u of units) if (r.chance(0.85)) rows[u.key] = genEntry(r); files[name] = rows; }
    }
    const limit = r.pick([20, 2, 1, 5]);
    const saved = { files: JSON.parse(JSON.stringify(files)) } as unknown as SavedProject;
    const batches = sendBatches(views, saved, limit);
    const undoneLimit = r.pick([10, 1, 2]);
    const undone = undoneBatches(views, saved, undoneLimit);
    // take back some batches
    const idx = batches.map((_, k) => k).filter(() => r.chance(0.6));
    const counts = idx.map((bi, k) => undoBatch(saved, batches[bi]!, 'me', T0 + 10_000_000 + k));
    add('send', { views, files, limit, undoneLimit, which: idx }, { batches, undone, counts, after: saved.files, again: sendBatches(views, saved, limit), undoneAfter: undoneBatches(views, saved) });
  }

  for (let i = 0; i < 300; i++) {
    const limit = r.pick([50, 3, 1]);
    const s = new UndoStack(limit);
    const ops: { op: string; id?: string; orig?: string; list?: string[] }[] = [];
    const log: unknown[] = [];
    let n = 0;
    for (let k = 0; k < 4 + r.int(14); k++) {
      const roll = r.next();
      const pickId = (): string => `a${r.int(Math.max(1, n))}`;
      if (roll < 0.35) { const id = `a${n++}`; ops.push({ op: 'record', id }); s.record(id); log.push(null); }
      else if (roll < 0.5) { ops.push({ op: 'takeUndo' }); log.push(s.takeUndo() ?? null); }
      else if (roll < 0.6) { ops.push({ op: 'takeRedo' }); log.push(s.takeRedo() ?? null); }
      else if (roll < 0.7) { const o = { op: 'undone', orig: pickId(), id: `u${n++}` }; ops.push(o); s.undone(o.orig, o.id); log.push(null); }
      else if (roll < 0.8) { const o = { op: 'redone', orig: pickId(), id: `v${n++}` }; ops.push(o); s.redone(o.orig, o.id); log.push(null); }
      else if (roll < 0.9) { const list = Array.from({ length: r.int(6) }, () => `a${r.int(8)}`); ops.push({ op: 'seed', list }); s.seed(list); log.push(null); }
      else { ops.push({ op: 'clear' }); s.clear(); log.push(null); }
      log.push({ canUndo: s.canUndo, canRedo: s.canRedo, used: s.used });
    }
    // drain to see the whole line
    const drainU: unknown[] = [], drainR: unknown[] = [];
    for (let k = 0; k < 60 && s.canUndo; k++) drainU.push(s.takeUndo());
    for (let k = 0; k < 60 && s.canRedo; k++) drainR.push(s.takeRedo());
    add('stack', { limit, ops }, { log, drainU, drainR });
  }
  writeVectors('undo', out);
});
