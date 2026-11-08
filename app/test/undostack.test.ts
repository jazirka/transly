import { describe, expect, it } from 'vitest';
import { UndoStack } from '../src/core';

describe('UndoStack', () => {
  it('walks back along the actions, newest first', () => {
    const s = new UndoStack();
    s.record('a'); s.record('b'); s.record('c');
    expect(s.takeUndo()).toBe('c');
    expect(s.takeUndo()).toBe('b');
    expect(s.canUndo).toBe(true);
    expect(s.takeUndo()).toBe('a');
    expect(s.takeUndo()).toBeUndefined();
  });

  it('an undone action can be repeated, and repeating can be taken back', () => {
    const s = new UndoStack();
    s.record('a');
    const id = s.takeUndo()!;
    s.undone(id, 'u1');
    expect(s.canRedo).toBe(true);
    const r = s.takeRedo()!;
    expect(r).toBe('u1');
    s.redone(r, 'r1');
    expect(s.canRedo).toBe(false);
    expect(s.takeUndo()).toBe('r1');
  });

  it('a new action ends the forward line', () => {
    const s = new UndoStack();
    s.record('a'); s.undone(s.takeUndo()!, 'u1');
    expect(s.canRedo).toBe(true);
    s.record('b');
    expect(s.canRedo).toBe(false);
    expect(s.takeRedo()).toBeUndefined();
  });

  it('an action taken back elsewhere (the activity list) leaves the back line', () => {
    const s = new UndoStack();
    s.record('a'); s.record('b');
    s.undone('a', 'u1');
    expect(s.takeUndo()).toBe('b');
    expect(s.takeUndo()).toBeUndefined();
    expect(s.takeRedo()).toBe('u1');
  });

  it('keeps only the newest actions', () => {
    const s = new UndoStack(3);
    for (const id of ['a', 'b', 'c', 'd']) s.record(id);
    expect([s.takeUndo(), s.takeUndo(), s.takeUndo(), s.takeUndo()]).toEqual(['d', 'c', 'b', undefined]);
  });

  it('says whether it was ever used', () => {
    const s = new UndoStack();
    expect(s.used).toBe(false);
    s.record('a');
    expect(s.used).toBe(true);
  });
});
