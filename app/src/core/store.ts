import { deserialize, serialize } from './project';
import type { SavedProject } from './project';

/** Where a project lives. Browser = IndexedDB/localStorage, desktop = a file; the core only needs this. */
export interface ProjectStore {
  load(): Promise<SavedProject | null>;
  save(p: SavedProject): Promise<void>;
}

/** In-memory store for tests and for the mockup-style demo mode. */
export class MemoryStore implements ProjectStore {
  private text: string | null = null;
  async load(): Promise<SavedProject | null> { return this.text === null ? null : deserialize(this.text); }
  async save(p: SavedProject): Promise<void> { this.text = serialize(p); }
}

/**
 * Debounced saver: coalesces bursts of edits into one write and reports failures,
 * so the UI can show "не збережено" instead of silently losing work.
 */
export class Autosave {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: SavedProject | null = null;
  /** Writes happen strictly one after another, so a slow older write can never land after a newer one. */
  private chain: Promise<void> = Promise.resolve();
  lastError: unknown = null;
  /** Failed writes in a row (0 when the last write went through). */
  failures = 0;
  /**
   * @param retryMs how long to wait before the n-th retry of a failed write (1-based); the default doubles from 2 s up to 30 s
   */
  constructor(
    private store: ProjectStore,
    private delayMs = 400,
    private onStatus: (ok: boolean) => void = () => {},
    private retryMs: (n: number) => number = n => Math.min(30000, 2000 * 2 ** (n - 1)),
  ) {}
  queue(p: SavedProject): void {
    this.pending = p;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }
  /** Write what is waiting; resolves when this and every earlier write has finished (it never rejects). */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    const run = this.chain.then(() => this.writeOnce());
    this.chain = run;
    return run;
  }
  private async writeOnce(): Promise<void> {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    try { await this.store.save(p); this.lastError = null; this.failures = 0; this.onStatus(true); }
    catch (e) {
      this.lastError = e; this.failures++;
      // Keep the failed state for the retry only when nothing newer was queued meanwhile: the newest state always wins.
      if (!this.pending) this.pending = p;
      this.onStatus(false);
      if (!this.timer && !this.retryTimer) this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.flush(); }, this.retryMs(this.failures));
    }
  }
}
