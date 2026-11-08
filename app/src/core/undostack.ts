/**
 * The line of bulk actions of this session that Ctrl+Z walks back along (and Ctrl+Shift+Z forward). It only keeps the
 * ids of the journal's actions (`journal.ts` does the real taking back), so it costs nothing and is empty after a restart.
 * A new action ends the forward line, as in any editor.
 */
export class UndoStack {
  private done: string[] = [];
  private redo: string[] = [];
  /** Whether this stack has ever held an action (a restart starts with none: then the newest action of the journal may be offered). */
  used = false;
  constructor(private readonly limit = 50) {}

  /** A new action was written: it can be taken back, and what was waiting to be repeated is gone. */
  record(id: string): void {
    this.used = true;
    this.done.push(id);
    if (this.done.length > this.limit) this.done.shift();
    this.redo.length = 0;
  }

  /** The action Ctrl+Z takes back next (removed from the line). */
  takeUndo(): string | undefined { this.used = true; return this.done.pop(); }
  /** The action Ctrl+Shift+Z repeats next (removed from the line). */
  takeRedo(): string | undefined { return this.redo.pop(); }

  /** `orig` was taken back by an action `batch`: repeating means taking `batch` back. `orig` leaves the back line wherever it was. */
  undone(orig: string, batch: string): void {
    this.used = true;
    const i = this.done.lastIndexOf(orig);
    if (i >= 0) this.done.splice(i, 1);
    this.redo.push(batch);
  }

  /** `orig` (an undo) was repeated by `batch`: it can be taken back again, and the rest of the forward line stays. */
  redone(orig: string, batch: string): void {
    const i = this.redo.lastIndexOf(orig);
    if (i >= 0) this.redo.splice(i, 1);
    this.done.push(batch);
  }

  get canUndo(): boolean { return this.done.length > 0; }
  get canRedo(): boolean { return this.redo.length > 0; }
  clear(): void { this.done.length = 0; this.redo.length = 0; }
}
