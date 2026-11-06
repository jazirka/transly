/**
 * Windows of the app (`<dialog>`, the search) are modal in effect, but not through `showModal()`: that puts a layer over the
 * whole page, title bar included, so the window could not be moved, minimised or closed while a dialog is open. Here the app
 * behind is made inert and dimmed by the app's own layer, and the window controls of the title bar stay above it.
 */
const holders = new Set<string>();
const stack: HTMLDialogElement[] = [];
let scrim: HTMLElement | null = null;

const ide = (): HTMLElement | null => document.getElementById('ide');

/** The app behind a window does not react while someone holds it (a dialog, the search); the title bar controls stay usable. */
export function holdInert(who: string, on: boolean): void {
  if (on) holders.add(who); else holders.delete(who);
  const app = ide();
  if (app) app.inert = holders.size > 0;
  document.documentElement.classList.toggle('dlg-open', holders.size > 0);
}

function refresh(): void {
  holdInert('dialog', stack.length > 0);
  stack.forEach((d, i) => { d.inert = i < stack.length - 1; });
  if (stack.length && !scrim) {
    scrim = document.createElement('div');
    scrim.className = 'dlg-scrim';
    scrim.setAttribute('aria-hidden', 'true');
    document.body.appendChild(scrim);
  } else if (!stack.length && scrim) { scrim.remove(); scrim = null; }
}

/** Show a dialog above the app. It closes on Esc, on its own buttons and with `close()`, like a modal one. */
export function showDialog(dlg: HTMLDialogElement): void {
  dlg.dataset.app = '1';
  dlg.setAttribute('aria-modal', 'true');
  // In the capture phase, so the app is live again before the dialog's other `close` handlers give focus back to the opener.
  dlg.addEventListener('close', () => {
    const i = stack.indexOf(dlg);
    if (i >= 0) stack.splice(i, 1);
    refresh();
  }, { once: true, capture: true });
  stack.push(dlg);
  refresh();
  dlg.show();
  // `show()` focuses like `showModal()`, but only when nothing inside asks for it: make sure focus is inside.
  if (!dlg.contains(document.activeElement)) (dlg.querySelector<HTMLElement>('[autofocus],input,select,textarea,button') ?? dlg).focus();
}

/** The topmost dialog that is open, or null. */
export const topDialog = (): HTMLDialogElement | null => stack[stack.length - 1] ?? null;

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

/** The controls of a dialog that can take focus now (not hidden, not disabled). */
const focusables = (dlg: HTMLElement): HTMLElement[] => [...dlg.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(e => e.getClientRects().length > 0 && !e.closest('[inert],[hidden]'));

// Esc closes the topmost dialog (a non-modal dialog is not closed by the browser); Tab stays inside it, as in a modal one.
document.addEventListener('keydown', e => {
  const top = topDialog();
  if (!top || e.isComposing) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    if (top.dispatchEvent(new Event('cancel', { cancelable: true }))) top.close();
  } else if (e.key === 'Tab') {
    const f = focusables(top);
    if (!f.length) { e.preventDefault(); return; }
    const first = f[0]!, last = f[f.length - 1]!, at = document.activeElement;
    if (!top.contains(at)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && at === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && at === last) { e.preventDefault(); first.focus(); }
  }
});
