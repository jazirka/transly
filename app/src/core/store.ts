import { deserialize, serialize } from './project';
import type { SavedProject } from './project';
import type { Rescue } from './outbox';

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
  /** The newest state handed to `queue`, saved or not (what a page that is going away must not lose). */
  private latest: SavedProject | null = null;
  private inFlight = 0;
  /** Rows marked before this are known to be in the store: `rescueNow` keeps only the later ones (a minute of slack for clocks). */
  private since = Date.now() - 60_000;
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
    private rescue: Rescue | null = null,
  ) {}
  queue(p: SavedProject): void {
    this.pending = p;
    this.latest = p;
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }
  /** Until the next confirmed save every row counts as unsaved (work taken over from the outbox is older than the usual slack). */
  keepAll(): void { this.since = 0; }
  /** Something is not in the store yet: waiting for the delay, being written, or waiting for a retry. */
  get unsaved(): boolean { return this.pending !== null || this.timer !== null || this.retryTimer !== null || this.inFlight > 0; }
  /**
   * Called synchronously when the page is going away (a write that has only been started may not survive it): the rows changed
   * since the last confirmed save go to the synchronous outbox. Returns whether there was anything to keep.
   */
  rescueNow(): boolean {
    if (!this.rescue || !this.latest || !this.unsaved) return false;
    this.rescue.write(this.latest, this.since);
    return true;
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
    const started = Date.now();
    this.inFlight++;
    try {
      await this.store.save(p); this.lastError = null; this.failures = 0; this.since = started - 60_000;
      // nothing newer is waiting: what the outbox kept is in the store now
      if (!this.pending && !this.timer) this.rescue?.clear();
      this.onStatus(true);
    }
    catch (e) {
      this.lastError = e; this.failures++;
      // Keep the failed state for the retry only when nothing newer was queued meanwhile: the newest state always wins.
      if (!this.pending) this.pending = p;
      this.onStatus(false);
      if (!this.timer && !this.retryTimer) this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.flush(); }, this.retryMs(this.failures));
    } finally { this.inFlight--; }
  }
}
