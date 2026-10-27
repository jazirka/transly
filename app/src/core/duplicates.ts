import type { Entry, Unit } from './model';
import type { FileView, SavedProject } from './project';

export interface Ref { file: string; key: string }

/** Index of units that share exactly the same original text, across all files. */
export class DupIndex {
  private bySource = new Map<string, Ref[]>();
  private sourceOf = new Map<string, string>();

  constructor(views: FileView[]) {
    for (const v of views) for (const u of v.units) {
      let l = this.bySource.get(u.source);
      if (!l) this.bySource.set(u.source, l = []);
      l.push({ file: v.name, key: u.key });
      this.sourceOf.set(`${v.name}\u0001${u.key}`, u.source);
    }
  }

  /** Other units with the same original as `file::key`. */
  others(file: string, key: string): Ref[] {
    const src = this.sourceOf.get(`${file}\u0001${key}`);
    if (src === undefined) return [];
    return (this.bySource.get(src) ?? []).filter(r => !(r.file === file && r.key === key));
  }
}

export type PropagateStage = 'translate' | 'review';

/**
 * After a unit was sent to review (translate pass) or approved (review pass), copy that result to identical units:
 *  - translate: only units that have no translation yet get the text and go straight to "waiting for review";
 *  - review: identical units that wait for review with the very same text are approved too.
 * Existing translations are never overwritten. Returns how many units changed.
 */
export function propagate(saved: SavedProject, dups: DupIndex, file: string, unit: Unit, entry: Entry, stage: PropagateStage, now: number, who: string): number {
  let n = 0;
  for (const r of dups.others(file, unit.key)) {
    const files = (saved.files[r.file] ??= {});
    const cur: Entry | undefined = files[r.key];
    if (stage === 'translate') {
      if (cur && cur.target.trim()) continue;
      files[r.key] = {
        ...(cur ?? {}), target: entry.target, status: 'done', mt: now, src: unit.source, orig: entry.target, returned: false,
        history: [...(cur?.history ?? []), { at: now, who, what: 'підставлено з однакового рядка', text: entry.target }].slice(-50),
      };
      n++;
    } else if (cur && cur.status === 'done' && cur.target === entry.target) {
      files[r.key] = { ...cur, status: 'appr', mt: now, history: [...(cur.history ?? []), { at: now, who, what: 'вичитано разом з однаковим рядком', text: '' }].slice(-50) };
      n++;
    }
  }
  return n;
}
