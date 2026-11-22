/**
 * Own tooltips instead of the system ones. Every element that has a `title` gets one: while the pointer (or the keyboard focus) is on it the `title` is
 * taken off, so the system does not draw its own, and put back when it leaves, so the screen reader, the language layer and every other piece of code
 * still find the text where it always was. The tip shows after a short wait, stays inside the window, flips above when there is no room below, and never
 * takes the pointer (a tip is not something to click).
 */
const DELAY = 450, GAP = 8;
let tip: HTMLDivElement | null = null;
let cur: HTMLElement | null = null;
let held = '';
let timer = 0;

function box(): HTMLDivElement {
  if (tip) return tip;
  tip = document.createElement('div');
  tip.className = 'tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true;
  document.body.appendChild(tip);
  return tip;
}

function place(el: HTMLElement): void {
  const t = box(), r = el.getBoundingClientRect();
  t.style.left = '0px'; t.style.top = '0px'; t.hidden = false;
  const w = t.offsetWidth, h = t.offsetHeight;
  const x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8);
  const below = r.bottom + GAP + h <= innerHeight - 4;
  t.style.left = `${Math.round(x)}px`;
  t.style.top = `${Math.round(below ? r.bottom + GAP : Math.max(4, r.top - GAP - h))}px`;
}

function hide(): void {
  clearTimeout(timer);
  if (tip) tip.hidden = true;
  if (cur && held && !cur.hasAttribute('title')) cur.setAttribute('title', held);
  cur = null; held = '';
}

function show(el: HTMLElement): void {
  if (cur === el) return;
  hide();
  const text = el.getAttribute('title');
  if (!text?.trim()) return;
  cur = el; held = text;
  el.removeAttribute('title');
  clearTimeout(timer);
  timer = window.setTimeout(() => { if (cur !== el || !el.isConnected) return; box().textContent = held; place(el); }, DELAY);
}

export function initTooltips(): void {
  document.addEventListener('mouseover', e => { const el = (e.target as Element | null)?.closest<HTMLElement>('[title]'); if (el) show(el); });
  document.addEventListener('mouseout', e => { if (cur && !cur.contains(e.relatedTarget as Node | null)) hide(); });
  document.addEventListener('focusin', e => { const t = e.target as HTMLElement; if (t.matches?.(':focus-visible')) { const el = t.closest<HTMLElement>('[title]'); if (el) show(el); } });
  document.addEventListener('focusout', () => hide());
  // a click, a key or a scroll ends the wait: the tip must not hang over what the user is doing
  for (const ev of ['mousedown', 'keydown', 'wheel', 'scroll', 'dragstart'] as const) document.addEventListener(ev, () => hide(), { capture: true, passive: true });
  window.addEventListener('blur', hide);
}
