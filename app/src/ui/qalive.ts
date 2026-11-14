import { activeIssues } from '../core';
import type { Entry, Unit } from '../core';
import type { Ctx } from './state';

/**
 * What the translator hears while typing: the remarks of the QA rules appear on the screen next to the field, but a screen reader
 * says nothing about them. When the typing pauses, the first error (or the number of pieces of advice) is put into a polite live
 * region that the field points to (`aria-describedby`), and the field says whether it holds an error (`aria-invalid`).
 */
let timer = 0;
let last = '';

export function announceQa(ctx: Ctx, ta: HTMLTextAreaElement, u: Unit, e: Entry | undefined): void {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    const live = document.getElementById('qa-live');
    if (!live || !ta.isConnected) return;
    const iss = e?.target ? activeIssues(u, e, ctx.qaOpts()) : [];
    const errors = iss.filter(i => i.severity === 'bad');
    ta.setAttribute('aria-describedby', 'qa-live');
    ta.setAttribute('aria-invalid', errors.length ? 'true' : 'false');
    const text = errors.length
      ? `Помилка QA: ${errors[0]!.message}${errors.length > 1 ? `. Ще помилок: ${errors.length - 1}` : ''}`
      : iss.length ? `Порад QA: ${iss.length}. ${iss[0]!.message}` : '';
    // the same sentence is not said twice in a row, and a cleared one is said as nothing
    if (text === last) return;
    last = text;
    live.textContent = text;
  }, 900);
}
