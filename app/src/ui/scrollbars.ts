/**
 * Scrollbars that take no room of their own. A classic scrollbar is a strip beside the content, so a table has a darker gutter at its edge
 * and a list is narrower than its card. Here the browser's bars are hidden (`html.ovsb`, see theme.css) and one thin thumb per axis is drawn
 * over the edge of the area under the pointer: it appears when you point at a scrolling area (or while it scrolls), goes when you leave, and
 * can be dragged. Wheel, touch, keyboard and `scrollTo` still scroll the area itself, so nothing else depends on it.
 */
const SIZE = 6;       // the thickness of the thumb
const EDGE = 4;       // its distance from the edge of the area
const MIN = 28;       // the shortest thumb
const LINGER = 700;   // how long it stays after the area scrolled without the pointer on it

type Axis = 'y' | 'x';

const canScroll = (el: Element, axis: Axis): boolean => {
  if (el.matches('.tabs-host')) return false;   // the strip of file tabs has its own thin thumb on its top edge
  const cs = getComputedStyle(el);
  const overflow = axis === 'y' ? cs.overflowY : cs.overflowX;
  if (overflow !== 'auto' && overflow !== 'scroll') return false;
  return axis === 'y' ? el.scrollHeight - el.clientHeight > 1 : el.scrollWidth - el.clientWidth > 1;
};

/** The nearest scrolling ancestor (or the element itself) that can scroll along `axis`. */
export const scrollerAt = (from: Element | null, axis: Axis): HTMLElement | null => {
  for (let e = from; e && e !== document.documentElement; e = e.parentElement) if (canScroll(e, axis)) return e as HTMLElement;
  return null;
};

/** Where the thumb of `el` goes: its length and offset along the track, as a fraction of the area. */
export const thumbOf = (client: number, scroll: number, at: number, track: number): { len: number; pos: number } => {
  const len = Math.min(track, Math.max(MIN, (track * client) / Math.max(1, scroll)));
  const room = Math.max(0, scroll - client);
  return { len, pos: room > 0 ? ((track - len) * at) / room : 0 };
};

let started = false;
/** Starts drawing the thumbs; call once. Not for touch screens (they scroll with a finger and show their own indicator). */
export function overlayScrollbars(): void {
  if (started || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  started = true;
  const root = document.documentElement;
  root.classList.add('ovsb');
  const bar = {} as Record<Axis, HTMLElement>;
  const area: Record<Axis, HTMLElement | null> = { y: null, x: null };
  for (const axis of ['y', 'x'] as const) {
    const b = document.createElement('div');
    b.className = `ovs ovs-${axis}`;
    b.setAttribute('aria-hidden', 'true');
    document.body.appendChild(b);
    bar[axis] = b;
  }
  let drag: { axis: Axis; from: number; start: number; per: number } | null = null;
  let linger: ReturnType<typeof setTimeout> | null = null;

  const hide = (axis: Axis): void => { area[axis] = null; bar[axis].classList.remove('on'); };
  const place = (axis: Axis): void => {
    const el = area[axis], b = bar[axis];
    if (!el || !el.isConnected) { hide(axis); return; }
    const r = el.getBoundingClientRect();
    const other = area[axis === 'y' ? 'x' : 'y'] === el ? SIZE + EDGE : 0;   // both bars on one area: they stop short of the corner
    const vertical = axis === 'y';
    const track = (vertical ? el.clientHeight : el.clientWidth) - 2 * EDGE - other;
    if (track < MIN) { hide(axis); return; }
    const t = thumbOf(vertical ? el.clientHeight : el.clientWidth, vertical ? el.scrollHeight : el.scrollWidth, vertical ? el.scrollTop : el.scrollLeft, track);
    if (vertical) { b.style.cssText = `left:${r.left + el.clientLeft + el.clientWidth - SIZE - EDGE}px;top:${r.top + el.clientTop + EDGE + t.pos}px;width:${SIZE}px;height:${t.len}px`; }
    else { b.style.cssText = `left:${r.left + el.clientLeft + EDGE + t.pos}px;top:${r.top + el.clientTop + el.clientHeight - SIZE - EDGE}px;width:${t.len}px;height:${SIZE}px`; }
    b.classList.add('on');
  };
  const placeAll = (): void => { place('y'); place('x'); };

  let pending: Element | null = null, queued = false;
  const point = (t: Element): void => {
    for (const axis of ['y', 'x'] as const) {
      const el = scrollerAt(t, axis);
      if (el !== area[axis]) area[axis] = el;
      place(axis);
    }
  };
  document.addEventListener('pointermove', e => {
    if (drag) return;
    const t = e.target as Element | null;
    if (!t || t.closest?.('.ovs')) return;
    if (linger) { clearTimeout(linger); linger = null; }
    pending = t;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; if (pending && !drag) point(pending); });
  }, { capture: true, passive: true });
  root.addEventListener('pointerleave', () => { if (!drag) { hide('y'); hide('x'); } });
  window.addEventListener('blur', () => { hide('y'); hide('x'); });
  window.addEventListener('resize', () => { hide('y'); hide('x'); });
  // an area that scrolls shows its thumb for a moment even when the pointer is elsewhere (the keyboard, the wheel over another part)
  document.addEventListener('scroll', e => {
    const el = e.target;
    if (!(el instanceof HTMLElement)) return;
    if (el === area.y || el === area.x) { placeAll(); return; }
    if (el.getClientRects().length === 0) return;
    for (const axis of ['y', 'x'] as const) if (canScroll(el, axis) && !area[axis]) { area[axis] = el; place(axis); }
    if (linger) clearTimeout(linger);
    linger = setTimeout(() => { if (!drag) { hide('y'); hide('x'); } }, LINGER);
  }, { capture: true, passive: true });
  // the area changes under a standing pointer (a list fills, a panel opens): follow it
  new ResizeObserver(() => { if (!drag) placeAll(); }).observe(document.body);

  for (const axis of ['y', 'x'] as const) {
    const b = bar[axis];
    b.addEventListener('pointerdown', e => {
      const el = area[axis];
      if (!el) return;
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      b.classList.add('drag');
      const vertical = axis === 'y';
      const track = (vertical ? el.clientHeight : el.clientWidth) - 2 * EDGE - (area[vertical ? 'x' : 'y'] === el ? SIZE + EDGE : 0);
      const len = vertical ? b.offsetHeight : b.offsetWidth;
      const room = (vertical ? el.scrollHeight - el.clientHeight : el.scrollWidth - el.clientWidth);
      drag = { axis, from: vertical ? e.clientY : e.clientX, start: vertical ? el.scrollTop : el.scrollLeft, per: room / Math.max(1, track - len) };
    });
    b.addEventListener('pointermove', e => {
      const el = area[axis];
      if (!drag || drag.axis !== axis || !el) return;
      const d = ((axis === 'y' ? e.clientY : e.clientX) - drag.from) * drag.per;
      if (axis === 'y') el.scrollTop = drag.start + d; else el.scrollLeft = drag.start + d;
      place(axis);
    });
    const end = (): void => { if (drag?.axis === axis) { drag = null; b.classList.remove('drag'); } };
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('lostpointercapture', end);
  }
}
