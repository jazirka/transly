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

/** Short non-blocking message at the bottom of the window; several stack instead of overlapping. */
/** A short confirmation; `sticky` (errors) stays until closed, so the reason cannot be missed. */
export function toast(text: string, opts: { sticky?: boolean } = {}): void {
  let host = document.getElementById('toasts');
  if (!host) { host = el('div', 'toasts'); host.id = 'toasts'; host.setAttribute('role', 'status'); document.body.appendChild(host); }
  host.querySelectorAll('.toast.err').forEach(x => x.remove());
  const leave = (n: HTMLElement): void => { n.classList.add('out'); setTimeout(() => n.remove(), 220); };
  const t = el('div', opts.sticky ? 'toast err' : 'toast');
  t.textContent = text;
  if (opts.sticky) {
    host.setAttribute('role', 'alert');
    const x = el('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Закрити повідомлення');
    x.addEventListener('click', () => leave(t));
    t.appendChild(x);
  }
  host.appendChild(t);
  if (!opts.sticky) setTimeout(() => leave(t), 3500);
}

/** Ukrainian plural: plural(5, ['рядок','рядки','рядків']) -> «5 рядків». */
export function plural(n: number, forms: [string, string, string]): string {
  const m10 = n % 10, m100 = n % 100;
  const f = m10 === 1 && m100 !== 11 ? forms[0] : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? forms[1] : forms[2];
  return `${n} ${f}`;
}

/** A short vibration for deliberate actions; silently nothing where the device or the WebView has none. */
export const buzz = (ms = 12): void => { try { navigator.vibrate?.(ms); } catch { /* no vibrator */ } };
