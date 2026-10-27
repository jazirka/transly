import { speakerCandidates, speakerOf } from '../core';
import { $, el, esc, plural, toast } from './dom';
import type { Ctx } from './state';

/**
 * RPG Maker MV stores no speaker name. Two things usually identify who talks: the face graphic of the message
 * and the event it sits in (an NPC). The translator names each once; every message that shares it gets the name.
 */
const KIND_LABEL = { face: 'Обличчя', note: 'Позначка', event: 'Подія' } as const;

export function openSpeakers(ctx: Ctx): void {
  const { s } = ctx;
  const cands = speakerCandidates(s.views);
  const map = () => (s.saved.speakers ??= {});
  const names = [...new Set(Object.values(map()).map(v => v.name))].sort((a, b) => a.localeCompare(b, 'uk'));
  const opener = document.activeElement as HTMLElement | null;
  const dlg = el('dialog', 'adlg');
  dlg.setAttribute('aria-labelledby', 'sp-t');
  const covered = () => {
    let total = 0, named = 0;
    for (const v of s.views) for (const u of v.units) if (u.kind === 'dialogue') { total++; if (speakerOf(u, s.saved.speakers)) named++; }
    return `Мовця визначено для ${named.toLocaleString('uk-UA')} із ${total.toLocaleString('uk-UA')} реплік.`;
  };
  dlg.innerHTML = `<form method="dialog"><h2 id="sp-t">Хто говорить</h2>
    <p class="hint">У грі на RPG Maker MV імен мовців немає. Підказують <b>обличчя</b> персонажа в діалозі, <b>позначка</b> розробників (коментар перед текстом, наприклад «MARCOH») і <b>подія</b>, до якої належить репліка (часто це сам NPC). Вкажіть ім’я один раз: воно підставиться в усі репліки з тією самою ознакою.</p>
    <div class="grid"><label for="sp-q">Пошук</label><input id="sp-q" type="search" placeholder="Обличчя, подія або текст"></div>
    <p class="sum" id="sp-sum" role="status"></p>
    <div class="sp-list" id="sp-list"></div>
    <datalist id="sp-names">${names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
    <div class="acts"><button class="btn" value="cancel">Скасувати</button><button class="btn p" id="sp-save" value="save">Зберегти</button></div></form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => { dlg.remove(); opener?.focus?.(); });
  const draft = new Map<string, string>();
  for (const c of cands) draft.set(c.key, map()[c.key]?.name ?? '');
  const render = () => {
    const q = ($('#sp-q', dlg) as HTMLInputElement).value.trim().toLowerCase();
    const list = cands.filter(c => !q || (c.label + ' ' + c.sample + ' ' + (draft.get(c.key) ?? '')).toLowerCase().includes(q));
    $('#sp-sum', dlg).textContent = `${covered()} Показано ${list.length} із ${plural(cands.length, ['варіанта', 'варіантів', 'варіантів'])}.`;
    $('#sp-list', dlg).innerHTML = list.slice(0, 80).map((c, i) => `<div class="sp-row"><span class="sp-k ${c.kind}">${KIND_LABEL[c.kind]}</span><div class="sp-b"><b>${esc(c.label)}</b> <span class="hint">· ${plural(c.count, ['репліка', 'репліки', 'реплік'])}</span><div class="hint sp-s">«${esc(c.sample)}»</div></div><input class="sp-in" data-k="${esc(c.key)}" list="sp-names" value="${esc(draft.get(c.key) ?? '')}" placeholder="Ім’я мовця" aria-label="Ім’я мовця для ${esc(c.label)}" ${i === 0 ? '' : ''}></div>`).join('') || '<p class="hint">Нічого не знайдено.</p>';
  };
  dlg.addEventListener('input', e => {
    const t = e.target as HTMLInputElement;
    if (t.classList.contains('sp-in')) draft.set(t.dataset.k!, t.value);
    else if (t.id === 'sp-q') render();
  });
  $('#sp-save', dlg).addEventListener('click', () => {
    const m = map();
    let changed = 0;
    for (const [k, v] of draft) {
      const name = v.trim();
      if (name && m[k]?.name !== name) { m[k] = { name, mt: Date.now() }; changed++; }
      else if (!name && m[k]) { delete m[k]; changed++; }
    }
    if (changed) { ctx.persist(); ctx.render(); }
    toast(changed ? `Мовців оновлено: ${changed}` : 'Змін немає');
  });
  render();
  dlg.showModal();
}
