import { i18n } from '../core';

/**
 * Puts the language of the interface on the screen. The program draws its Ukrainian text as it always did; this layer, while another language is
 * chosen, replaces every text that has a translation in the catalog (and keeps the original beside it, so the language can be changed back and forth
 * without drawing anything again). It looks at the page once, and then at what changes in it.
 *
 * What is the game or the translator's own text is never touched: a row of the table, the editor, the list of rows, the scenes. A line of a game
 * that happens to read like a button («Так», «Скасувати») must stay what it is.
 */

/** Everything inside these is content, not interface. */
const SKIP = '[translate="no"],[data-i18n="off"],textarea,input,select,script,style,pre,code,kbd,.gr,.cell-ed,#slist .si,#sc-list .sc-item,#tree-list .node,.sv-line,.sv-in,#f-src,#f-tr,.ebox,.tgrow,.sd-res .sd-it,.var,.tmrow,.cm-body,.hx-text,.pj-card b,#proj-name,#br-name,.nm,.pc';
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'] as const;

interface Rec { src: string; out: string }
const texts = new WeakMap<Text, Rec>();
const attrs = new WeakMap<Element, Map<string, Rec>>();
let observer: MutationObserver | null = null;
let pending = new Set<Node>();
let queued = false;

const inSkipped = (el: Element | null): boolean => !el || !!el.closest(SKIP);

function doText(n: Text): void {
  if (inSkipped(n.parentElement)) return;
  const rec = texts.get(n);
  const src = rec && n.data === rec.out ? rec.src : n.data;
  const trimmed = src.trim();
  const tr = trimmed ? i18n.translateText(trimmed.replace(/\s+/g, ' ')) : null;
  if (tr === null) { if (rec) texts.delete(n); if (rec && n.data !== src) n.data = src; return; }
  const out = src.replace(trimmed, tr);
  texts.set(n, { src, out });
  if (n.data !== out) n.data = out;
}

function doAttrs(el: Element): void {
  if (inSkipped(el)) return;
  let m = attrs.get(el);
  for (const a of ATTRS) {
    const cur = el.getAttribute(a);
    if (cur === null) continue;
    const rec = m?.get(a);
    const src = rec && cur === rec.out ? rec.src : cur;
    const tr = src.trim() ? i18n.translateText(src.trim().replace(/\s+/g, ' ')) : null;
    if (tr === null) { if (rec) { m!.delete(a); if (cur !== src) el.setAttribute(a, src); } continue; }
    if (!m) { m = new Map(); attrs.set(el, m); }
    m.set(a, { src, out: tr });
    if (cur !== tr) el.setAttribute(a, tr);
  }
}

function walk(root: Node): void {
  if (root.nodeType === 3) { doText(root as Text); return; }
  if (root.nodeType !== 1) return;
  if (inSkipped(root as Element)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: n => (n.nodeType === 1 && (n as Element).matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
  doAttrs(root as Element);
  for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) doText(n as Text); else doAttrs(n as Element); }
}

function flush(): void {
  queued = false;
  const batch = pending; pending = new Set();
  for (const n of batch) if (n.isConnected) walk(n);
}
function later(n: Node): void {
  pending.add(n);
  if (!queued) { queued = true; queueMicrotask(flush); }
}

const OPTS: MutationObserverInit = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: [...ATTRS] };

/** The language changed: draw the page in it (or put the originals back), and watch the page while a language other than the source is on. */
export function applyLanguage(): void {
  const on = i18n.language !== i18n.source;
  document.documentElement.lang = i18n.language;
  observer?.disconnect();
  walk(document.body);
  if (!on) { observer = null; return; }
  observer ??= new MutationObserver(list => { for (const m of list) later(m.type === 'childList' ? m.target : m.target); });
  observer.observe(document.body, OPTS);
}

let started = false;
/** Start following the language of the interface (call once, after the page exists). */
export function startDomTranslation(): void {
  if (started) return;
  started = true;
  i18n.onChange(() => applyLanguage());
  applyLanguage();
}
