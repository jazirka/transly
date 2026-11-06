import { undoJournal, undoReport } from '../core';
import { toast } from './dom';
import type { Ctx } from './state';

/** A message about a bulk action that carries an «undo»: it takes back the whole action through the journal. Without an action id it is a plain message. */
export function undoToast(ctx: Ctx, text: string, batch: string | undefined, sticky = false): void {
  if (!batch) { toast(text, { sticky }); return; }
  toast(text, {
    sticky,
    action: {
      label: 'Скасувати',
      run: () => {
        const r = undoJournal(ctx.s.saved, batch, ctx.s.who, Date.now());
        ctx.persist(); ctx.invalidateTm(); ctx.render();
        toast(undoReport(r));
      },
    },
  });
}
