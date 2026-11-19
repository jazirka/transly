import { sentVariants } from '../core';
import type { Variant } from '../core';
import { $, esc } from './dom';
import { colorOf } from './discuss';
import type { Ctx } from './state';

/**
 * «Переклади» under the field: the translations of the row that were sent, one card for each send of each translator (several from one translator
 * are all there), the newest first; the button puts a translation into the field. Like the list of translations of a string in an online editor.
 */
const when = (t: number): string => new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** The sent translations of the open row, as the card shows them. */
export const variantsOf = (ctx: Ctx, key: string): Variant[] => sentVariants(ctx.s.current ? ctx.entries(ctx.s.current)[key] : undefined);

function cardHtml(v: Variant, i: number, field: string): string {
  const who = v.who || 'Хтось';
  const same = v.text === field;
  return `<div class="var${v.current ? ' cur' : ''}"><div class="av" style="background:${colorOf(who)}" aria-hidden="true">${esc(Array.from(who)[0] ?? '?')}</div>
    <div class="var-m"><div class="var-h"><b>${esc(who)}</b><span class="when">${v.at ? when(v.at) : ''}</span>${v.current ? `<span class="tg k">${v.approved ? 'вичитано' : 'поточний'}</span>` : ''}</div><div class="var-t">${esc(v.text)}</div></div>
    <button type="button" class="btn" data-vr="${i}" title="Підставити цей переклад у поле" ${same ? 'disabled' : ''}>${same ? 'У полі' : 'Підставити'}</button></div>`;
}

/** Fill the card under the field; it is not drawn while nothing has been sent. `field` is what the field holds now (the button of that translation says so). */
export function renderVariants(ctx: Ctx, key: string | undefined, field: string): void {
  const box = $('#f-var'), body = $('#f-var-b');
  const list = key ? variantsOf(ctx, key) : [];
  box.hidden = !list.length;
  $('#f-var-n').textContent = String(list.length);
  const html = list.map((v, i) => cardHtml(v, i, field)).join('');
  if (body.innerHTML !== html) body.innerHTML = html;
}
