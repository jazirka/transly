import { linkChanges, linkModeOf, linkView, planLinkSync, reviewClusters, setMain } from '../core';
import type { LinkRowView, LinkState } from '../core';
import { $, esc, plural, toast } from './dom';
import { oneLine } from './hintcards';
import { dialog } from './settings';
import { undoToast } from './undo-toast';
import type { Ctx } from './state';

/** The words for the state of a row next to its twins. */
export const LINK_LABEL: Record<LinkState, string> = { main: 'еталон', same: 'такий самий', empty: 'без перекладу', differs: 'інший', edited: 'змінено пізніше', unlinked: 'відв’язано', draft: 'чернетка' };

/** Write the reference into the rows as one action of the journal (with its «Скасувати»). Returns how many rows changed. */
export function applyLinks(ctx: Ctx, reference: string, rows: LinkRowView[], what = 'Оновлено зв’язані рядки'): number {
  const changes = linkChanges(reference, rows, Date.now());
  if (!changes.length) return 0;
  const batch = ctx.commit(changes, 'link');
  ctx.persist(); ctx.invalidateTm(); ctx.render();
  undoToast(ctx, `${what}: ${plural(changes.length, ['рядок', 'рядки', 'рядків'])}`, batch);
  return changes.length;
}

/**
 * The rows of one cluster that differ from its reference, to tick and update: the empty and the older ones are ticked,
 * the ones changed after the reference was written are not (they are the translator's own later work).
 */
export function openLinkRows(ctx: Ctx, file: string, key: string): void {
  const { s } = ctx;
  const plan = planLinkSync(s.saved, ctx.links(), file, key);
  if (!plan?.view.reference) { toast('Для цих рядків немає чого поширювати: жоден не надіслано'); return; }
  const ref = plan.view.reference, reference = ref.target;
  const items = [...plan.fills, ...plan.updates, ...plan.edited];
  if (!items.length) { toast('Зв’язані рядки вже однакові'); return; }
  const off = new Set(plan.edited.map(r => r.ref));
  const dlg = dialog(`<form method="dialog"><h2 id="lk-t">Зв’язані рядки</h2>
    <p class="hint">Однаковий оригінал: <b>${esc(oneLine(plan.view.text, 120))}</b>. Еталон${plan.view.main ? ' (головний, який ви обрали)' : ' (надіслано останнім)'}: «${esc(oneLine(reference, 120))}» у «${esc(ctx.fileTitle(ref.file))}».</p>
    <p class="sum" id="lk-sum" role="status"></p><div class="sp-list" id="lk-list"></div>
    <div class="acts"><button class="btn" value="cancel">Закрити</button><button class="btn p" type="button" id="lk-go">Оновити вибрані</button></div></form>`, 'lk-t');
  const draw = (): void => {
    const n = items.filter(r => !off.has(r.ref)).length;
    $('#lk-sum', dlg).textContent = `Вибрано ${n} з ${items.length}. Зніміть позначку з рядків, які мають лишитися як є.${plan.edited.length ? ' Рядки, змінені пізніше за еталон, не позначені.' : ''}`;
    ($('#lk-go', dlg) as HTMLButtonElement).disabled = !n;
  };
  $('#lk-list', dlg).innerHTML = items.map((r, i) => `<label class="sp-row fr-row"><input type="checkbox" data-i="${i}" ${off.has(r.ref) ? '' : 'checked'} aria-label="Оновити ${esc(ctx.fileTitle(r.file))}"><div class="sp-b"><span class="hint">${esc(ctx.fileTitle(r.file))} · ${LINK_LABEL[r.state]}${r.status === 'appr' ? ' · вичитано (стане «надіслано»)' : ''}</span><div class="fr-b">${esc(oneLine(r.target, 160)) || '—'}</div><div class="fr-a">${esc(oneLine(reference, 160))}</div></div></label>`).join('');
  dlg.addEventListener('change', e => { const t = e.target as HTMLInputElement; if (t.dataset.i === undefined) return; const r = items[Number(t.dataset.i)]!; if (t.checked) off.delete(r.ref); else off.add(r.ref); draw(); });
  $('#lk-go', dlg).addEventListener('click', () => { const n = applyLinks(ctx, reference, items.filter(r => !off.has(r.ref))); if (n) dlg.close(); });
  draw();
}

/** The tool «Зв’язані рядки…»: every cluster of rows with the same original that has something to look at. */
export function openLinkTool(ctx: Ctx): void {
  const { s } = ctx;
  const mode = linkModeOf(s.saved.settings);
  const dlg = dialog(`<form method="dialog"><h2 id="lt-t">Зв’язані рядки</h2>
    <p class="hint">Рядки з однаковим оригіналом зв’язані: їхній переклад має бути однаковим. Тут видно ті, де це не так. Оберіть варіант, який лишається всюди (він стає головним), або заповніть порожні. Рядки, відв’язані від решти, не чіпаються.${mode === 'off' ? ' Зараз зв’язування вимкнено в налаштуваннях: рядки не оновлюються самі, але цим інструментом користуватися можна.' : ''}</p>
    <p class="sum" id="lt-sum" role="status"></p><div class="sp-list" id="lt-list"></div>
    <div class="acts"><button class="btn" value="cancel">Закрити</button></div></form>`, 'lt-t');
  let shown: ReturnType<typeof reviewClusters>['clusters'] = [];
  const draw = (): void => {
    const r = reviewClusters(s.saved, ctx.links(), 60);
    shown = r.clusters;
    $('#lt-sum', dlg).textContent = r.total ? `Груп із розбіжностями або порожніми рядками: ${r.total}${r.total > shown.length ? `, показано ${shown.length}` : ''}` : 'Усе узгоджено: зв’язані рядки мають однаковий переклад';
    $('#lt-list', dlg).innerHTML = shown.map((c, ci) => {
      const empties = c.counts.empty;
      const variants = c.variants.map((v, vi) => `<div class="cs-v"><span>${esc(oneLine(v.target, 120))} <span class="hint">× ${v.rows.length}${v.rows.some(x => x.ref === c.view.main?.ref) ? ' · головний' : ''}</span></span><button class="btn" type="button" data-c="${ci}" data-v="${vi}">Лишити цей</button></div>`).join('');
      const fill = c.variants.length === 1 && empties ? `<div class="cs-v"><span class="hint">Без перекладу: ${empties}</span><button class="btn" type="button" data-c="${ci}" data-fill>Заповнити порожні</button></div>` : '';
      return `<div class="sp-row cs-row"><div class="sp-b"><b>${esc(oneLine(c.text, 120))}</b> <span class="hint">${plural(c.view.rows.length, ['рядок', 'рядки', 'рядків'])}${c.counts.unlinked ? `, відв’язано ${c.counts.unlinked}` : ''}</span>${variants}${fill}<button class="btn" type="button" data-c="${ci}" data-open>Відкрити перший</button></div></div>`;
    }).join('');
  };
  dlg.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
    if (!b) return;
    const c = shown[Number(b.dataset.c)];
    if (!c) return;
    const first = c.view.rows[0]!;
    if (b.hasAttribute('data-open')) { dlg.close(); ctx.open(first.file, first.key); return; }
    let reference = c.view.reference?.target ?? '';
    if (b.dataset.v !== undefined) {
      const keep = c.variants[Number(b.dataset.v)]!;
      setMain(s.saved, keep.rows[0]!, Date.now());
      reference = keep.target;
    }
    const v = linkView(s.saved, ctx.links(), first.file, first.key);
    const rows = v ? v.rows.filter(r => r.state === 'empty' || r.state === 'differs' || r.state === 'edited') : [];
    if (!reference.trim()) return;
    const n = applyLinks(ctx, reference, rows, 'Узгоджено');
    if (!n) { ctx.persist(); ctx.render(); toast('Головний переклад обрано'); }
    draw();
  });
  draw();
}
