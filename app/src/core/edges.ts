/**
 * The edges of a text: the spaces, tabs and line breaks before and after it. In a message they are the translator's own business, but in a name,
 * a term, a menu command or a plugin text the game glues the string to a picture or to another text, and the padding of the original (« Continue»
 * with a space before it) is what puts it in its place on the screen.
 */
const LEAD = /^[ \t\n ]*/, TAIL = /[ \t\n ]*$/;

export const edgesOf = (text: string): { lead: string; tail: string } => ({ lead: LEAD.exec(text)![0], tail: TAIL.exec(text)![0] });

/** The translation with the edges of the original. A translation that is only blank, or an original that is, is left as it is. */
export function withEdges(source: string, target: string): string {
  if (!target.trim() || !source.trim()) return target;
  const s = edgesOf(source), t = edgesOf(target);
  if (s.lead === t.lead && s.tail === t.tail) return target;
  return s.lead + target.slice(t.lead.length, target.length - t.tail.length) + s.tail;
}
