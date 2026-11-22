/**
 * Selecting rows of a table by holding the mouse down on the number column and dragging over them: the rows between the one the press
 * began on and the one under the pointer are selected, and the table scrolls by itself while the pointer stays near its top or bottom edge
 * (the nearer the edge, the faster). Ctrl/⌘ adds to what is selected, Shift extends from the last row; a press without a move toggles the row.
 */
export interface DragSelect {
  /** The element that scrolls the rows. */
  scroller: () => HTMLElement | null;
  /** The press must begin on one of these (the number cell of a row). */
  handle: string;
  /** A row, and the key it stands for. */
  row: string;
  keyOf: (row: HTMLElement) => string | undefined;
  /** The keys of the rows in the order of the table (all of them, drawn or not). */
  order: () => string[];
  get: () => Set<string>;
  set: (keys: Set<string>) => void;
}

export function wireDragSelect(o: DragSelect): void {
  let drag: { anchor: number; base: Set<string>; x: number; y: number; moved: boolean; startKey: string; startY: number } | null = null;
  let timer = 0, dir = 0, speed = 0, last = -1;

  const rowAt = (x: number, y: number): number => {
    const sc = o.scroller();
    if (!sc) return -1;
    const order = o.order(), box = sc.getBoundingClientRect();
    if (y < box.top + 30) { const first = [...sc.querySelectorAll<HTMLElement>(o.row)].find(r => r.getBoundingClientRect().bottom > box.top + 30); const k = first && o.keyOf(first); return k ? order.indexOf(k) : 0; }
    for (const el of document.elementsFromPoint(x, Math.min(y, box.bottom - 2))) { const r = (el as HTMLElement).closest?.<HTMLElement>(o.row); const k = r && o.keyOf(r); if (k) return order.indexOf(k); }
    return y > box.bottom ? order.length - 1 : -1;
  };
  const select = (): void => {
    if (!drag) return;
    const order = o.order(), at = rowAt(drag.x, drag.y);
    if (at < 0 || drag.anchor < 0) return;
    last = at;
    const next = new Set(drag.base);
    for (let i = Math.min(drag.anchor, at); i <= Math.max(drag.anchor, at); i++) { const k = order[i]; if (k) next.add(k); }
    o.set(next);
  };
  const stop = (): void => { if (timer) { window.clearInterval(timer); timer = 0; } dir = 0; };
  const auto = (): void => {
    const sc = o.scroller();
    if (!drag || !sc) return;
    const box = sc.getBoundingClientRect(), zone = 48;
    const d = drag.y > box.bottom - zone ? 1 : drag.y < box.top + zone ? -1 : 0;
    speed = d > 0 ? Math.min(1, (drag.y - (box.bottom - zone)) / zone) : d < 0 ? Math.min(1, (box.top + zone - drag.y) / zone) : 0;
    if (d === dir) return;
    stop(); dir = d;
    if (d) timer = window.setInterval(() => { sc.scrollTop += dir * (6 + 30 * speed); select(); }, 30);
  };

  document.addEventListener('mousedown', e => {
    const t = e.target as HTMLElement;
    const h = t.closest<HTMLElement>(o.handle);
    if (!h || e.button !== 0 || t.closest('input, button, textarea')) return;
    const row = h.closest<HTMLElement>(o.row), key = row && o.keyOf(row);
    if (!key) return;
    const order = o.order(), here = order.indexOf(key), cur = o.get();
    const anchor = e.shiftKey && last >= 0 ? last : here;
    drag = { anchor, base: e.ctrlKey || e.metaKey || e.shiftKey ? new Set(cur) : new Set(), x: e.clientX, y: e.clientY, moved: false, startKey: key, startY: e.clientY };
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!drag) return;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.moved && Math.abs(e.clientY - drag.startY) < 4) return;
    drag.moved = true;
    select(); auto();
  });
  document.addEventListener('mouseup', () => {
    if (!drag) return;
    const d = drag; drag = null; stop();
    if (!d.moved) {
      const next = new Set(o.get());
      if (next.has(d.startKey)) next.delete(d.startKey); else next.add(d.startKey);
      last = o.order().indexOf(d.startKey);
      o.set(next);
    }
  });
}
