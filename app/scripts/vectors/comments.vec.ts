import { test } from 'vitest';
import type { Comment, Entry } from '../../src/core/model';
import { deleteComment, editComment, openThreads, replyTo, resolveThread, threadsOf } from '../../src/core/comments';
import { commentId } from '../../src/core/workflow';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const WHO = ['me', 'Аня', 'Борис'];

function genComments(r: Rng): Comment[] {
  const list: Comment[] = [];
  const n = r.int(8);
  for (let i = 0; i < n; i++) {
    const c: Comment = { who: r.pick(WHO), at: r.pick([100, 200, 300, 400, 500, 600 + i]), text: r.pick(['a', 'b', 'Привіт', '']) };
    if (r.chance(0.7)) c.id = r.pick([`id${i}`, `id${r.int(4)}`]);
    if (list.length && r.chance(0.5)) c.re = r.pick([...list.map(x => commentId(x)), 'missing', commentId(c)]);
    if (r.chance(0.15)) c.res = { who: r.pick(WHO), at: r.pick([700, 800]), ...(r.chance(0.4) ? { open: true } : {}) };
    if (r.chance(0.15)) c.ed = r.pick([900, 1000]);
    if (r.chance(0.15)) c.del = true;
    list.push(c);
  }
  return list;
}

test('export comments vectors', () => {
  const r = rng(1357);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });
  for (let i = 0; i < 300; i++) {
    const comments = r.chance(0.05) ? undefined : genComments(r);
    add('threads', comments ?? null, { threads: threadsOf(comments), open: openThreads(comments ? { target: '', status: 'new', mt: 0, comments } : undefined) });
    // operations on an entry
    const e0: Entry | undefined = r.chance(0.1) ? undefined : { target: 'x', status: 'draft', mt: 50, ...(comments ? { comments } : {}) };
    const ids = (comments ?? []).map(c => commentId(c));
    const ops = Array.from({ length: 1 + r.int(4) }, () => {
      const id = r.chance(0.8) && ids.length ? r.pick(ids) : 'nope';
      return r.pick([
        { op: 'reply', id, who: r.pick(WHO), text: r.pick(['r1', 'Привіт']), now: 2000 + r.int(50) },
        { op: 'resolve', id, on: r.chance(0.5), who: r.pick(WHO), now: 3000 + r.int(50) },
        { op: 'edit', id, text: r.pick(['e', '']), now: 4000 + r.int(50) },
        { op: 'delete', id, now: 5000 + r.int(50) },
      ]);
    });
    let e = e0;
    const states: unknown[] = [];
    for (const o of ops) {
      if (o.op === 'reply') e = replyTo(e, o.id, o.who!, o.text!, o.now!);
      else if (!e) { states.push(null); continue; }
      else if (o.op === 'resolve') e = resolveThread(e, o.id, o.on!, o.who!, o.now!);
      else if (o.op === 'edit') e = editComment(e, o.id, o.text!, o.now!);
      else e = deleteComment(e, o.id, o.now!);
      states.push(e);
    }
    add('ops', { entry: e0 ?? null, ops }, { states, threads: threadsOf(e?.comments) });
  }
  writeVectors('comments', out);
});
