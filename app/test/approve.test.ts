import { describe, expect, it } from 'vitest';
import { approveEntry, commitRows, edit, journalBatches, newBatch, sendBack, undoJournal, DEFAULT_QA } from '../src/core';
import type { Entry, SavedProject, Unit } from '../src/core';
import { emptyProject } from '../src/core';

const unit = (source = 'Hello', key = 'k'): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: '' });
const opts = { blockErrors: true, qa: DEFAULT_QA };

describe('approveEntry', () => {
  it('sends a draft and approves it in one step', () => {
    const u = unit();
    const draft = edit(undefined, u, 'Привіт', 'translate', 1);
    const r = approveEntry(draft, u, 2, opts);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.entry.status).toBe('appr'); expect(r.entry.orig).toBe('Привіт'); }
  });

  it('approves a sent row and keeps an approved one approved', () => {
    const u = unit();
    const first = approveEntry(edit(undefined, u, 'Привіт', 'translate', 1), u, 2, opts);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const again = approveEntry(first.entry, u, 3, opts);
    expect(again.ok && again.entry.status).toBe('appr');
  });

  it('refuses an empty translation and says why', () => {
    const u = unit();
    expect(approveEntry(undefined, u, 1, opts)).toEqual({ ok: false, reason: 'Переклад порожній' });
    expect(approveEntry(edit(undefined, u, '  ', 'translate', 1), u, 1, opts).ok).toBe(false);
  });

  it('is stopped by a QA error like a send is', () => {
    const u = unit('Take the \\C[2]key\\C[0].');
    const draft = edit(undefined, u, 'Візьми ключ.', 'translate', 1);
    const r = approveEntry(draft, u, 2, opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/^Є помилка QA/);
    expect(approveEntry(draft, u, 2, { ...opts, blockErrors: false }).ok).toBe(true);
  });
});

describe('return for rework as an action of the journal', () => {
  it('can be listed and taken back', () => {
    const u = unit();
    const saved: SavedProject = emptyProject('t');
    const ok = approveEntry(edit(undefined, u, 'Привіт', 'translate', 1), u, 2, opts);
    if (!ok.ok) throw new Error('setup');
    saved.files['f.json'] = { k: ok.entry };
    const ents = (): Record<string, Entry> => saved.files['f.json']!;
    const id = commitRows(() => ents(), [{ file: 'f.json', key: 'k', next: sendBack(ents().k!, 10), text: 'Привіт' }], 'back', 'Ви', 10);
    expect(ents().k!.status).toBe('draft');
    expect(ents().k!.returned).toBe(true);
    const views = [{ name: 'f.json', units: [u] }] as never;
    const list = journalBatches(views, saved);
    expect(list[0]?.kind).toBe('back');
    const r = undoJournal(saved, id, 'Ви', 20);
    expect(r.done).toBe(1);
    expect(ents().k!.status).toBe('appr');
    expect(ents().k!.returned).toBeFalsy();
    expect(newBatch('copy', 1).startsWith('copy:')).toBe(true);
  });
});
