/**
 * «The window you work in», the way tool windows work in an IDE: the last panel you clicked or moved the focus into is the working one
 * (`html[data-pane="left|centre|right"]`), and the choices in it wear the colour of the project, in the others they are grey (see states.css).
 * A dialog or the loss of focus of the whole app lights nothing; the top bar, menus and popovers do not change the working window.
 */

const PANES: [string, string][] = [['left', '#lpanel, #strip'], ['centre', '#main'], ['right', '.fs']];
const MODAL = 'dialog, [role="dialog"], .sd-wrap';
const OVERLAY = '.pop, #mdd, .cfgpop, .menu, .toast, #toasts';

/** The pane an event happened in: its name, '' for a dialog (nothing is lit), or null for anything that must not change the working window. */
export function paneOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  if (target.closest(MODAL)) return '';
  if (target.closest(OVERLAY)) return null;
  for (const [name, selector] of PANES) if (target.closest(selector)) return name;
  return null;
}

let started = false;
/** Starts following the working window; call once. The centre is the working window until the first click. */
export function trackActivePane(root: HTMLElement = document.documentElement): void {
  if (started) return;
  started = true;
  let last = 'centre';
  const set = (name: string): void => { if (root.dataset.pane !== name) root.dataset.pane = name; };
  const seen = (e: Event): void => {
    const name = paneOf(e.target);
    if (name === null) return;
    if (name) last = name;
    set(name);
  };
  document.addEventListener('pointerdown', seen, true);
  document.addEventListener('focusin', seen, true);
  window.addEventListener('blur', () => set(''));
  window.addEventListener('focus', () => set(last));
  set(last);
}
