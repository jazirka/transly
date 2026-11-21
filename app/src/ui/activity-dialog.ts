import { autoBatches, autoUndone, batchTitle, batchUndoLabel, journalBatches, sendBatches, undoAuto, undoBatch, undoJournal, undoReport, undoneBatches, uiLocale } from '../core';
import type { JournalBatch, JournalItem, RowChange } from '../core';
import { dialog } from './settings';
import { undoBatch as undoViaStack } from './undo-toast';
import { $, esc, plural, toast } from './dom';
import type { Ctx } from './state';

type Ev = { id: string; at: number; text: string; sub?: string; rows?: { source: string; target: string }[]; undo?: () => { done: number; skipped: number; report?: string }; undoLabel?: string };

/** What was sent, approved and filled in automatically, with a way back while the rows are still untouched. */
export function openActivity(ctx: Ctx): void {
  const { s } = ctx;
  const dlg = dialog(`<form method="dialog"><h2 id="ac-t">Активність</h2>
    <p class="hint">Масові дії (надсилання, автозаповнення, заміни, перенесення рядків, очищення) можна скасувати, поки рядки не змінено, і потім повторити. Якщо дія була на іншому пристрої, спершу синхронізуйте проєкт.</p>
    <div id="ac-list"></div><div class="acts"><button class="btn" value="cancel">Закрити</button></div></form>`, 'ac-t');
  const open = new Set<string>();
  const n = (c: number): string => plural(c, ['рядок', 'рядки', 'рядків']);
  /** One line per action; single sends made one after another (within three minutes) are shown as one line that takes them all back. */
  const journalEvents = (): Ev[] => {
    const out: Ev[] = [];
    const GAP = 3 * 60 * 1000;
    let group: { ids: string[]; items: JournalItem[]; at: number; last: number } | null = null;
    const regular = (b: JournalBatch): Ev => ({ id: `j${b.id}`, at: b.at, text: batchTitle(b), ...(b.total > b.items.length ? { sub: `ще ${n(b.total - b.items.length)} змінено після цього` } : {}), rows: b.items.slice(0, 12), undo: () => { const r = undoViaStack(ctx, b.id); return { done: r.done, skipped: r.skipped, report: undoReport(r) }; }, undoLabel: batchUndoLabel(b) });
    const flush = (batches: Map<string, JournalBatch>): void => {
      const g = group; if (!g) return; group = null;
      if (g.ids.length === 1) { out.push(regular(batches.get(g.ids[0]!)!)); return; }
      out.push({ id: `jg${g.ids[0]}`, at: g.at, text: `Ви надіслали ${n(g.items.length)}`, rows: g.items.slice(0, 12), undoLabel: 'Скасувати',
        undo: () => { let done = 0, skipped = 0; for (const id of g.ids) { const r = undoViaStack(ctx, id); done += r.done; skipped += r.skipped; } return { done, skipped, report: `Скасовано надсилання: ${n(done)}` + (skipped ? `. Ще ${n(skipped)} змінено після дії, їх не чіпав` : '') }; } });
    };
    const list = journalBatches(s.views, s.saved, 80), byId = new Map(list.map(b => [b.id, b] as const));
    for (const b of list) {
      if (b.kind === 'send' && b.items.length === 1) {
        if (group && group.last - b.at <= GAP) { group.ids.push(b.id); group.items.push(...b.items); group.last = b.at; continue; }
        flush(byId); group = { ids: [b.id], items: [...b.items], at: b.at, last: b.at }; continue;
      }
      flush(byId); out.push(regular(b));
    }
    flush(byId);
    return out;
  };
  const events = (): Ev[] => [
    ...sendBatches(s.views, s.saved).map((b): Ev => ({ id: `s${b.at}${b.kind}${b.guessed ? 'g' : ''}`, at: b.at, text: b.kind === 'send' ? `Ви надіслали ${n(b.items.length)}` : `Ви вичитали ${n(b.items.length)}`, ...(b.guessed ? { sub: 'Запису про надсилання немає, знайдено за часом зміни' } : {}), rows: b.items.slice(0, 12), undo: () => ({ done: undoBatch(s.saved, b, s.who, Date.now()), skipped: 0 }), undoLabel: 'Скасувати відправлення' })),
    ...autoBatches(s.views, s.saved).map((b): Ev => ({ id: `a${b.at}${b.kind}`, at: b.at, text: b.kind === 'words' ? `Автозаповнення за словами: ${n(b.items.length)}` : `Підставлено з однакових рядків: ${n(b.items.length)}`, sub: b.kind === 'words' ? 'Чернетки, їх варто переглянути' : 'Надіслані без вашого перегляду', rows: b.items.slice(0, 12), undo: () => ({ done: undoAuto(s.saved, b, s.who, Date.now()), skipped: 0 }), undoLabel: 'Скасувати заповнення' })),
    ...journalEvents(),
    ...autoUndone(s.views, s.saved).map((u): Ev => ({ id: `au${u.at}${u.kind}`, at: u.at, text: `Ви скасували ${u.kind === 'words' ? 'автозаповнення' : 'підстановку'}: ${n(u.count)}` })),
    ...undoneBatches(s.views, s.saved).map((u): Ev => ({ id: `u${u.at}${u.kind}`, at: u.at, text: u.kind === 'send' ? `Ви скасували надсилання: ${n(u.count)}` : `Ви скасували вичитування: ${n(u.count)}` })),
  ].sort((a, b) => b.at - a.at);
  let evs: Ev[] = [];
  const draw = (): void => {
    evs = events();
    const dayKey = (t: number): string => new Date(t).toDateString();
    const today = dayKey(Date.now()), yest = dayKey(Date.now() - 86400000);
    const dayName = (t: number): string => (dayKey(t) === today ? 'Сьогодні' : dayKey(t) === yest ? 'Вчора' : new Date(t).toLocaleDateString(uiLocale(), { day: 'numeric', month: 'long' }));
    let last = '';
    $('#ac-list', dlg).innerHTML = evs.map((e, i) => {
      const head = dayKey(e.at) !== last ? `<h3>${dayName(e.at)}</h3>` : ''; last = dayKey(e.at);
      return `${head}<div class="sp-row ac-ev"><div class="sp-b"><b>${esc(e.text)}</b><span class="hint">${new Date(e.at).toLocaleTimeString(uiLocale(), { hour: '2-digit', minute: '2-digit', hour12: false })}${e.sub ? ' · ' + esc(e.sub) : ''}</span>
        ${e.undo ? `<div class="cs-v"><button class="btn" type="button" data-undo="${i}">${esc(e.undoLabel ?? 'Скасувати')}</button>${e.rows ? `<button class="btn" type="button" data-open="${i}">${open.has(e.id) ? 'Сховати рядки' : 'Показати рядки'}</button>` : ''}</div>` : ''}
        ${open.has(e.id) && e.rows ? e.rows.map(r => `<div class="fr-b">${esc(r.source.replace(/\s+/g, ' ').slice(0, 90))}</div><div class="fr-a">${esc(r.target.replace(/\s+/g, ' ').slice(0, 110))}</div>`).join('') : ''}</div></div>`;
    }).join('') || '<p class="hint">Активності ще немає</p>';
  };
  dlg.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-undo],[data-open]');
    if (!b) return;
    if (b.dataset.open) { const ev = evs[Number(b.dataset.open)]!; open.has(ev.id) ? open.delete(ev.id) : open.add(ev.id); draw(); return; }
    const ev = evs[Number(b.dataset.undo)]!;
    const r = ev.undo!();
    ctx.invalidateTm(); ctx.persist(); ctx.render(); draw();
    toast(r.report ?? (r.done ? `Скасовано: ${n(r.done)}` : 'Рядки вже змінено: скасувати нічого'));
  });
  draw();
}
