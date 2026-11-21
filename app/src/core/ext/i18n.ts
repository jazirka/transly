import { KNOWN_PLURALS, pluralFn } from './plural-expr';
import type { PluralFn } from './plural-expr';

/**
 * Localization of the interface. The strings of the program are written in Ukrainian (the source language), and a language pack is a catalog that
 * says what each of them is in another language. A string is found by its text (a «message id») inside a context: `core` for the program itself and
 * `plugin:<id>` for the strings of a plugin. A pack can hold any contexts, so it can translate a plugin its author knows nothing about.
 *
 * The catalog of a language is the sum of the layers its packs bring (the pack installed later wins). A string that is not in the catalog is
 * shown in the source language, so the interface never has a hole, and is remembered, so the translator can be given the list of what is missing.
 */

export const CORE = 'core';
export const SOURCE_LANGUAGE = 'uk';
const SEP = '\u0004';

export type Params = Record<string, string | number>;

/** One catalog read from a file: the entries of a language by `context` + message id. */
export interface CatalogData {
  language?: string;
  name?: string;
  plural?: string;
  /** key (`context` + SEP + msgid) → the forms of the translation (one, or one for each plural form). */
  entries: Map<string, string[]>;
}

export const keyOf = (msgid: string, ctx: string = CORE): string => ctx + SEP + msgid;

const unq = (s: string): string => s.trim().slice(1, -1).replace(/\\(n|t|r|"|\\)/g, (_m, c: string) => ({ n: '\n', t: '\t', r: '\r', '"': '"', '\\': '\\' })[c] ?? c);

/** Read a gettext `.po` (or `.pot`) file. Entries marked fuzzy or obsolete and entries without a translation are left out. */
export function parsePoCatalog(text: string): CatalogData {
  const out: CatalogData = { entries: new Map() };
  type Cur = { ctx: string | null; id: string; plural: boolean; strs: string[]; fuzzy: boolean; obsolete: boolean };
  let cur: Cur | null = null, field: 'ctx' | 'id' | 'plural' | number | null = null, any = false;
  const fresh = (): Cur => ({ ctx: null, id: '', plural: false, strs: [], fuzzy: false, obsolete: false });
  const flush = (): void => {
    if (cur && any && !cur.obsolete) {
      if (cur.id === '') {
        const head = cur.strs[0] ?? '';
        const lang = /^Language:\s*(.+)$/m.exec(head)?.[1]?.trim(); if (lang) out.language = lang.replace('_', '-');
        const pl = /plural=([^;]+)/.exec(head)?.[1]?.trim(); if (pl) out.plural = pl;
        const nm = /^Language-Team:\s*(.+)$/m.exec(head)?.[1]?.trim(); if (nm && !out.name) out.name = nm;
      } else if (!cur.fuzzy && cur.strs.some(s => s !== '')) out.entries.set(keyOf(cur.id, cur.ctx ?? CORE), cur.strs.map(s => s ?? ''));
    }
    cur = null; field = null; any = false;
  };
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (line.startsWith('#~')) { cur ??= fresh(); cur.obsolete = true; continue; }
    if (line.startsWith('#')) { if (cur && any) flush(); cur ??= fresh(); if (/^#,.*\bfuzzy\b/.test(line)) cur.fuzzy = true; continue; }
    const m = /^(msgctxt|msgid_plural|msgid|msgstr(?:\[(\d+)\])?)\s+(".*")$/.exec(line);
    if (m) {
      if (cur && cur.strs.length && (m[1] === 'msgid' || m[1] === 'msgctxt')) flush();
      cur ??= fresh(); any = true;
      const v = unq(m[3]!);
      if (m[1] === 'msgctxt') { cur.ctx = v; field = 'ctx'; }
      else if (m[1] === 'msgid') { cur.id = v; field = 'id'; }
      else if (m[1] === 'msgid_plural') { cur.plural = true; field = 'plural'; }
      else { const i = m[2] ? Number(m[2]) : 0; cur.strs[i] = v; field = i; }
      continue;
    }
    if (line.startsWith('"') && cur && field !== null) {
      const v = unq(line);
      if (field === 'ctx') cur.ctx = (cur.ctx ?? '') + v;
      else if (field === 'id') cur.id += v;
      else if (field === 'plural') { /* the plural id is not used as a key */ }
      else cur.strs[field] = (cur.strs[field] ?? '') + v;
    }
  }
  flush();
  return out;
}

/** Read a catalog written as JSON: `{ language, plural, messages: { id: text | [forms] }, contexts: { "plugin:x": { id: text } } }`. */
export function parseJsonCatalog(text: string): CatalogData {
  const out: CatalogData = { entries: new Map() };
  let j: unknown;
  try { j = JSON.parse(text); } catch { return out; }
  if (!j || typeof j !== 'object') return out;
  const o = j as Record<string, unknown>;
  if (typeof o.language === 'string') out.language = o.language;
  if (typeof o.name === 'string') out.name = o.name;
  if (typeof o.plural === 'string') out.plural = o.plural;
  const take = (ctx: string, m: unknown): void => {
    if (!m || typeof m !== 'object') return;
    for (const [id, v] of Object.entries(m as Record<string, unknown>)) {
      const forms = typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
      if (id && forms.some(s => s !== '')) out.entries.set(keyOf(id, ctx), forms);
    }
  };
  take(CORE, o.messages);
  if (o.contexts && typeof o.contexts === 'object') for (const [c, m] of Object.entries(o.contexts as Record<string, unknown>)) take(c, m);
  return out;
}

/** The catalog in a file, by its name. */
export const parseCatalog = (name: string, text: string): CatalogData => (/\.json$/i.test(name) ? parseJsonCatalog(text) : parsePoCatalog(text));

const subst = (s: string, p?: Params): string => (p ? s.replace(/\{(\w+)\}/g, (m, k: string) => (k in p ? String(p[k]) : m)) : s);

/** A message id with `{name}` or `{1}` in it is a template: the pattern it matches and the names it takes. */
interface Template { re: RegExp; names: string[]; ctx: string; id: string; weight: number }
const compile = (id: string, ctx: string): Template | null => {
  const names: string[] = [];
  let weight = 0, last = 0, src = '';
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const m of id.matchAll(/\{(\w+)\}/g)) { src += esc(id.slice(last, m.index)); weight += m.index! - last; src += '(.+?)'; names.push(m[1]!); last = m.index! + m[0].length; }
  if (!names.length) return null;
  src += esc(id.slice(last)); weight += id.length - last;
  return { re: new RegExp(`^${src}$`, 's'), names, ctx, id, weight };
};

const CYRILLIC = /[Ѐ-ӿ]/;
/** A sample of a string with its numbers replaced by `{1}`, `{2}`…: how a message with a number in it is asked from a translator. */
export const templated = (text: string): string => { let n = 0; return text.replace(/\d[\d\s.,]*\d|\d/g, () => `{${++n}}`); };

interface Layer { origin: string; entries: Map<string, string[]> }
interface Lang { code: string; name: string; plural: PluralFn; pluralExpr: string; layers: Layer[]; fallback: string[] }

/** The state of the interface language. One instance serves the application (`i18n` below); tests make their own. */
export class I18n {
  readonly source = SOURCE_LANGUAGE;
  private langs = new Map<string, Lang>();
  private active = SOURCE_LANGUAGE;
  private chain: string[] = [];
  private tpl: Template[] | null = null;
  private miss = new Map<string, { ctx: string; id: string; sample: string }>();
  private negative = new Set<string>();
  private listeners = new Set<() => void>();
  private rev = 0;
  /** When false the strings that are not found are not remembered (a cost the application pays only while a translator asks for the list). */
  capture = true;

  /** A language, and a layer of its catalog (the strings of one pack). The same origin replaces its earlier layer. */
  add(code: string, data: CatalogData, origin: string, name?: string): void {
    const l = this.langs.get(code) ?? { code, name: name ?? data.name ?? code, plural: () => 0, pluralExpr: '', layers: [], fallback: [] };
    const expr = data.plural ?? l.pluralExpr ?? KNOWN_PLURALS[code.split('-')[0]!] ?? 'n != 1';
    l.pluralExpr = expr || KNOWN_PLURALS[code.split('-')[0]!] || 'n != 1';
    l.plural = pluralFn(l.pluralExpr) ?? pluralFn(KNOWN_PLURALS[code.split('-')[0]!] ?? 'n != 1') ?? (() => 0);
    if (name) l.name = name;
    l.layers = l.layers.filter(x => x.origin !== origin);
    l.layers.push({ origin, entries: data.entries });
    this.langs.set(code, l);
    this.changed();
  }

  /** The strings a pack brought are taken away (the plugin was disabled or removed). */
  remove(origin: string): void {
    for (const [code, l] of this.langs) {
      l.layers = l.layers.filter(x => x.origin !== origin);
      if (!l.layers.length) this.langs.delete(code);
    }
    if (!this.langs.has(this.active) && this.active !== this.source) this.setLanguage(this.source);
    this.changed();
  }

  /** The languages that have a catalog, with the source language first. */
  languages(): { code: string; name: string }[] {
    return [{ code: this.source, name: 'Українська' }, ...[...this.langs.values()].filter(l => l.code !== this.source).map(l => ({ code: l.code, name: l.name })).sort((a, b) => a.name.localeCompare(b.name))];
  }

  get language(): string { return this.active; }

  /** Switch the interface language; the strings are looked up in it, then in the languages after it (`fr-CA` → `fr`), then the source. */
  setLanguage(code: string, fallback: string[] = []): void {
    const base = this.active === code && code.includes('-') ? [code.split('-')[0]!] : [];
    this.active = [code, code.split('-')[0]!].find(c => c === this.source || this.langs.has(c)) ?? this.source;
    this.chain = this.active === this.source ? [] : [this.active, ...base, ...fallback].filter((c, i, a) => c !== this.source && a.indexOf(c) === i && this.langs.has(c));
    this.negative.clear();
    this.changed();
  }

  /** Called after the language or the catalogs changed (the interface draws itself again). Returns the way to stop listening. */
  onChange(cb: () => void): () => void { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  /** A number that changes with every change of the language or of the catalogs. */
  get revision(): number { return this.rev; }
  private changed(): void { this.tpl = null; this.negative.clear(); this.rev++; for (const cb of [...this.listeners]) { try { cb(); } catch { /* a listener must not stop the others */ } } }

  private lookup(key: string): string[] | null {
    for (const code of this.chain) {
      const l = this.langs.get(code)!;
      for (let i = l.layers.length - 1; i >= 0; i--) { const f = l.layers[i]!.entries.get(key); if (f && f.some(s => s !== '')) return f; }
    }
    return null;
  }

  /** The string in the language of the interface, with `{name}` replaced by `params`. */
  t(msgid: string, params?: Params, ctx: string = CORE): string {
    const f = this.chain.length ? this.lookup(keyOf(msgid, ctx)) : null;
    if (!f && this.chain.length) this.remember(msgid, ctx, msgid);
    return subst(f?.[0] ?? msgid, params);
  }

  /** A string with a number in it: `forms` are the forms of the source language (one, few, many), the translation has the forms of its own language. */
  tn(forms: readonly string[], n: number, params: Params = {}, ctx: string = CORE): string {
    const p = { n, ...params };
    const f = this.chain.length ? this.lookup(keyOf(forms[0]!, ctx)) : null;
    if (f) {
      const l = this.langs.get(this.chain.find(c => this.langs.get(c)!.layers.some(x => x.entries.get(keyOf(forms[0]!, ctx))?.some(s => s !== '')))!)!;
      return subst(f[Math.min(l.plural(n), f.length - 1)] ?? f[0]!, p);
    }
    if (this.chain.length) this.remember(forms[0]!, ctx, forms[0]!);
    const m10 = n % 10, m100 = n % 100;
    const i = m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2;
    return subst(forms[Math.min(i, forms.length - 1)]!, p);
  }

  has(msgid: string, ctx: string = CORE): boolean { return this.lookup(keyOf(msgid, ctx)) !== null; }

  private templates(): Template[] {
    if (this.tpl) return this.tpl;
    const out: Template[] = [], seen = new Set<string>();
    for (const code of this.chain) for (const l of this.langs.get(code)!.layers) for (const key of l.entries.keys()) {
      if (seen.has(key) || !key.includes('{')) continue;
      seen.add(key);
      const at = key.indexOf(SEP), t = compile(key.slice(at + 1), key.slice(0, at));
      if (t) out.push(t);
    }
    return (this.tpl = out.sort((a, b) => b.weight - a.weight));
  }

  /**
   * The translation of a piece of text that is already on the screen (the interface draws Ukrainian text and this puts the language of the pack in its
   * place): the text itself, or a template it fits («Перекладено {1}%»). Null when the text is not known or the language is the source.
   */
  translateText(text: string, ctx: string = CORE): string | null {
    if (!this.chain.length) return null;
    const exact = this.lookup(keyOf(text, ctx));
    if (exact) return exact[0]!;
    if (this.negative.has(text)) return null;
    for (const t of this.templates()) {
      if (t.ctx !== ctx) continue;
      const m = t.re.exec(text);
      if (!m) continue;
      const f = this.lookup(keyOf(t.id, ctx));
      if (!f) continue;
      return f[0]!.replace(/\{(\w+)\}/g, (all, k: string) => { const i = t.names.indexOf(k); return i >= 0 ? m[i + 1]! : all; });
    }
    if (this.negative.size > 8000) this.negative.clear();
    this.negative.add(text);
    if (CYRILLIC.test(text)) this.remember(templated(text), ctx, text);
    return null;
  }

  private remember(id: string, ctx: string, sample: string): void {
    if (!this.capture || !CYRILLIC.test(id)) return;
    const key = keyOf(id, ctx);
    if (this.miss.has(key)) return;
    if (this.miss.size >= 5000) return;
    this.miss.set(key, { ctx, id, sample });
  }

  /** The strings that were asked for and not found, for a translator: how many, and a `.pot` template to translate. */
  missing(): { ctx: string; id: string; sample: string }[] { return [...this.miss.values()]; }
  forgetMissing(): void { this.miss.clear(); }
  /** The language pack for a language written as a `.po` template; `known` lists strings to leave out (already translated in the file being edited). */
  template(lang: string, items: { ctx: string; id: string; sample: string }[] = this.missing()): string {
    const q = (s: string): string => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
    const head = `msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n"Language: ${lang}\\n"\n"Plural-Forms: nplurals=2; plural=(n != 1);\\n"\n"X-Source-Language: ${this.source}\\n"\n`;
    return head + items.map(i => `\n${i.id !== i.sample ? `#. ${i.sample.replace(/\n/g, ' ')}\n` : ''}msgctxt ${q(i.ctx)}\nmsgid ${q(i.id)}\nmsgstr ""\n`).join('');
  }
}

/** The interface language of the application. */
export const i18n = new I18n();
/** The string in the language of the interface (see `I18n.t`). */
export const t = (msgid: string, params?: Params, ctx?: string): string => i18n.t(msgid, params, ctx);
/** The strings of a plugin: a function that always asks inside the context of that plugin. */
export const tFor = (pluginId: string): ((msgid: string, params?: Params) => string) => (msgid, params) => i18n.t(msgid, params, `plugin:${pluginId}`);
