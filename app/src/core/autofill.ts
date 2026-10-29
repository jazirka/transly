import type { FileView, SavedProject } from './project';

/** A piece of a line: a word, or anything else (punctuation, digits, a game control code) that stays as it is. */
export interface Tok { text: string; word: boolean; index: number }

const TOKEN = /\\[A-Za-z]+(?:\[[^\]]*\])?|\\[.|!<>^{}$]|\p{L}[\p{L}'’-]*|\d+|[^\s]/gu;

export function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0];
    out.push({ text: t, word: /^\p{L}/u.test(t), index: m.index ?? 0 });
  }
  return out;
}

const MAX_WORDS = 8;
const lower = (s: string): string => s.toLowerCase();
const isCap = (s: string): boolean => { const c = [...s][0] ?? ''; return c !== c.toLowerCase(); };
const capitalise = (s: string): string => { const [c = '', ...rest] = [...s]; return c.toUpperCase() + rest.join(''); };

/** Original word → translation (lower case), learned from the glossary and from translated short lines. */
export type WordDict = Map<string, string>;

/**
 * A translated line teaches its words when the original and the translation have the same shape: the same number of
 * tokens and the same punctuation, digits and codes at the same places; then word i of the original is word i of the
 * translation. A word that got different translations keeps the one that wins by 2:1, otherwise it is ambiguous and
 * dropped. Single-word glossary terms always win.
 */
export interface Learned { dict: WordDict; /** Words whose translations conflict: the variants with their votes. */ ambiguous: Map<string, [string, number][]> }

export function learnWords(views: FileView[], saved: SavedProject): WordDict { return learnDetailed(views, saved).dict; }

export function learnDetailed(views: FileView[], saved: SavedProject): Learned {
  const votes = new Map<string, Map<string, number>>();
  for (const v of views) {
    const ents = saved.files[v.name]; if (!ents) continue;
    for (const u of v.units) {
      const target = ents[u.key]?.target?.trim(); if (!target) continue;
      const a = tokenize(u.source), b = tokenize(target);
      if (a.length !== b.length || a.filter(t => t.word).length > MAX_WORDS) continue;
      if (!a.every((t, i) => t.word === b[i]!.word && (t.word || t.text === b[i]!.text))) continue;
      a.forEach((t, i) => {
        if (!t.word) return;
        const m = votes.get(lower(t.text)) ?? new Map<string, number>();
        const k = lower(b[i]!.text); m.set(k, (m.get(k) ?? 0) + 1); votes.set(lower(t.text), m);
      });
    }
  }
  const dict: WordDict = new Map(), ambiguous = new Map<string, [string, number][]>();
  for (const [w, m] of votes) {
    const ranked = [...m].sort((x, y) => y[1] - x[1]);
    if (ranked.length === 1 || ranked[0]![1] >= 2 * ranked[1]![1]) dict.set(w, ranked[0]![0]);
    else ambiguous.set(w, ranked);
  }
  for (const t of saved.terms) {
    const en = tokenize(t.en.trim());
    if (en.length === 1 && en[0]!.word && t.uk.trim()) { dict.set(lower(t.en.trim()), lower(t.uk.trim())); ambiguous.delete(lower(t.en.trim())); }
  }
  return { dict, ambiguous };
}

export interface Proposal { file: string; key: string; source: string; target: string }

/** Untranslated short lines in which every word is known: the translation is put together word by word. */
export function proposals(views: FileView[], saved: SavedProject, dict: WordDict = learnWords(views, saved), limit = 500): Proposal[] {
  const out: Proposal[] = [];
  for (const v of views) {
    const ents = saved.files[v.name] ?? {};
    for (const u of v.units) {
      if (ents[u.key]?.target?.trim()) continue;
      const toks = tokenize(u.source), words = toks.filter(t => t.word);
      if (!words.length || words.length > MAX_WORDS || !words.every(t => dict.has(lower(t.text)))) continue;
      let target = '', at = 0;
      for (const t of toks) {
        target += u.source.slice(at, t.index);
        at = t.index + t.text.length;
        if (!t.word) { target += t.text; continue; }
        const uk = dict.get(lower(t.text))!;
        target += isCap(t.text) ? capitalise(uk) : uk;
      }
      if (target === u.source) continue;
      out.push({ file: v.name, key: u.key, source: u.source, target });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export interface Blocker { word: string; reason: 'unknown' | 'ambiguous'; /** For ambiguous words: the competing translations. */ variants: string[] }
export interface Almost { file: string; key: string; source: string; blockers: Blocker[] }

/** Untranslated short lines that are one or two words short of being composed, with the words that block them. */
export function almost(views: FileView[], saved: SavedProject, learned: Learned = learnDetailed(views, saved), limit = 200): Almost[] {
  const out: Almost[] = [];
  for (const v of views) {
    const ents = saved.files[v.name] ?? {};
    for (const u of v.units) {
      if (ents[u.key]?.target?.trim()) continue;
      const words = tokenize(u.source).filter(t => t.word);
      if (!words.length || words.length > MAX_WORDS) continue;
      const seen = new Set<string>(), blockers: Blocker[] = [];
      for (const t of words) {
        const k = lower(t.text);
        if (learned.dict.has(k) || seen.has(k)) continue;
        seen.add(k);
        const amb = learned.ambiguous.get(k);
        blockers.push({ word: t.text, reason: amb ? 'ambiguous' : 'unknown', variants: amb ? amb.map(x => x[0]) : [] });
      }
      if (!blockers.length || blockers.length > 2) continue;
      out.push({ file: v.name, key: u.key, source: u.source, blockers });
      if (out.length >= limit) return out;
    }
  }
  return out;
}
