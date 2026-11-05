import { touchTerms, almost, autoBatches, autoUndone, batchTitle, batchUndoLabel, edit, journalBatches, learnWords, proposals, sendBatches, undoAuto, undoBatch, undoJournal, undoReport, undoneBatches } from '../core';
import type { RowChange } from '../core';
import { dialog } from './settings';
import { $, esc, plural, toast } from './dom';
import type { Ctx } from './state';

/** Short untranslated lines in which every word is already known: the translation is put together word by word. */
export function openAutofill(ctx: Ctx): void {
  const { s } = ctx;
  const dlg = dialog(`<form method="dialog"><h2 id="af-t">Автозаповнення за словами</h2>
    <p class="hint">Короткі рядки без перекладу, у яких усі слова вже зустрічалися в перекладених рядках, збираються по словах. Вони записуються чернетками: їх варто переглянути, а в «Активності» можна скасувати.</p>
    <p class="sum" id="af-sum" role="status"></p><div class="sp-list" id="af-list"></div><div id="af-almost"></div>
    <div class="acts"><button class="btn" value="cancel">Закрити</button><button class="btn" type="button" id="af-all">Зняти всі</button><button class="btn p" type="button" id="af-go">Вписати вибрані</button></div></form>`, 'af-t');
  const off = new Set<string>();
  const draw = (): void => {
    const list = proposals(s.views, s.saved);
    const on = list.filter(p => !off.has(p.file + '\u0001' + p.key));
    $('#af-sum', dlg).textContent = list.length ? `Знаю слів: ${learnWords(s.views, s.saved).size} · рядків для автозаповнення: ${list.length}` : 'Поки нічого не вдається скласти: перекладіть більше рядків або додайте терміни';
    $('#af-list', dlg).innerHTML = list.slice(0, 120).map(p => `<label class="sp-row fr-row"><input type="checkbox" data-k="${esc(p.file + '\u0001' + p.key)}" ${off.has(p.file + '\u0001' + p.key) ? '' : 'checked'}><div class="sp-b"><span class="hint">${esc(s.views.find(v => v.name === p.file)?.label ?? p.file)}</span><div class="fr-b">${esc(p.source)}</div><div class="fr-a">${esc(p.target)}</div></div></label>`).join('');
    ($('#af-go', dlg) as HTMLButtonElement).disabled = !on.length;
    $('#af-all', dlg).textContent = on.length === list.length ? 'Зняти всі' : 'Вибрати всі';
    const near = almost(s.views, s.saved).slice(0, 20);
    $('#af-almost', dlg).innerHTML = near.length ? `<h3>Майже готові: не вистачає слів</h3><p class="hint">Слово неоднозначне, коли в перекладених рядках воно перекладене по-різному: оберіть варіант, і він стане терміном.</p>${near.map(a => `<div class="sp-row cs-row"><div class="sp-b"><b>${esc(a.source)}</b>${a.blockers.map(b => b.reason === 'ambiguous' ? `<div class="cs-v"><span class="hint">«${esc(b.word)}» неоднозначне:</span>${b.variants.map(v => `<button class="btn" type="button" data-w="${esc(b.word)}" data-v="${esc(v)}">${esc(v)}</button>`).join('')}</div>` : `<div class="cs-v"><span class="hint">«${esc(b.word)}» ще не зустрічалось у перекладах: додайте його в глосарій</span></div>`).join('')}</div></div>`).join('')}` : '';
  };
  dlg.addEventListener('change', e => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.k) { t.checked ? off.delete(t.dataset.k) : off.add(t.dataset.k); draw(); }
  });
  dlg.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-w]');
    if (!b) return;
    const en = b.dataset.w!, uk = b.dataset.v!;
    if (!s.saved.terms.some(t => t.en.toLowerCase() === en.toLowerCase())) { s.saved.terms.push({ en, uk, mt: Date.now() }); touchTerms(s.saved.terms); }
    ctx.invalidateTm(); ctx.persist(); draw();
    toast(`Термін додано: ${en} → ${uk}`);
  });
  $('#af-all', dlg).addEventListener('click', () => {
    const list = proposals(s.views, s.saved), allOn = list.every(p => !off.has(p.file + '\u0001' + p.key));
    for (const p of list) allOn ? off.add(p.file + '\u0001' + p.key) : off.delete(p.file + '\u0001' + p.key);
    draw();
  });
  $('#af-go', dlg).addEventListener('click', () => {
    const now = Date.now();
    const changes: RowChange[] = [];
    for (const p of proposals(s.views, s.saved)) {
      if (off.has(p.file + '\u0001' + p.key)) continue;
      const u = s.views.find(v => v.name === p.file)?.units.find(x => x.key === p.key);
      const ents = ctx.entries(p.file);
      if (!u || ents[p.key]?.target?.trim()) continue;
      changes.push({ file: p.file, key: p.key, next: edit(ents[p.key], u, p.target, ctx.stage(), now), text: p.target });
    }
    const n = changes.length;
    if (n) ctx.commit(changes, 'words');
    ctx.invalidateTm(); ctx.persist(); ctx.render(); dlg.close();
    toast(`Вписано чернеток: ${n}. Скасувати можна в «Активності»`);
  });
  draw();
}

type Ev = { id: string; at: number; text: string; sub?: string; rows?: { source: string; target: string }[]; undo?: () => { done: number; skipped: number; report?: string }; undoLabel?: string };

/** What was sent, approved and filled in automatically, with a way back while the rows are still untouched. */
export function openActivity(ctx: Ctx): void {
  const { s } = ctx;
  const dlg = dialog(`<form method="dialog"><h2 id="ac-t">Активність</h2>
    <p class="hint">Масові дії (надсилання, автозаповнення, заміни, перенесення рядків, очищення) можна скасувати, поки рядки не змінено, і потім повторити. Якщо дія була на іншому пристрої, спершу синхронізуйте проєкт.</p>
    <div id="ac-list"></div><div class="acts"><button class="btn" value="cancel">Закрити</button></div></form>`, 'ac-t');
  const open = new Set<string>();
  const n = (c: number): string => plural(c, ['рядок', 'рядки', 'рядків']);
  const events = (): Ev[] => [
    ...sendBatches(s.views, s.saved).map((b): Ev => ({ id: `s${b.at}${b.kind}${b.guessed ? 'g' : ''}`, at: b.at, text: b.kind === 'send' ? `Ви надіслали ${n(b.items.length)} на вичитування` : `Ви затвердили ${n(b.items.length)}`, ...(b.guessed ? { sub: 'Запису про відправлення немає, знайдено за часом зміни' } : {}), rows: b.items.slice(0, 12), undo: () => ({ done: undoBatch(s.saved, b, s.who, Date.now()), skipped: 0 }), undoLabel: 'Скасувати відправлення' })),
    ...autoBatches(s.views, s.saved).map((b): Ev => ({ id: `a${b.at}${b.kind}`, at: b.at, text: b.kind === 'words' ? `Автозаповнення за словами: ${n(b.items.length)}` : `Підставлено з однакових рядків: ${n(b.items.length)}`, sub: b.kind === 'words' ? 'Чернетки, їх варто переглянути' : 'Чекають вичитування без вашого перегляду', rows: b.items.slice(0, 12), undo: () => ({ done: undoAuto(s.saved, b, s.who, Date.now()), skipped: 0 }), undoLabel: 'Скасувати заповнення' })),
    ...journalBatches(s.views, s.saved).map((b): Ev => ({ id: `j${b.id}`, at: b.at, text: batchTitle(b), ...(b.total > b.items.length ? { sub: `ще ${n(b.total - b.items.length)} змінено після цього` } : {}), rows: b.items.slice(0, 12), undo: () => { const r = undoJournal(s.saved, b.id, s.who, Date.now()); return { done: r.done, skipped: r.skipped, report: undoReport(r) }; }, undoLabel: batchUndoLabel(b) })),
    ...autoUndone(s.views, s.saved).map((u): Ev => ({ id: `au${u.at}${u.kind}`, at: u.at, text: `Ви скасували ${u.kind === 'words' ? 'автозаповнення' : 'підстановку'}: ${n(u.count)}` })),
    ...undoneBatches(s.views, s.saved).map((u): Ev => ({ id: `u${u.at}${u.kind}`, at: u.at, text: u.kind === 'send' ? `Ви скасували відправлення: ${n(u.count)}` : `Ви скасували затвердження: ${n(u.count)}` })),
  ].sort((a, b) => b.at - a.at);
  let evs: Ev[] = [];
  const draw = (): void => {
    evs = events();
    const dayKey = (t: number): string => new Date(t).toDateString();
    const today = dayKey(Date.now()), yest = dayKey(Date.now() - 86400000);
    const dayName = (t: number): string => (dayKey(t) === today ? 'Сьогодні' : dayKey(t) === yest ? 'Вчора' : new Date(t).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' }));
    let last = '';
    $('#ac-list', dlg).innerHTML = evs.map((e, i) => {
      const head = dayKey(e.at) !== last ? `<h3>${dayName(e.at)}</h3>` : ''; last = dayKey(e.at);
      return `${head}<div class="sp-row ac-ev"><div class="sp-b"><b>${esc(e.text)}</b><span class="hint">${new Date(e.at).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}${e.sub ? ' · ' + esc(e.sub) : ''}</span>
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
