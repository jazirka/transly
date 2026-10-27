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

/** Short non-blocking message at the bottom of the window. */
export function toast(text: string): void {
  const t = el('div', 'toast');
  t.setAttribute('role', 'status');
  t.textContent = text;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}
