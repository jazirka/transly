import { journalBatches, undoJournal, undoReport } from '../core';
import type { UndoResult } from '../core';
import { toast } from './dom';
import type { Ctx } from './state';

/**
 * Take an action of the journal back (or, for an undo, repeat it) and tell how it went. The line Ctrl+Z walks along
 * follows: the action leaves its back line, and what took it back goes to the forward line.
 */
export function undoBatch(ctx: Ctx, id: string): UndoResult {
  const r = undoJournal(ctx.s.saved, id, ctx.s.who, Date.now());
  ctx.persist(); ctx.invalidateTm(); ctx.render();
  if (r.done) { if (r.kind === 'undo') ctx.history.redone(id, r.batch); else ctx.history.undone(id, r.batch); }
  return r;
}
function runUndo(ctx: Ctx, id: string): UndoResult {
  const r = undoBatch(ctx, id);
  toast(undoReport(r));
  return r;
}

/** A message about a bulk action that carries an «undo»: it takes back the whole action through the journal. Without an action id it is a plain message. */
export function undoToast(ctx: Ctx, text: string, batch: string | undefined, sticky = false): void {
  if (!batch) { toast(text, { sticky }); return; }
  toast(text, { sticky, action: { label: 'Скасувати', run: () => { runUndo(ctx, batch); } } });
}

/**
 * Ctrl+Z (`back`) and Ctrl+Shift+Z (`forward`) outside the text fields: the last bulk action of this session is taken
 * back, or taken back action repeated. Rows changed since an action are not touched. Right after a restart the line is
 * empty: then the newest action of the journal is offered once, so the key is not dead.
 */
export function undoByKey(ctx: Ctx, dir: 'back' | 'forward'): void {
  const h = ctx.history;
  for (;;) {
    let id = dir === 'back' ? h.takeUndo() : h.takeRedo();
    if (!id && dir === 'back' && !h.used) id = journalBatches(ctx.s.views, ctx.s.saved, 12).find(b => b.kind !== 'undo' && b.kind !== 'redo')?.id;
    if (!id) { toast(dir === 'back' ? 'Нічого скасовувати' : 'Нічого повертати'); return; }
    const r = undoJournal(ctx.s.saved, id, ctx.s.who, Date.now());
    // An action whose rows are not there any more was already taken back elsewhere (the activity list): take the next one.
    if (!r.done && !r.skipped) continue;
    ctx.persist(); ctx.invalidateTm(); ctx.render();
    if (r.done) { if (r.kind === 'undo') h.redone(id, r.batch); else h.undone(id, r.batch); }
    toast(undoReport(r));
    return;
  }
}
