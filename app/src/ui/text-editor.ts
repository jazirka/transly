import { esc } from './dom';

/**
 * The translation field: a text area that grows with its text and has a layer underneath it that draws the underlines
 * of glossary terms (the area itself is transparent, the layer repeats its text with the same lines). Words in the layer
 * can be hovered, because the area on top lets the pointer position be looked up in it.
 */

/** Make the area as tall as its text (no scrollbar inside it), but not shorter than its minimum. */
export function autoSize(ta: HTMLTextAreaElement): void {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight + 2}px`;
}

export interface Mark { start: number; end: number; cls: string; data?: Record<string, string> }

/** Fill the layer: the text of the area with `marks` (not overlapping, in order) wrapped in <mark>. */
export function drawMarks(layer: HTMLElement, text: string, marks: Mark[]): void {
  let out = '', at = 0;
  for (const m of marks) {
    if (m.start < at) continue;
    const data = Object.entries(m.data ?? {}).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
    out += esc(text.slice(at, m.start)) + `<mark class="${m.cls}"${data}>${esc(text.slice(m.start, m.end))}</mark>`;
    at = m.end;
  }
  // A text that ends with a line break has an empty last line in the area: the layer needs a character there to be as tall.
  layer.innerHTML = out + esc(text.slice(at)) + '​';
}

/** The mark of the layer under a point of the screen (the area is on top of it, so the point is looked up in the whole stack). */
export function markAt(layer: HTMLElement, x: number, y: number): HTMLElement | null {
  for (const el of document.elementsFromPoint(x, y)) if (el.tagName === 'MARK' && layer.contains(el)) return el as HTMLElement;
  return null;
}

/** Type `text` at the caret (or over the selection) the way the keyboard would: it can be undone with Ctrl+Z. */
export function insertAtCursor(ta: HTMLTextAreaElement, text: string): void {
  ta.focus();
  // a word put in next to a letter would stick to it: it gets a space on that side
  const before = ta.value[ta.selectionStart - 1], after = ta.value[ta.selectionEnd];
  if (/^[\p{L}\p{N}]/u.test(text) && before !== undefined && /[\p{L}\p{N}]/u.test(before)) text = ' ' + text;
  if (/[\p{L}\p{N}]$/u.test(text) && after !== undefined && /[\p{L}\p{N}]/u.test(after)) text += ' ';
  if (!document.execCommand('insertText', false, text)) {
    // The browser would not (an old engine): put it in by hand; the change is still reported.
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
}
