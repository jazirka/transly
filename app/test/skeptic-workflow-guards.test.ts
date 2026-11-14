import { describe, expect, it } from 'vitest';
import { approveEntry, edit, reconcile, sendBack, submit } from '../src/core';
import type { Entry, Unit } from '../src/core';

const unit: Unit = { key: 'k', source: 'Hello', speaker: '', kind: 'dialogue', context: '' };
const e = (target: string, status: Entry['status'], extra: Partial<Entry> = {}): Entry => ({ target, status, mt: 10, ...extra });

describe('edit: what a change of text does to the status of the row', () => {
  it('a translator who edits a sent or proofread row takes it back to a draft', () => {
    for (const status of ['done', 'appr'] as const) expect(edit(e('Привіт', status), unit, 'Вітаю', 'translate', 50).status, status).toBe('draft');
    expect(edit(e('', 'new'), unit, 'Привіт', 'translate', 50).status).toBe('draft');
  });
  it('a reviewer who edits keeps a sent or proofread row where it was; only a new row becomes a draft', () => {
    expect(edit(e('Привіт', 'done'), unit, 'Вітаю', 'review', 50).status).toBe('done');
    expect(edit(e('Привіт', 'appr'), unit, 'Вітаю', 'review', 50).status).toBe('appr');
    expect(edit(e('', 'new'), unit, 'Привіт', 'review', 50).status).toBe('draft');
  });
  it('emptying a row makes it new and clears the "returned" mark', () => {
    const out = edit(e('Привіт', 'draft', { returned: true }), unit, '', 'translate', 50);
    expect(out).toMatchObject({ target: '', status: 'new', returned: false });
  });
  it('the clock only moves forward and the source text is remembered', () => {
    expect(edit(e('a', 'draft', { mt: 100 }), unit, 'b', 'translate', 50)).toMatchObject({ mt: 101, src: 'Hello' });
    expect(edit(e('a', 'draft', { mt: 10 }), unit, 'b', 'translate', 50).mt).toBe(50);
  });
});

describe('submit and approve: the refusals', () => {
  it('says why a row cannot be sent', () => {
    expect(submit(undefined, unit, 'translate', 1)).toEqual({ ok: false, reason: 'Переклад порожній' });
    expect(submit(e('   ', 'draft'), unit, 'translate', 1)).toEqual({ ok: false, reason: 'Переклад порожній' });
    expect(submit(e('Привіт', 'done'), unit, 'translate', 1)).toEqual({ ok: false, reason: 'Рядок уже надіслано' });
    expect(submit(e('Привіт', 'appr'), unit, 'translate', 1)).toEqual({ ok: false, reason: 'Рядок уже вичитано' });
  });
  it('says why a row cannot be proofread', () => {
    expect(submit(e('Привіт', 'draft'), unit, 'review', 1)).toEqual({ ok: false, reason: 'Рядок ще не надіслано' });
    expect(submit(e('Привіт', 'new'), unit, 'review', 1)).toEqual({ ok: false, reason: 'Рядок ще не надіслано' });
  });
  it('sending records the original text and the sent text; proofreading approves', () => {
    const sent = submit(e('Привіт', 'draft', { returned: true }), unit, 'translate', 99);
    expect(sent).toMatchObject({ ok: true, entry: { status: 'done', orig: 'Привіт', returned: false, src: 'Hello', mt: 99 } });
    const appr = submit(e('Привіт', 'done'), unit, 'review', 99);
    expect(appr).toMatchObject({ ok: true, entry: { status: 'appr' } });
  });
  it('approving a draft sends and approves it in one step; a QA error stops it with the reason', () => {
    expect(approveEntry(e('Привіт', 'draft'), unit, 99)).toMatchObject({ ok: true, entry: { status: 'appr', orig: 'Привіт' } });
    expect(approveEntry(undefined, unit, 99)).toEqual({ ok: false, reason: 'Переклад порожній' });
    const coded: Unit = { ...unit, source: 'Take \\C[2]this\\C[0]' };
    const r = approveEntry(e('Візьми це', 'draft'), coded, 99);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/^Є помилка QA: /);
  });
  it('sending a row back returns it to the translator as a marked draft', () => {
    expect(sendBack(e('Привіт', 'done', { mt: 10 }), 5)).toMatchObject({ status: 'draft', returned: true, mt: 11 });
  });
});

describe('reconcile: a changed original takes sent and proofread rows back to drafts', () => {
  it('only rows whose original changed are touched, and only sent or proofread ones change status', () => {
    const entries: Record<string, Entry> = {
      a: e('т', 'done', { src: 'old' }), b: e('т', 'appr', { src: 'old' }), c: e('т', 'draft', { src: 'old', mt: 10 }), d: e('т', 'done', { src: 'Same' }),
    };
    const us = [{ ...unit, key: 'a', source: 'new' }, { ...unit, key: 'b', source: 'new' }, { ...unit, key: 'c', source: 'new' }, { ...unit, key: 'd', source: 'Same' }];
    expect(reconcile(us, entries, 500)).toEqual(['a', 'b', 'c']);
    expect(entries.a).toMatchObject({ status: 'draft', mt: 500 });
    expect(entries.b).toMatchObject({ status: 'draft', mt: 500 });
    expect(entries.c).toMatchObject({ status: 'draft', mt: 10 });
    expect(entries.d).toMatchObject({ status: 'done', mt: 10 });
  });
});
