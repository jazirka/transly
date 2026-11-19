import type { RowRef } from './groups';
import { activityKind } from './historyview';
import type { ActivityKind } from './historyview';
import { OTHER_DEVICE } from './merge';
import type { FileView, SavedProject } from './project';
import { plural } from './plural';
import { rowState } from './progress';
import { sourceChanged } from './workflow';

/**
 * What waits for the translator, as a short list: the states that need attention (QA errors, drafts that were not sent, rows waiting for proofreading,
 * originals that changed) and what the others did since the translator last looked (their comments and their work). Every item names the rows it is
 * about, so a click can show them. The age of the build is not here: it belongs to the build menu.
 */
export type InboxKind = 'error' | 'draft' | 'unreviewed' | 'source' | 'replies' | 'others';
export interface InboxItem { id: string; kind: InboxKind; title: string; sub: string; rows: RowRef[]; /** Items about what others did stop being news when marked as read. */ news: boolean }

export interface InboxInput {
  views: FileView[]; saved: SavedProject;
  /** Who the translator is: their own comments and work are not news. */
  who: string;
  /** When the translator last marked the news as read. */
  seen: number;
  /** The rows with a QA error in the whole project (made by the queue; it costs a pass of the QA over every row, so the caller keeps it). */
  errors: RowRef[];
}

const KIND_WORD: Record<ActivityKind, string> = { send: 'надіслано', approve: 'вичитано', restore: 'відновлено', back: 'повернуто', edit: 'правок' };

export function inboxOf(inp: InboxInput): InboxItem[] {
  const draft: RowRef[] = [], sent: RowRef[] = [], source: RowRef[] = [];
  const replies = new Map<string, RowRef[]>();
  const others = new Map<string, { refs: RowRef[]; kinds: Partial<Record<ActivityKind, number>> }>();
  for (const v of inp.views) {
    const ents = inp.saved.files[v.name];
    if (!ents) continue;
    for (const u of v.units) {
      const e = ents[u.key];
      if (!e) continue;
      const ref = { file: v.name, key: u.key }, st = rowState(e);
      if (st === 'draft') draft.push(ref); else if (st === 'sent') sent.push(ref);
      if (sourceChanged(e, u)) source.push(ref);
      const wrote = new Set<string>();
      for (const c of e.comments ?? []) {
        if (c.del || !c.who || c.who === inp.who || c.at <= inp.seen) continue;
        if (!replies.has(c.who)) replies.set(c.who, []);
        if (!wrote.has(c.who)) { replies.get(c.who)!.push(ref); wrote.add(c.who); }
      }
      const did = new Set<string>();
      for (const h of e.history ?? []) {
        if (!h.at || h.at <= inp.seen || !h.who || h.who === inp.who || h.who === OTHER_DEVICE) continue;
        let o = others.get(h.who);
        if (!o) others.set(h.who, o = { refs: [], kinds: {} });
        const k = activityKind(h.what);
        o.kinds[k] = (o.kinds[k] ?? 0) + 1;
        if (!did.has(h.who)) { o.refs.push(ref); did.add(h.who); }
      }
    }
  }
  const out: InboxItem[] = [];
  if (inp.errors.length) out.push({ id: 'error', kind: 'error', news: false, rows: inp.errors, title: plural(inp.errors.length, ['помилка QA', 'помилки QA', 'помилок QA']), sub: `Перейти до першої · ${inp.errors[0]!.file} · ${inp.errors[0]!.key}` });
  for (const [who, refs] of replies) out.push({ id: `replies:${who}`, kind: 'replies', news: true, rows: refs, title: `${who}: ${plural(refs.length, ['новий коментар', 'нові коментарі', 'нових коментарів'])}`, sub: `у ${plural(refs.length, ['рядку', 'рядках', 'рядках'])}` });
  for (const [who, o] of others) {
    const parts = (Object.keys(KIND_WORD) as ActivityKind[]).filter(k => o.kinds[k]).map(k => `${KIND_WORD[k]} ${o.kinds[k]}`);
    out.push({ id: `others:${who}`, kind: 'others', news: true, rows: o.refs, title: `Зміни від ${who}`, sub: parts.join(' · ') });
  }
  if (sent.length) out.push({ id: 'unreviewed', kind: 'unreviewed', news: false, rows: sent, title: `${plural(sent.length, ['рядок чекає', 'рядки чекають', 'рядків чекають'])} вичитки`, sub: 'надіслано, ще не вичитано' });
  if (draft.length) out.push({ id: 'draft', kind: 'draft', news: false, rows: draft, title: `${plural(draft.length, ['чернетка', 'чернетки', 'чернеток'])} не надіслано`, sub: 'показати всі' });
  if (source.length) out.push({ id: 'source', kind: 'source', news: false, rows: source, title: `${plural(source.length, ['рядок', 'рядки', 'рядків'])}: оригінал змінився`, sub: 'після оновлення гри' });
  return out;
}
