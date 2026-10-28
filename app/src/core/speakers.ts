import type { Unit } from './model';
import type { FileView } from './project';

export type SpeakerMap = Record<string, { name: string; mt: number }> | undefined;

/**
 * Some games print the speaker's name as the first line of the message, with the first letter drawn as an icon:
 * `\>\i[73]\}ANITOR\{\<` shows "JANITOR" (icon 73 is the J). Icons 64… are the letters A… (no U in the set).
 * Returns the full name, or '' when the text has no such line or the icon is not a letter of that set.
 */
const ICON_LETTERS = 'ABCDEFGHIJKLMNOPQRSTVWXYZ';
export function headerName(source: string | undefined): string {
  const m = source && /^(?:\\>)?\\i\[(\d+)\]\\\}([^\\\n]+?)\\\{\\</.exec(source);
  const letter = m ? ICON_LETTERS[Number(m[1]) - 64] : undefined;
  return m && letter ? letter + m[2]!.trim() : '';
}

/** Who speaks: the game's own name first, then the translator's mapping of the printed name, the face graphic, the developer's label and the event; the printed name itself comes last. */
export function speakerOf(u: Pick<Unit, 'speaker' | 'face' | 'event' | 'note'> & { source?: string }, map: SpeakerMap): string {
  if (u.speaker) return u.speaker;
  const hdr = headerName(u.source);
  const mapped = map && ((hdr && map[`hdr:${hdr}`]?.name) || (u.face && map[`face:${u.face}`]?.name) || (u.note && map[`note:${u.note}`]?.name) || (u.event && map[`event:${u.event}`]?.name));
  return mapped || hdr;
}

export interface SpeakerCandidate {
  /** Key in the speakers map. */
  key: string;
  kind: 'hdr' | 'face' | 'note' | 'event';
  label: string;
  count: number;
  sample: string;
}

/**
 * Things that usually identify a speaker, most useful first: names printed in the text, face graphics (one face, one character), the
 * developer's own labels in comments (`MARCOH`) and events that carry many messages. Units that already have a speaker from the game are skipped.
 */
export function speakerCandidates(views: FileView[], minEventMessages = 3): SpeakerCandidate[] {
  const headers = new Map<string, SpeakerCandidate>();
  const faces = new Map<string, SpeakerCandidate>();
  const notes = new Map<string, SpeakerCandidate>();
  const events = new Map<string, SpeakerCandidate>();
  const bump = (m: Map<string, SpeakerCandidate>, key: string, kind: 'hdr' | 'face' | 'note' | 'event', label: string, u: Unit) => {
    const c = m.get(key);
    if (c) c.count++;
    else m.set(key, { key, kind, label, count: 1, sample: u.source.replace(/\s+/g, ' ').slice(0, 90) });
  };
  for (const v of views) for (const u of v.units) {
    if (u.kind !== 'dialogue' || u.speaker) continue;
    const hdr = headerName(u.source);
    // A printed name is exact: no need to guess from the face, the label or the event.
    if (hdr) { bump(headers, `hdr:${hdr}`, 'hdr', hdr, u); continue; }
    if (u.face) bump(faces, `face:${u.face}`, 'face', u.face, u);
    if (u.note) bump(notes, `note:${u.note}`, 'note', u.note, u);
    if (u.event) bump(events, `event:${u.event}`, 'event', u.event, u);
  }
  const byCount = (a: SpeakerCandidate, b: SpeakerCandidate) => b.count - a.count || a.label.localeCompare(b.label);
  return [...[...headers.values()].sort(byCount), ...[...faces.values()].sort(byCount), ...[...notes.values()].filter(c => c.count >= minEventMessages).sort(byCount), ...[...events.values()].filter(c => c.count >= minEventMessages).sort(byCount)];
}
