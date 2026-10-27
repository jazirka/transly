import type { Unit } from './model';
import type { FileView } from './project';

export type SpeakerMap = Record<string, { name: string; mt: number }> | undefined;

/** Who speaks: the game's own name first, then the translator's mapping of the face graphic, then of the event. */
export function speakerOf(u: Pick<Unit, 'speaker' | 'face' | 'event'>, map: SpeakerMap): string {
  if (u.speaker) return u.speaker;
  if (!map) return '';
  return (u.face && map[`face:${u.face}`]?.name) || (u.event && map[`event:${u.event}`]?.name) || '';
}

export interface SpeakerCandidate {
  /** Key in the speakers map. */
  key: string;
  kind: 'face' | 'event';
  label: string;
  count: number;
  sample: string;
}

/**
 * Things that usually identify a speaker, most useful first: face graphics (one face, one character) and then
 * events that carry many messages. Units that already have a speaker from the game are skipped.
 */
export function speakerCandidates(views: FileView[], minEventMessages = 3): SpeakerCandidate[] {
  const faces = new Map<string, SpeakerCandidate>();
  const events = new Map<string, SpeakerCandidate>();
  const bump = (m: Map<string, SpeakerCandidate>, key: string, kind: 'face' | 'event', label: string, u: Unit) => {
    const c = m.get(key);
    if (c) c.count++;
    else m.set(key, { key, kind, label, count: 1, sample: u.source.replace(/\s+/g, ' ').slice(0, 90) });
  };
  for (const v of views) for (const u of v.units) {
    if (u.kind !== 'dialogue' || u.speaker) continue;
    if (u.face) bump(faces, `face:${u.face}`, 'face', u.face, u);
    if (u.event) bump(events, `event:${u.event}`, 'event', u.event, u);
  }
  const byCount = (a: SpeakerCandidate, b: SpeakerCandidate) => b.count - a.count || a.label.localeCompare(b.label);
  return [...[...faces.values()].sort(byCount), ...[...events.values()].filter(c => c.count >= minEventMessages).sort(byCount)];
}
