export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T => {
  const e = root.querySelector<T>(sel);
  if (!e) throw new Error(`Missing element: ${sel}`);
  return e;
};

/**
 * A short message at the bottom of the window. The same text twice makes one message with a counter (×2), not two;
 * no more than two stay at once; `sticky` (errors) stays until closed so the reason cannot be missed; `action` adds a
 * button (an «undo», say) and keeps the message a little longer.
 */
export function toast(text: string, opts: { sticky?: boolean; action?: { label: string; run: () => void } } = {}): void {
  let host = document.getElementById('toasts');
  if (!host) { host = el('div', 'toasts'); host.id = 'toasts'; host.setAttribute('role', 'status'); document.body.appendChild(host); }
  host.querySelectorAll('.toast.err').forEach(x => x.remove());
  const leave = (n: HTMLElement): void => {
    window.clearTimeout(Number(n.dataset.timer)); n.classList.add('out');
    // the keyboard user who was on the message goes back to where they were, not to the top of the page
    if (n.contains(document.activeElement)) { const back = toastReturn.get(n); if (back?.isConnected) back.focus({ preventScroll: true }); }
    setTimeout(() => n.remove(), 220);
  };
  host.setAttribute('role', opts.sticky || host.querySelector('.toast.err') ? 'alert' : 'status');
  const life = opts.action ? 7000 : 3500;
  if (!opts.sticky && !opts.action) {
    const same = [...host.querySelectorAll<HTMLElement>('.toast:not(.err):not(.out)')].find(x => x.dataset.text === text);
    if (same) {
      const n = Number(same.dataset.n ?? '1') + 1;
      same.dataset.n = String(n);
      const msg = same.querySelector('.tmsg');
      if (msg) msg.textContent = `${text} ×${n}`;
      window.clearTimeout(Number(same.dataset.timer));
      same.dataset.timer = String(window.setTimeout(() => leave(same), life));
      return;
    }
  }
  const t = el('div', opts.sticky ? 'toast err' : 'toast');
  t.dataset.text = text;
  const msg = el('span', 'tmsg'); msg.textContent = text; t.appendChild(msg);
  if (opts.action) {
    const b = el('button'); b.type = 'button'; b.textContent = opts.action.label;
    b.addEventListener('click', () => { leave(t); opts.action!.run(); });
    t.appendChild(b);
  }
  if (opts.sticky) {
    const x = el('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Закрити повідомлення');
    x.addEventListener('click', () => leave(t));
    t.appendChild(x);
  }
  host.appendChild(t);
  // Two at most: the oldest goes.
  const live = [...host.querySelectorAll<HTMLElement>('.toast:not(.err):not(.out)')];
  while (live.length > 2) leave(live.shift()!);
  if (!opts.sticky) {
    t.dataset.timer = String(window.setTimeout(() => leave(t), life));
    // A message that is being read (the pointer is on it or the keyboard is in it) does not go away under the reader.
    const hold = (): void => window.clearTimeout(Number(t.dataset.timer));
    const resume = (): void => { if (!t.matches(':hover, :focus-within')) t.dataset.timer = String(window.setTimeout(() => leave(t), life)); };
    t.addEventListener('mouseenter', hold); t.addEventListener('mouseleave', resume);
    t.addEventListener('focusin', e => { const from = (e as FocusEvent).relatedTarget; if (from instanceof HTMLElement && !t.contains(from)) toastReturn.set(t, from); hold(); });
    t.addEventListener('focusout', () => setTimeout(resume, 0));
  }
}
/** Where the focus came from when it went into a message. */
const toastReturn = new WeakMap<HTMLElement, HTMLElement>();

/** Ukrainian plural: plural(5, ['рядок','рядки','рядків']) -> «5 рядків». */
export { plural } from '../core/plural';

/** A short vibration for deliberate actions; silently nothing where the device or the WebView has none. */
export const buzz = (ms = 12): void => { try { navigator.vibrate?.(ms); } catch { /* no vibrator */ } };
