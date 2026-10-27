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
  private pending: SavedProject | null = null;
  lastError: unknown = null;
  constructor(private store: ProjectStore, private delayMs = 400, private onStatus: (ok: boolean) => void = () => {}) {}
  queue(p: SavedProject): void {
    this.pending = p;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    try { await this.store.save(p); this.lastError = null; this.onStatus(true); }
    catch (e) { this.lastError = e; this.pending = p; this.onStatus(false); }
  }
}
