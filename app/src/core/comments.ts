import type { Comment, Entry } from './model';
import { addComment, commentId } from './workflow';

/**
 * Discussion of a row, as threads: a comment that opens a talk (the root) and the answers to it, in the order they were
 * written. A thread can be resolved and opened again; a comment can be edited by its author and deleted. None of it
 * changes the translation, so none of it moves the row's clock (`mt`).
 */
export interface Thread {
  /** Id of the root comment: replies point at it. */
  id: string;
  root: Comment;
  replies: Comment[];
  resolved: boolean;
  /** Who closed the thread and when, while it is closed. */
  by?: { who: string; at: number };
  /** Time of the newest comment of the thread (an edit counts). */
  last: number;
}

export const isDeleted = (c: Comment): boolean => !!c.del;
/** A comment is resolved when its newest resolve mark is not a "reopened". */
export const isResolved = (c: Comment): boolean => !!c.res && !c.res.open;

/** The comments that are still there (not deleted). */
export const liveComments = (comments: Comment[] | undefined): Comment[] => (comments ?? []).filter(c => !c.del);

/**
 * Threads of a row, oldest first. A reply to a reply belongs to the thread of the first one; a reply whose comment is gone
 * (deleted, or never reached this device) is shown as a thread of its own rather than hidden.
 */
export function threadsOf(comments: Comment[] | undefined): Thread[] {
  const live = liveComments(comments);
  const byId = new Map(live.map(c => [commentId(c), c]));
  const rootOf = (c: Comment): string => {
    let cur = c, id = commentId(c);
    const seen = new Set<string>();
    while (cur.re && !seen.has(id)) {
      seen.add(id);
      const parent = byId.get(cur.re);
      if (!parent) break;
      cur = parent; id = commentId(parent);
    }
    return id;
  };
  // Roots first, then the answers: a reply written on a device whose clock is behind can be older than the comment it answers.
  const sorted = [...live].sort((a, b) => a.at - b.at);
  const threads = new Map<string, Thread>();
  const rootIds = new Map<Comment, string>();
  for (const c of sorted) {
    const id = rootOf(c);
    rootIds.set(c, id);
    if (id === commentId(c)) threads.set(id, { id, root: c, replies: [], resolved: isResolved(c), ...(isResolved(c) ? { by: { who: c.res!.who, at: c.res!.at } } : {}), last: c.ed ?? c.at });
  }
  for (const c of sorted) {
    const id = rootIds.get(c)!;
    if (id === commentId(c)) continue;
    const t = threads.get(id);
    if (t) { t.replies.push(c); t.last = Math.max(t.last, c.ed ?? c.at); }
  }
  return [...threads.values()];
}

/** How many threads wait for an answer or a decision. */
export const openThreads = (e: Entry | undefined): number => threadsOf(e?.comments).filter(t => !t.resolved).length;

const mapComment = (e: Entry, id: string, f: (c: Comment) => Comment): Entry => {
  if (!e.comments?.some(c => commentId(c) === id)) return e;
  // The id is written down first: it was derived from the text for older comments, and an edit must not change it.
  return { ...e, comments: e.comments.map(c => (commentId(c) === id ? f({ ...c, id: commentId(c) }) : c)) };
};

/** Answer a comment: the reply joins the thread the comment belongs to. */
export function replyTo(e: Entry | undefined, parentId: string, who: string, text: string, now: number): Entry {
  const root = e?.comments ? threadsOf(e.comments).find(t => t.id === parentId || t.replies.some(r => commentId(r) === parentId))?.id : undefined;
  return addComment(e, who, text, now, root ?? parentId);
}

/** Close a thread (`on`), or open it again. */
export function resolveThread(e: Entry, rootId: string, on: boolean, who: string, now: number): Entry {
  return mapComment(e, rootId, c => ({ ...c, res: { who, at: now, ...(on ? {} : { open: true }) } }));
}

/** Change the text of a comment; the edit time decides in a merge. */
export function editComment(e: Entry, id: string, text: string, now: number): Entry {
  return mapComment(e, id, c => ({ ...c, text, ed: now }));
}

/** Delete a comment: its text goes, a trace stays so that a merge does not bring it back. */
export function deleteComment(e: Entry, id: string, now: number): Entry {
  return mapComment(e, id, c => ({ ...c, text: '', ed: now, del: true }));
}
