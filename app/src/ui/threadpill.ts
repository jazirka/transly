import { joinAlts, saveTerm, targetHasTerm, targetTermHits, TERM_GENDERS, ukRetarget } from '../core';
import type { GlossaryTerm, TermGender } from '../core';
import { $, esc, toast } from './dom';
import { insertText } from './focus';
import { holdThread } from './links';
import type { Ctx } from './state';
import { usageAll } from './strands-panel';
import { showCard } from './termcard';

/**
 * The pill on the thread of a term: the card that opens when a term of the open row is pointed at (or reached with the keyboard).
 * It hangs on the middle of the dashed thread, so it stands between the word and its place in the translation and covers neither;
 * a term the translation lacks has no thread, so the pill stands under the word. It holds the renderings of the term as chips (a
 * click puts one into the translation, in the case the word stands in), the number of rows the entry is met in, and a small place
 * for what the translator wants to tell the next one: the gender of the word and a comment. The full card is one click away.
 */

const GENDER_NAME: Record<TermGender, string> = { m: 'ч', f: 'ж', n: 'с', p: 'мн' };
const GENDER_TITLE: Record<TermGender, string> = { m: 'чоловічий рід', f: 'жіночий рід', n: 'середній рід', p: 'лише множина' };

let pill: HTMLElement | null = null;
let showTimer = 0, hideTimer = 0;
/** What the pill shows now: the entry, whether the place for the gender and the comment is open, and what is typed there. */
let st: { en: string; open: boolean; gender: TermGender | '' | undefined; note: string | undefined } | null = null;

const pillEl = (): HTMLElement => {
  if (!pill) {
    pill = document.createElement('div');
    pill.id = 'thread-pill';
    pill.className = 'tpill2';
    pill.setAttribute('role', 'dialog');
    pill.setAttribute('aria-label', 'Термін: варіанти, рід і коментар');
    pill.hidden = true;
    document.body.appendChild(pill);
  }
  return pill;
};

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();
const termOf = (ctx: Ctx, en: string): GlossaryTerm | undefined => ctx.s.saved.terms.find(t => same(t.en, en));
const variantsOf = (t: GlossaryTerm): string[] => [t.uk, ...(t.alt ?? [])];
const field = (): HTMLTextAreaElement => $('#i-tr') as HTMLTextAreaElement;

/** The word of the original that belongs to the entry (the pill is always drawn from it, wherever the pointer was). */
const srcWord = (en: string): HTMLElement | null => [...document.querySelectorAll<HTMLElement>('#f-src [data-hc="term"]')].find(e => same(e.dataset.hk ?? '', en)) ?? null;

export function hideThreadPill(): void {
  window.clearTimeout(showTimer); window.clearTimeout(hideTimer);
  if (pill) pill.hidden = true;
  // only a thread this pill held is let go: another one may be lit by a chip that is pointed at
  if (st) holdThread(null);
  st = null;
}

const html = (ctx: Ctx, t: GlossaryTerm, n: string): string => {
  const vs = variantsOf(t), ta = field();
  const use = usageAll(ctx, t);
  const cur = vs.findIndex(v => targetHasTerm(ta.value, v));
  const chips = vs.map((v, i) => {
    const count = use ? (i === 0 ? use.main : i === 1 && vs.length === 2 ? use.alt : 0) : 0;
    return `<button type="button" class="tp-c${i === cur ? ' on' : ''}" data-tp="v" data-i="${i}" title="${i === cur ? 'Так стоїть у перекладі' : 'Поставити замість поточного'}">${esc(v)}${count ? ` <i>${count}</i>` : ''}</button>`;
  }).join('');
  const g = st?.gender === undefined ? t.gender : st.gender || undefined;
  const note = st?.note === undefined ? t.note ?? '' : st.note;
  const total = use ? use.rows.length : 0;
  const tail = `<button type="button" class="tp-m${g || note ? ' set' : ''}" data-tp="more" aria-expanded="${st?.open ? 'true' : 'false'}" title="Рід і коментар">${g ? GENDER_NAME[g] : '—'} · ✎</button><button type="button" class="tp-a" data-tp="all" title="Картка терміна: форми, вживання в грі">${total ? `Усі ${total + 1}` : 'Усі'} ›</button>`;
  const seg = TERM_GENDERS.map(x => `<button type="button" class="${g === x ? 'on' : ''}" data-tp="g" data-v="${x}" title="${GENDER_TITLE[x]}" aria-pressed="${g === x}">${GENDER_NAME[x]}</button>`).join('');
  const ex = `<div class="tp-ex"><div class="tp-g"><span>рід</span><span class="tp-seg">${seg}</span></div><textarea class="tp-note" rows="2" maxlength="400" placeholder="Коментар до терміна: для кого, коли, чому саме так" aria-label="Коментар до терміна">${esc(note)}</textarea><div class="tp-acts"><button type="button" class="btn p" data-tp="save">Зберегти</button><button type="button" class="btn" data-tp="cancel">Скасувати</button></div></div>`;
  return `<div class="tp-row"><b class="tp-n" style="--tc:var(--s${/^\d+$/.test(n) ? (Number(n) - 1) % 6 : 0})">${esc(n)}</b>${chips}<span class="tp-gap"></span>${tail}</div>${st?.open ? ex : ''}`;
};

/** Where the pill goes: on the middle of the thread when there is one, otherwise under the word. */
function place(el: HTMLElement, en: string): void {
  const p = pillEl(), row = p.querySelector<HTMLElement>('.tp-row');
  const path = [...document.querySelectorAll<SVGPathElement>('#te-links path.lk-p')].find(x => (x.dataset.link ?? '') === `term${en}`);
  const host = document.getElementById('te-links');
  const w = p.offsetWidth, rowH = row?.offsetHeight ?? 30;
  let cx: number, cy: number;
  if (path && host) {
    const b = host.getBoundingClientRect(), pt = path.getPointAtLength(path.getTotalLength() / 2);
    cx = b.left + pt.x; cy = b.top + pt.y;
  } else { const r = el.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.bottom + 8 + rowH / 2; }
  p.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, cx - w / 2))}px`;
  p.style.top = `${Math.max(8, Math.min(window.innerHeight - p.offsetHeight - 8, cy - rowH / 2))}px`;
}

function show(ctx: Ctx, el: HTMLElement, keepOpen = false): void {
  const en = el.dataset.hk ?? '', t = termOf(ctx, en);
  if (!t || !ctx.s.cur || ctx.s.mode !== 'edit') return;
  if (!keepOpen || st?.en !== t.en) st = { en: t.en, open: keepOpen && st?.en === t.en ? st.open : false, gender: undefined, note: undefined };
  const p = pillEl();
  const n = srcWord(t.en)?.dataset.tn ?? el.dataset.tn ?? '';
  p.innerHTML = html(ctx, t, n);
  p.hidden = false;
  holdThread(t.en);
  place(srcWord(t.en) ?? el, t.en);
}

/** Put a rendering of the term into the translation: in the place of the one that stands there (in its case), or at the end when the translation lacks the term. */
function choose(ctx: Ctx, t: GlossaryTerm, i: number): void {
  const vs = variantsOf(t), v = vs[i];
  if (v === undefined) return;
  const ta = field(), hit = targetTermHits(ta.value, [t])[0];
  if (!hit || (hit.parts && hit.parts.length > 1)) { insertText(ctx, v); return; }
  const observed = ta.value.slice(hit.start, hit.end);
  const was = vs.findIndex(x => targetHasTerm(observed, x));
  if (was === i) return;
  const before = ta.value.slice(0, hit.start).match(/(\p{L}+)\s+$/u)?.[1];
  let text = v;
  if (was >= 0) { const r = ukRetarget(vs[was]!, v, observed, before ? { prev: before } : {}); if (r) text = r.text; }
  if (/^\p{Lu}/u.test(observed) && !/^\p{Lu}/u.test(text)) text = text.charAt(0).toUpperCase() + text.slice(1);
  ta.focus();
  ta.setSelectionRange(hit.start, hit.end);
  if (!document.execCommand('insertText', false, text)) {
    ta.setRangeText(text, hit.start, hit.end, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}

export function wireThreadPill(ctx: Ctx): void {
  const plan = (el: HTMLElement, delay: number): void => {
    window.clearTimeout(showTimer); window.clearTimeout(hideTimer);
    if (st && same(st.en, el.dataset.hk ?? '') && pill && !pill.hidden) return;
    showTimer = window.setTimeout(() => show(ctx, el), delay);
  };
  const leave = (): void => {
    window.clearTimeout(showTimer); window.clearTimeout(hideTimer);
    // while the place for the gender and the comment is open the pill stays: it is being written in
    if (st?.open) return;
    hideTimer = window.setTimeout(hideThreadPill, 260);
  };
  const termOfEl = (e: EventTarget | null): HTMLElement | null => {
    const el = (e as Element | null)?.closest?.<HTMLElement>('[data-hc="term"]') ?? null;
    return el && el.dataset.hk && el.closest('#f-src') ? el : null;
  };

  document.addEventListener('mouseover', e => { const w = termOfEl(e.target); if (w) plan(w, 200); });
  document.addEventListener('mouseout', e => { if (termOfEl(e.target) && !(e.relatedTarget as Element | null)?.closest('#thread-pill')) leave(); });
  document.addEventListener('focusin', e => { const w = termOfEl(e.target); if (w) plan(w, 0); });

  // the words of the translation: the layer is under the field, so the pointer position is looked up in the layer
  const ta = field(), layer = $('#te-layer');
  let last: HTMLElement | null = null;
  ta.addEventListener('mousemove', e => {
    let hit: HTMLElement | null = null;
    for (const el of document.elementsFromPoint(e.clientX, e.clientY)) if (el.tagName === 'MARK' && layer.contains(el) && (el as HTMLElement).dataset.hc === 'term') { hit = el as HTMLElement; break; }
    if (hit) { last = hit; ta.style.cursor = 'help'; const s = srcWord(hit.dataset.hk ?? ''); if (s) plan(s, 260); }
    else if (last) { last = null; ta.style.cursor = ''; leave(); }
  });
  ta.addEventListener('mouseleave', () => { last = null; ta.style.cursor = ''; leave(); });

  const p = pillEl();
  p.addEventListener('mouseenter', () => { window.clearTimeout(hideTimer); if (st) holdThread(st.en); });
  p.addEventListener('mouseleave', leave);
  p.addEventListener('input', e => { if (st && (e.target as Element).classList.contains('tp-note')) st.note = (e.target as HTMLTextAreaElement).value; });
  p.addEventListener('click', e => {
    const b = (e.target as Element).closest<HTMLElement>('[data-tp]');
    if (!b || !st) return;
    const t = termOf(ctx, st.en);
    if (!t) { hideThreadPill(); return; }
    const redraw = (): void => { const s = srcWord(t.en); if (s) show(ctx, s, true); };
    switch (b.dataset.tp) {
      case 'v': choose(ctx, t, Number(b.dataset.i)); window.setTimeout(redraw, 60); break;
      case 'more': st.open = !st.open; redraw(); if (st.open) p.querySelector<HTMLElement>('.tp-note')?.focus(); break;
      case 'g': st.gender = st.gender === b.dataset.v || (st.gender === undefined && t.gender === b.dataset.v) ? '' : (b.dataset.v as TermGender); redraw(); break;
      case 'save': {
        const gender = st.gender === undefined ? undefined : st.gender;
        const r = saveTerm(ctx.s.saved, { en: t.en, uk: t.uk, alt: joinAlts(t.alt), ...(t.qa === false ? { qa: false } : {}), ...(gender === undefined ? {} : { gender }), ...(st.note === undefined ? {} : { note: st.note }) }, Date.now(), t.en);
        if (r === 'changed') { ctx.persist(); ctx.invalidateTm(); toast(`«${t.en}»: рід і коментар збережено`); }
        const s = srcWord(t.en); st = { en: t.en, open: false, gender: undefined, note: undefined };
        if (s) show(ctx, s, true);
        break;
      }
      case 'cancel': st = { en: t.en, open: false, gender: undefined, note: undefined }; redraw(); break;
      case 'all': { const s = srcWord(t.en); hideThreadPill(); if (s) showCard(ctx, s, 'term', t.en); break; }
      default: break;
    }
  });
  document.addEventListener('click', e => {
    if (!pill || pill.hidden || (e.target as Element).closest('#thread-pill')) return;
    // a click on a word of the original puts the term into the translation (its own job): the pill goes either way
    hideThreadPill();
  }, true);
  document.addEventListener('keydown', e => {
    if (!pill || pill.hidden) {
      // Enter on a term of the original opens the pill with the place for the gender and the comment
      if ((e.key === 'Enter' || e.key === ' ') && termOfEl(e.target) && (e.target as HTMLElement).tagName !== 'BUTTON') { e.preventDefault(); const w = termOfEl(e.target)!; show(ctx, w); if (st) { st.open = true; show(ctx, w, true); pillEl().querySelector<HTMLElement>('.tp-note')?.focus(); } }
      return;
    }
    if (e.key === 'Escape') { const en = st?.en; hideThreadPill(); e.stopPropagation(); if (en) srcWord(en)?.focus(); }
  }, true);
  window.addEventListener('scroll', () => { if (!st?.open) hideThreadPill(); }, true);
}
