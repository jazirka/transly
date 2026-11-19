import { sentVariants, tallyOf } from '../core';
import type { Entry, Variant } from '../core';
import { $, esc } from './dom';
import { colorOf } from './discuss';
import type { Ctx } from './state';

/**
 * «Внески» under the field: the translations of the row that were sent, one card for each send of each translator (several from one translator
 * are all there), the newest first. Each can be voted for or against (▲ ▼, the same vote again takes it back), approved (the tick: the translation
 * goes into the row and the row is proofread; the tick of the approved one takes the approval back) and taken off the card (the bin; the one the row
 * holds is not taken off, it is the row's translation). Like the contributions of a string in an online editor.
 */
const when = (t: number): string => new Date(t).toLocaleString('uk-UA', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** The sent translations of the open row, as the card shows them. */
export const variantsOf = (ctx: Ctx, key: string): Variant[] => sentVariants(ctx.s.current ? ctx.entries(ctx.s.current)[key] : undefined);

function cardHtml(ctx: Ctx, e: Entry | undefined, v: Variant, i: number): string {
  const who = v.who || 'Хтось';
  const t = tallyOf(e, v.id, ctx.s.who);
  const vote = (dir: 'up' | 'down', n: number, on: boolean): string => `<button type="button" class="vt ${dir}${on ? ' on' : ''}" data-vv="${dir}" data-vi="${i}" aria-pressed="${on}" title="${dir === 'up' ? 'За цей внесок' : 'Проти цього внеску'}" aria-label="${dir === 'up' ? 'За' : 'Проти'}: ${n}"><span aria-hidden="true">${dir === 'up' ? '▲' : '▼'}</span><b>${n}</b></button>`;
  const done = v.current && v.approved;
  const tick = `<button type="button" class="ck${done ? ' on' : ''}" role="checkbox" aria-checked="${done}" data-vr="${i}" title="${done ? 'Затверджено: зняти затвердження (повернути на доопрацювання)' : 'Затвердити: поставити цей переклад у рядок і вичитати його'}" aria-label="${done ? 'Затверджено' : 'Затвердити'}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3.2 3.2L13 4.8"/></svg></button>`;
  const bin = `<button type="button" class="vd" data-vd="${i}" ${v.current ? 'disabled' : ''} title="${v.current ? 'Це переклад рядка: очистити його можна кошиком біля поля' : 'Прибрати цей внесок з картки'}" aria-label="Прибрати внесок"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5v-1.5h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg></button>`;
  return `<div class="var${v.current ? ' cur' : ''}"><div class="av" style="background:${colorOf(who)}" aria-hidden="true">${esc(Array.from(who)[0] ?? '?')}</div>
    <div class="var-m"><div class="var-h"><b>${esc(who)}</b><span class="when">${v.at ? when(v.at) : ''}</span>${v.current ? `<span class="tg k">${v.approved ? 'вичитано' : 'поточний'}</span>` : ''}</div><div class="var-t">${esc(v.text)}</div></div>
    <div class="var-a">${vote('up', t.up, t.mine === 1)}${vote('down', t.down, t.mine === -1)}${tick}${bin}</div></div>`;
}

/** Fill the card under the field; it is not drawn while nothing has been sent. */
export function renderVariants(ctx: Ctx, key: string | undefined): void {
  const box = $('#f-var'), body = $('#f-var-b');
  const e = key && ctx.s.current ? ctx.entries(ctx.s.current)[key] : undefined;
  const list = sentVariants(e);
  box.hidden = !list.length;
  $('#f-var-n').textContent = String(list.length);
  const html = list.map((v, i) => cardHtml(ctx, e, v, i)).join('');
  if (body.innerHTML !== html) body.innerHTML = html;
}
