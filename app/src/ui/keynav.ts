/**
 * Keyboard for the pieces that are not plain forms: menus and popovers (↑/↓, Home/End, Enter), the file tree (one tab
 * stop, arrows, → and ← fold folders) and the return of the focus to the control that opened something.
 */

const MENU_ITEM = '[role="menuitem"],[role="menuitemradio"],[role="menuitemcheckbox"],button,a[href],input,select,textarea';
const TEXT = 'input:not([type=button]):not([type=checkbox]):not([type=radio]),textarea';

const usable = (e: HTMLElement): boolean => !e.hasAttribute('disabled') && e.getAttribute('aria-disabled') !== 'true' && !e.closest('[hidden]') && e.getClientRects().length > 0;

/** The items of an open menu or popover that can take the focus now. */
export const itemsOf = (root: HTMLElement, sel: string = MENU_ITEM): HTMLElement[] => [...root.querySelectorAll<HTMLElement>(sel)].filter(usable);

/** Put the focus on the first item of a menu that has just opened, so the keyboard can carry on from there. */
export function focusFirst(root: HTMLElement, sel?: string): void { itemsOf(root, sel)[0]?.focus({ preventScroll: true }); }

/** The control that had the focus before a popover opened, so Esc can give it back. */
let opener: HTMLElement | null = null;
export function rememberOpener(el?: Element | null): void { const a = el ?? document.activeElement; opener = a instanceof HTMLElement && a !== document.body ? a : null; }
/** Give the focus back to the control that opened the popover (when it is still on the page). */
export function restoreOpener(): void { const o = opener; opener = null; if (o && o.isConnected && usable(o)) o.focus({ preventScroll: true }); }

/** ↑/↓ and Home/End walk the items of a menu or a popover; Enter and Space press an item that is not a real button. True when the key was used. */
export function menuKeys(e: KeyboardEvent, root: HTMLElement): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target as HTMLElement;
  const items = itemsOf(root);
  const here = items.indexOf(t.closest<HTMLElement>(MENU_ITEM) ?? t);
  const go = (i: number): boolean => { const n = items[(i + items.length) % items.length]; if (!n) return false; e.preventDefault(); n.focus({ preventScroll: true }); return true; };
  switch (e.key) {
    case 'ArrowDown': return go(here + 1);
    case 'ArrowUp': return go(here < 0 ? items.length - 1 : here - 1);
    case 'Home': return t.matches(TEXT) ? false : go(0);
    case 'End': return t.matches(TEXT) ? false : go(items.length - 1);
    case 'Enter':
    case ' ': {
      const it = t.closest<HTMLElement>('[role^="menuitem"]');
      if (it && it.tagName !== 'BUTTON' && it.tagName !== 'A') { e.preventDefault(); it.click(); return true; }
      return false;
    }
    default: return false;
  }
}

/** Depth of a tree node (the `--d` the renderer writes). */
const depth = (n: HTMLElement): number => Number(n.style.getPropertyValue('--d')) || 0;

/** Make one node of the tree the only tab stop; the arrows reach the others. */
export function roveTree(tree: HTMLElement, active?: HTMLElement | null): void {
  const nodes = [...tree.querySelectorAll<HTMLElement>('.node')];
  const on = active && nodes.includes(active) ? active : tree.querySelector<HTMLElement>('.node.cur') ?? nodes[0];
  for (const n of nodes) n.tabIndex = n === on ? 0 : -1;
}

/**
 * The file tree: ↑/↓/Home/End walk the nodes, → opens a folder (or steps into it), ← closes it (or goes up to it),
 * Enter opens a file, Space ticks it like Ctrl+click does. True when the key was used.
 */
export function treeKeys(e: KeyboardEvent, tree: HTMLElement): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const cur = (e.target as HTMLElement).closest<HTMLElement>('.node');
  if (!cur || !tree.contains(cur)) return false;
  const nodes = [...tree.querySelectorAll<HTMLElement>('.node')];
  const i = nodes.indexOf(cur);
  const focus = (n: HTMLElement | undefined): boolean => { if (!n) return true; e.preventDefault(); roveTree(tree, n); n.focus(); return true; };
  const dir = cur.classList.contains('dir');
  const open = cur.getAttribute('aria-expanded') === 'true';
  switch (e.key) {
    case 'ArrowDown': return focus(nodes[i + 1]);
    case 'ArrowUp': return focus(nodes[i - 1]);
    case 'Home': return focus(nodes[0]);
    case 'End': return focus(nodes[nodes.length - 1]);
    case 'ArrowRight':
      if (dir && !open) { e.preventDefault(); cur.click(); return true; }
      return focus(dir && open ? nodes[i + 1] : undefined);
    case 'ArrowLeft': {
      if (dir && open) { e.preventDefault(); cur.click(); return true; }
      const up = [...nodes.slice(0, i)].reverse().find(n => n.classList.contains('dir') && depth(n) < depth(cur));
      return focus(up);
    }
    case 'Enter': e.preventDefault(); cur.click(); return true;
    case ' ':
      e.preventDefault();
      if (dir) cur.click(); else cur.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      return true;
    default: return false;
  }
}

/**
 * Switch a control off without taking it out of the keyboard's reach: `aria-disabled` keeps it focusable, the title says
 * why, and a click on it shows the reason (see the click handler of the app).
 */
export function setUnavailable(el: HTMLElement, off: boolean, why: string, title?: string): void {
  el.setAttribute('aria-disabled', String(off));
  if (off) { el.dataset.why = why; el.title = why; } else { delete el.dataset.why; if (title !== undefined) el.title = title; }
}
