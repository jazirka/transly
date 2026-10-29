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
export function learnWords(views: FileView[], saved: SavedProject): WordDict {
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
  const dict: WordDict = new Map();
  for (const [w, m] of votes) {
    const ranked = [...m].sort((x, y) => y[1] - x[1]);
    if (ranked.length === 1 || ranked[0]![1] >= 2 * ranked[1]![1]) dict.set(w, ranked[0]![0]);
  }
  for (const t of saved.terms) {
    const en = tokenize(t.en.trim());
    if (en.length === 1 && en[0]!.word && t.uk.trim()) dict.set(lower(t.en.trim()), lower(t.uk.trim()));
  }
  return dict;
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
