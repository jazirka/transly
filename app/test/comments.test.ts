import { describe, expect, it } from 'vitest';
import { addComment, commentId, deleteComment, editComment, isResolved, mergeEntry, openThreads, replyTo, resolveThread, threadsOf } from '../src/core';
import type { Entry } from '../src/core';

const base = (): Entry => ({ target: 'Привіт', status: 'draft', mt: 100 });

describe('threads of a row', () => {
  it('a reply joins the thread of its comment, also a reply to a reply', () => {
    let e = addComment(base(), 'Анна', 'Чи не краще «Вітаю»?', 1000);
    const root = commentId(e.comments![0]!);
    e = replyTo(e, root, 'Ви', 'Так, змінила', 2000);
    const first = commentId(e.comments![1]!);
    e = replyTo(e, first, 'Анна', 'Дякую', 3000);
    const t = threadsOf(e.comments);
    expect(t).toHaveLength(1);
    expect(t[0]!.root.text).toContain('Вітаю');
    expect(t[0]!.replies.map(r => r.text)).toEqual(['Так, змінила', 'Дякую']);
    // Both replies point at the root, never at each other.
    expect(e.comments!.slice(1).every(c => c.re === root)).toBe(true);
    expect(t[0]!.last).toBe(3000);
  });

  it('separate comments are separate threads, oldest first', () => {
    let e = addComment(base(), 'А', 'перше', 1000);
    e = addComment(e, 'Б', 'друге', 2000);
    expect(threadsOf(e.comments).map(t => t.root.text)).toEqual(['перше', 'друге']);
  });

  it('a reply older than its comment (a device with a slow clock) is not lost', () => {
    const root = { who: 'А', at: 5000, text: 'питання', id: 'r1' };
    const reply = { who: 'Б', at: 4000, text: 'відповідь', id: 'r2', re: 'r1' };
    const t = threadsOf([reply, root]);
    expect(t).toHaveLength(1);
    expect(t[0]!.replies.map(r => r.text)).toEqual(['відповідь']);
  });

  it('a reply whose comment is gone stays visible as a thread of its own', () => {
    const e = addComment(base(), 'А', 'питання', 1000);
    const root = commentId(e.comments![0]!);
    const e2 = replyTo(e, root, 'Б', 'відповідь', 2000);
    const gone = deleteComment(e2, root, 3000);
    const t = threadsOf(gone.comments);
    expect(t).toHaveLength(1);
    expect(t[0]!.root.text).toBe('відповідь');
  });

  it('comments that answer each other in a circle do not hang the grouping', () => {
    const t = threadsOf([{ who: 'А', at: 1, text: 'a', id: 'a', re: 'b' }, { who: 'Б', at: 2, text: 'b', id: 'b', re: 'a' }]);
    expect(t.length).toBeGreaterThan(0);
  });

  it('older comments without an id still form threads', () => {
    const legacy = { who: 'А', at: 10, text: 'старий' };
    const id = commentId(legacy);
    const e: Entry = { ...base(), comments: [legacy] };
    const r = replyTo(e, id, 'Б', 'відповідь', 20);
    expect(threadsOf(r.comments)[0]!.replies).toHaveLength(1);
  });
});

describe('resolving, editing and deleting', () => {
  it('resolve and reopen', () => {
    let e = addComment(base(), 'А', 'питання', 1000);
    const id = commentId(e.comments![0]!);
    expect(openThreads(e)).toBe(1);
    e = resolveThread(e, id, true, 'Ви', 2000);
    expect(openThreads(e)).toBe(0);
    expect(threadsOf(e.comments)[0]).toMatchObject({ resolved: true, by: { who: 'Ви', at: 2000 } });
    e = resolveThread(e, id, false, 'Ви', 3000);
    expect(openThreads(e)).toBe(1);
    expect(isResolved(e.comments![0]!)).toBe(false);
  });

  it('none of it moves the clock of the translation', () => {
    let e = addComment(base(), 'А', 'питання', 1000);
    const id = commentId(e.comments![0]!);
    e = replyTo(e, id, 'Б', 'так', 1500);
    e = resolveThread(e, id, true, 'Ви', 2000);
    e = editComment(e, id, 'питання?', 2500);
    e = deleteComment(e, commentId(e.comments![1]!), 3000);
    expect(e.mt).toBe(100);
    expect(e.target).toBe('Привіт');
  });

  it('an edit keeps the id of an older comment, so its replies stay attached', () => {
    const legacy = { who: 'А', at: 10, text: 'старий' };
    const id = commentId(legacy);
    let e: Entry = { ...base(), comments: [legacy] };
    e = replyTo(e, id, 'Б', 'відповідь', 20);
    e = editComment(e, id, 'новий текст', 30);
    expect(e.comments![0]).toMatchObject({ text: 'новий текст', ed: 30, id });
    expect(threadsOf(e.comments)[0]!.replies).toHaveLength(1);
  });

  it('a deleted comment leaves a trace without text and disappears from the threads', () => {
    let e = addComment(base(), 'А', 'зайве', 1000);
    const id = commentId(e.comments![0]!);
    e = deleteComment(e, id, 2000);
    expect(e.comments).toHaveLength(1);
    expect(e.comments![0]).toMatchObject({ del: true, text: '' });
    expect(threadsOf(e.comments)).toEqual([]);
  });

  it('operations on an unknown id change nothing', () => {
    const e = addComment(base(), 'А', 'x', 1000);
    expect(editComment(e, 'нема', 'y', 2000)).toBe(e);
    expect(resolveThread(e, 'нема', true, 'Ви', 2000)).toBe(e);
    expect(deleteComment(e, 'нема', 2000)).toBe(e);
  });
});

describe('merging threads from two devices', () => {
  const start = (): { e: Entry; id: string } => { const e = addComment(base(), 'А', 'питання', 1000); return { e, id: commentId(e.comments![0]!) }; };

  it('a thread resolved on one device and answered on the other keeps both', () => {
    const { e, id } = start();
    const a = resolveThread(e, id, true, 'Ви', 2000);
    const b = replyTo(e, id, 'Б', 'відповідь', 2500);
    const m = mergeEntry(a, b);
    const t = threadsOf(m.comments);
    expect(t).toHaveLength(1);
    expect(t[0]!.resolved).toBe(true);
    expect(t[0]!.replies).toHaveLength(1);
  });

  it('the newest of resolve and reopen wins', () => {
    const { e, id } = start();
    const closed = resolveThread(e, id, true, 'Ви', 2000);
    const reopened = resolveThread(closed, id, false, 'Анна', 3000);
    expect(threadsOf(mergeEntry(closed, reopened).comments)[0]!.resolved).toBe(false);
    expect(threadsOf(mergeEntry(reopened, closed).comments)[0]!.resolved).toBe(false);
  });

  it('an edit on one side and a resolve on the other both survive', () => {
    const { e, id } = start();
    const a = editComment(e, id, 'питання?', 2000);
    const b = resolveThread(e, id, true, 'Ви', 2100);
    const m = mergeEntry(a, b);
    expect(m.comments![0]).toMatchObject({ text: 'питання?', res: { who: 'Ви', at: 2100 } });
  });

  it('a deleted comment is not brought back by the device that still has it', () => {
    const { e, id } = start();
    const gone = deleteComment(e, id, 2000);
    expect(threadsOf(mergeEntry(gone, e).comments)).toEqual([]);
    expect(threadsOf(mergeEntry(e, gone).comments)).toEqual([]);
  });
});
