import { t } from './i18n';
import { satisfies, validRange } from './semver';
import { parseVersion } from './semver';
import { PERMISSIONS } from './types';
import type { CommandContribution, Contributions, EngineContribution, FormatContribution, FormatSpec, GlossaryContribution, HelpContribution, LanguageContribution, PluginManifest, PluginPermission, QaRuleContribution, SettingsContribution } from './types';
import { API_VERSION, APP_VERSION, MANIFEST_VERSION } from './version';

/** The file that names a plugin. */
export const MANIFEST_FILE = 'transly-plugin.json';

/** Limits that keep a manifest (and what it makes the application keep) small. */
export const LIMITS = { files: 200, fileBytes: 2_000_000, totalBytes: 8_000_000, manifestBytes: 200_000, formats: 32, engines: 16, languages: 16, help: 64, settings: 16, fields: 64, commands: 32, qaRules: 32, glossaries: 16, steps: 50, patterns: 50, terms: 5000, pattern: 120, name: 80, text: 600, id: 64 } as const;

export type Checked = { ok: true; manifest: PluginManifest; warnings: string[] } | { ok: false; errors: string[] };

const ID = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
const LOCAL_ID = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const EXT = /^\.[a-z0-9][a-z0-9_-]{0,15}$/;
const LANG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8}){0,2}$/;
const SHA = /^sha256-[0-9a-f]{64}$/;
const KINDS = ['dialogue', 'choice', 'scroll', 'name', 'description', 'message', 'term'];

/** A path inside a package: relative, with `/`, no `..`, no hidden parts, no strange characters. */
export function safePath(p: unknown): p is string {
  if (typeof p !== 'string' || !p || p.length > 160) return false;
  if (p.startsWith('/') || p.includes('\\') || p.includes('\0') || /^[a-zA-Z]:/.test(p)) return false;
  return p.split('/').every(s => s !== '' && s !== '.' && s !== '..' && !s.startsWith('.') && /^[\p{L}\p{N}_ .()+-]+$/u.test(s));
}

const isStr = (v: unknown, max: number = LIMITS.text): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** An https address, or the address of a local development server. */
export const isHttps = (u: unknown): u is string => { if (typeof u !== 'string' || u.length > 300) return false; try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password; } catch { return false; } };

class Report {
  errors: string[] = [];
  warnings: string[] = [];
  bad(where: string, what: string): void { this.errors.push(`${where}: ${what}`); }
  warn(where: string, what: string): void { this.warnings.push(`${where}: ${what}`); }
}

function spec(r: Report, where: string, s: unknown): FormatSpec | undefined {
  if (!isObj(s)) { r.bad(where, t('опис формату має бути об’єктом')); return undefined; }
  const col = (v: unknown): boolean => (typeof v === 'string' && v.length > 0 && v.length <= 80) || (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000);
  if (s.type === 'keyvalue') {
    if (s.separator !== undefined && (typeof s.separator !== 'string' || s.separator.length < 1 || s.separator.length > 3)) r.bad(where, t('«separator» — рядок від 1 до 3 знаків'));
    if (s.comments !== undefined && (!Array.isArray(s.comments) || s.comments.length > 8 || s.comments.some(c => !isStr(c, 4)))) r.bad(where, t('«comments» — до 8 коротких рядків'));
    return r.errors.length ? undefined : (s as unknown as FormatSpec);
  }
  if (s.type === 'table') {
    const keys = Array.isArray(s.key) ? s.key : [s.key];
    if (!keys.length || keys.length > 4 || !keys.every(col)) r.bad(where, t('«key» — назва або номер стовпця (до чотирьох)'));
    if (!col(s.source)) r.bad(where, t('«source» — назва або номер стовпця'));
    if (!col(s.target)) r.bad(where, t('«target» — назва або номер стовпця'));
    for (const k of ['speaker', 'context'] as const) if (s[k] !== undefined && !col(s[k])) r.bad(where, t('«{k}» — назва або номер стовпця', { k }));
    if (s.delimiter !== undefined && ![',', ';', '\t', 'auto'].includes(s.delimiter as string)) r.bad(where, t('«delimiter» — «,», «;», табуляція або «auto»'));
    if (s.kind !== undefined && !KINDS.includes(s.kind as string)) r.bad(where, t('невідомий вид рядка «{kind}»', { kind: String(s.kind) }));
    return r.errors.length ? undefined : (s as unknown as FormatSpec);
  }
  if (s.type === 'json') {
    const rules = s.rules;
    if (!Array.isArray(rules) || !rules.length || rules.length > 64) { r.bad(where, t('«rules» — від 1 до 64 правил')); return undefined; }
    for (const [i, rule] of rules.entries()) {
      if (!isObj(rule) || !isStr(rule.path, 200) || !/^[\w$[\]*.\- ]+$/.test(rule.path as string)) r.bad(`${where} rules[${i}]`, t('«path» — шлях на кшталт a.b[*].text'));
      else if (rule.kind !== undefined && !KINDS.includes(rule.kind as string)) r.bad(`${where} rules[${i}]`, t('невідомий вид рядка «{kind}»', { kind: String(rule.kind) }));
    }
    return r.errors.length ? undefined : (s as unknown as FormatSpec);
  }
  r.bad(where, t('невідомий тип опису формату «{type}» (є keyvalue, table, json)', { type: String(s.type) }));
  return undefined;
}

function formats(r: Report, a: unknown, hasCode: boolean, builtin: boolean): FormatContribution[] {
  if (a === undefined) return [];
  if (!Array.isArray(a) || a.length > LIMITS.formats) { r.bad('contributes.formats', t('має бути списком (до {n})', { n: LIMITS.formats })); return []; }
  const out: FormatContribution[] = [], seen = new Set<string>();
  a.forEach((f, i) => {
    const w = `contributes.formats[${i}]`;
    if (!isObj(f)) { r.bad(w, t('має бути об’єктом')); return; }
    if (typeof f.id !== 'string' || !LOCAL_ID.test(f.id)) r.bad(w, t('«id» — латиниця, цифри, «-» і «_», до 40 знаків'));
    else if (seen.has(f.id)) r.bad(w, t('«id» «{id}» повторюється', { id: f.id })); else seen.add(f.id);
    if (!isStr(f.label, LIMITS.name)) r.bad(w, t('«label» — непорожній рядок'));
    if (!Array.isArray(f.extensions) || !f.extensions.length || f.extensions.length > 8 || !f.extensions.every(e => typeof e === 'string' && EXT.test(e))) r.bad(w, t('«extensions» — розширення з крапкою малими літерами, наприклад .lang'));
    if (f.files !== undefined && (!Array.isArray(f.files) || f.files.length > 16 || !f.files.every(p => isStr(p, 120) && !p.includes('\\') && !p.includes('..')))) r.bad(w, t('«files» — до 16 шаблонів імен'));
    if (typeof f.text !== 'boolean') r.bad(w, t('«text» — true (текстовий файл) або false (JSON)'));
    if (f.priority !== undefined && (typeof f.priority !== 'number' || !Number.isFinite(f.priority) || f.priority < -50 || f.priority > (builtin ? 200 : 50))) r.bad(w, t('«priority» — число від −50 до 50'));
    if (f.spec !== undefined) spec(r, `${w}.spec`, f.spec);
    else if (f.handler === undefined) r.bad(w, t('потрібен «spec» (опис даними) або «handler» (код)'));
    if (f.handler !== undefined) {
      if (typeof f.handler !== 'string' || !/^[A-Za-z_$][\w$]{0,60}$/.test(f.handler)) r.bad(w, t('«handler» — назва функції'));
      else if (!hasCode && !builtin) r.bad(w, t('«handler» потребує коду («main»)'));
    }
    if (f.spec !== undefined && f.handler !== undefined) r.bad(w, t('вкажіть або «spec», або «handler», не обидва'));
    out.push(f as unknown as FormatContribution);
  });
  return out;
}

function engines(r: Report, a: unknown, localFormats: Set<string>): EngineContribution[] {
  if (a === undefined) return [];
  if (!Array.isArray(a) || a.length > LIMITS.engines) { r.bad('contributes.engines', t('має бути списком (до {n})', { n: LIMITS.engines })); return []; }
  const globs = (v: unknown): boolean => Array.isArray(v) && v.length <= 32 && v.every(p => isStr(p, 120) && !p.includes('\\') && !p.includes('..') && !p.startsWith('/'));
  return a.flatMap((e, i) => {
    const w = `contributes.engines[${i}]`;
    if (!isObj(e)) { r.bad(w, t('має бути об’єктом')); return []; }
    if (typeof e.id !== 'string' || !LOCAL_ID.test(e.id)) r.bad(w, t('«id» — латиниця, цифри, «-» і «_»'));
    if (!isStr(e.label, LIMITS.name)) r.bad(w, t('«label» — непорожній рядок'));
    if (e.description !== undefined && !isStr(e.description)) r.bad(w, t('«description» — рядок'));
    if (e.formats !== undefined) {
      if (!Array.isArray(e.formats) || e.formats.length > 16 || !e.formats.every(f => typeof f === 'string')) r.bad(w, t('«formats» — список id форматів'));
      else for (const f of e.formats as string[]) if (!localFormats.has(f)) r.bad(w, t('формат «{f}» не оголошено в «formats»', { f }));
    }
    if (e.detect !== undefined) {
      const d = e.detect;
      if (!isObj(d)) r.bad(w, t('«detect» має бути об’єктом'));
      else {
        for (const k of ['files', 'anyFiles', 'excludeFiles']) if (d[k] !== undefined && !globs(d[k])) r.bad(w, t('«detect.{k}» — до 32 шаблонів шляхів', { k }));
        if (d.min !== undefined && (!Number.isInteger(d.min) || (d.min as number) < 1 || (d.min as number) > 32)) r.bad(w, t('«detect.min» — ціле від 1 до 32'));
      }
    }
    if (e.dataFolders !== undefined && (!Array.isArray(e.dataFolders) || e.dataFolders.length > 8 || !e.dataFolders.every(f => isStr(f, 80) && !f.includes('..') && !f.startsWith('/')))) r.bad(w, t('«dataFolders» — до 8 відносних папок'));
    if (e.features !== undefined && (!Array.isArray(e.features) || e.features.length > 32 || !e.features.every(f => isStr(f, 40)))) r.bad(w, t('«features» — список назв'));
    return [e as unknown as EngineContribution];
  });
}

function languages(r: Report, a: unknown): LanguageContribution[] {
  if (a === undefined) return [];
  if (!Array.isArray(a) || a.length > LIMITS.languages) { r.bad('contributes.languages', t('має бути списком (до {n})', { n: LIMITS.languages })); return []; }
  return a.flatMap((l, i) => {
    const w = `contributes.languages[${i}]`;
    if (!isObj(l)) { r.bad(w, t('має бути об’єктом')); return []; }
    if (typeof l.code !== 'string' || !LANG.test(l.code)) r.bad(w, t('«code» — код мови на кшталт en, pl, pt-BR'));
    if (!isStr(l.name, LIMITS.name)) r.bad(w, t('«name» — непорожній рядок'));
    if (!Array.isArray(l.catalogs) || !l.catalogs.length || l.catalogs.length > 16) r.bad(w, t('«catalogs» — від 1 до 16 файлів'));
    else for (const c of l.catalogs) if (!isObj(c) || !safePath(c.file) || !/\.(po|pot|json)$/i.test(String(c.file))) r.bad(w, t('файл каталогу має бути .po або .json усередині пакета'));
      else if (c.context !== undefined && (typeof c.context !== 'string' || !/^(core|plugin:[a-z0-9.-]{1,64})$/.test(c.context))) r.bad(w, t('«context» — core або plugin:<id>'));
    if (l.plural !== undefined && (typeof l.plural !== 'string' || l.plural.length > 300)) r.bad(w, t('«plural» — правило множини gettext'));
    if (l.fallback !== undefined && (!Array.isArray(l.fallback) || l.fallback.length > 4 || !l.fallback.every(c => typeof c === 'string' && LANG.test(c)))) r.bad(w, t('«fallback» — до 4 кодів мов'));
    return [l as unknown as LanguageContribution];
  });
}

function help(r: Report, a: unknown): HelpContribution[] {
  if (a === undefined) return [];
  if (!Array.isArray(a) || a.length > LIMITS.help) { r.bad('contributes.help', t('має бути списком (до {n})', { n: LIMITS.help })); return []; }
  return a.flatMap((h, i) => {
    const w = `contributes.help[${i}]`;
    if (!isObj(h)) { r.bad(w, t('має бути об’єктом')); return []; }
    if (typeof h.id !== 'string' || !LOCAL_ID.test(h.id)) r.bad(w, t('«id» — латиниця, цифри, «-» і «_»'));
    if (!isStr(h.title, LIMITS.name)) r.bad(w, t('«title» — непорожній рядок'));
    if (h.body === undefined && h.file === undefined) r.bad(w, t('потрібен «body» або «file»'));
    if (h.body !== undefined && (typeof h.body !== 'string' || h.body.length > 20_000)) r.bad(w, t('«body» — текст до 20 000 знаків'));
    if (h.file !== undefined && !safePath(h.file)) r.bad(w, t('«file» — шлях усередині пакета'));
    if (h.topic !== undefined && (typeof h.topic !== 'string' || !/^(general|engine:[a-z0-9_-]{1,40})$/.test(h.topic))) r.bad(w, t('«topic» — general або engine:<id>'));
    return [h as unknown as HelpContribution];
  });
}

function settings(r: Report, a: unknown): SettingsContribution[] {
  if (a === undefined) return [];
  if (!Array.isArray(a) || a.length > LIMITS.settings) { r.bad('contributes.settings', t('має бути списком (до {n})', { n: LIMITS.settings })); return []; }
  return a.flatMap((s, i) => {
    const w = `contributes.settings[${i}]`;
    if (!isObj(s)) { r.bad(w, t('має бути об’єктом')); return []; }
    if (typeof s.id !== 'string' || !LOCAL_ID.test(s.id)) r.bad(w, t('«id» — латиниця, цифри, «-» і «_»'));
    if (!isStr(s.title, LIMITS.name)) r.bad(w, t('«title» — непорожній рядок'));
    if (!Array.isArray(s.fields) || !s.fields.length || s.fields.length > LIMITS.fields) { r.bad(w, t('«fields» — від 1 до {n} полів', { n: LIMITS.fields })); return []; }
    const keys = new Set<string>();
    for (const [j, f] of (s.fields as unknown[]).entries()) {
      const x = `${w}.fields[${j}]`;
      if (!isObj(f)) { r.bad(x, t('має бути об’єктом')); continue; }
      if (typeof f.key !== 'string' || !/^[a-zA-Z][\w]{0,39}$/.test(f.key)) r.bad(x, t('«key» — латиниця, цифри, «_»')); else if (keys.has(f.key)) r.bad(x, t('«key» «{k}» повторюється', { k: f.key })); else keys.add(f.key);
      if (!['boolean', 'string', 'number', 'select'].includes(f.type as string)) r.bad(x, t('«type» — boolean, string, number або select'));
      if (!isStr(f.label, LIMITS.name)) r.bad(x, t('«label» — непорожній рядок'));
      if (f.type === 'select' && (!Array.isArray(f.options) || !f.options.length || f.options.length > 64 || !(f.options as unknown[]).every(o => isObj(o) && isStr(o.value, 80) && isStr(o.label, LIMITS.name)))) r.bad(x, t('«options» — список {«value», «label»}'));
      if (f.scope !== undefined && f.scope !== 'app' && f.scope !== 'project') r.bad(x, t('«scope» — app або project'));
    }
    return [s as unknown as SettingsContribution];
  });
}

const matchOk = (r: Report, w: string, m: unknown, extra: string[] = []): m is Record<string, unknown> => {
  if (!isObj(m)) { r.bad(w, t('має бути об’єктом')); return false; }
  if (!isStr(m.find, LIMITS.pattern)) { r.bad(w, t('«find» — текст від 1 до {n} знаків (не регулярний вираз)', { n: LIMITS.pattern })); return false; }
  for (const k of ['wholeWord', 'caseSensitive']) if (m[k] !== undefined && typeof m[k] !== 'boolean') r.bad(w, t('«{k}» — true або false', { k }));
  for (const k of extra) if (m[k] !== undefined && typeof m[k] !== 'string') r.bad(w, t('«{k}» — текст', { k }));
  return true;
};

function commands(r: Report, a: unknown, helpIds: Set<string>): CommandContribution[] {
  if (a === undefined) return [];
  if (!Array.isArray(a) || a.length > LIMITS.commands) { r.bad('contributes.commands', t('має бути списком (до {n})', { n: LIMITS.commands })); return []; }
  const seen = new Set<string>();
  return a.flatMap((c, i) => {
    const w = `contributes.commands[${i}]`;
    if (!isObj(c)) { r.bad(w, t('має бути об’єктом')); return []; }
    if (typeof c.id !== 'string' || !LOCAL_ID.test(c.id)) r.bad(w, t('«id» — латиниця, цифри, «-» і «_»')); else if (seen.has(c.id)) r.bad(w, t('«id» «{id}» повторюється', { id: c.id })); else seen.add(c.id);
    if (!isStr(c.title, LIMITS.name)) r.bad(w, t('«title» — непорожній рядок'));
    if (c.description !== undefined && !isStr(c.description)) r.bad(w, t('«description» — текст'));
    if (c.action === 'replace') {
      if (!Array.isArray(c.steps) || !c.steps.length || c.steps.length > LIMITS.steps) r.bad(w, t('«steps» — від 1 до {n} кроків', { n: LIMITS.steps }));
      else for (const [j, st] of c.steps.entries()) { if (matchOk(r, `${w}.steps[${j}]`, st) && (typeof (st as Record<string, unknown>).replace !== 'string' || ((st as Record<string, unknown>).replace as string).length > LIMITS.pattern)) r.bad(`${w}.steps[${j}]`, t('«replace» — текст до {n} знаків', { n: LIMITS.pattern })); }
    } else if (c.action === 'help') {
      if (typeof c.help !== 'string' || !helpIds.has(c.help)) r.bad(w, t('«help» — id однієї з довідок цього розширення'));
    } else if (c.action === 'link') {
      if (!isHttps(c.url)) r.bad(w, t('«url» — адреса https'));
    } else r.bad(w, t('«action» — replace, help або link'));
    return [c as unknown as CommandContribution];
  });
}

function qaRules(r: Report, a: unknown): QaRuleContribution[] {
  if (a === undefined) return [];
  if (!Array.isArray(a) || a.length > LIMITS.qaRules) { r.bad('contributes.qaRules', t('має бути списком (до {n})', { n: LIMITS.qaRules })); return []; }
  const seen = new Set<string>();
  return a.flatMap((q, i) => {
    const w = `contributes.qaRules[${i}]`;
    if (!isObj(q)) { r.bad(w, t('має бути об’єктом')); return []; }
    if (typeof q.id !== 'string' || !LOCAL_ID.test(q.id)) r.bad(w, t('«id» — латиниця, цифри, «-» і «_»')); else if (seen.has(q.id)) r.bad(w, t('«id» «{id}» повторюється', { id: q.id })); else seen.add(q.id);
    if (!isStr(q.title, LIMITS.name)) r.bad(w, t('«title» — непорожній рядок'));
    if (q.description !== undefined && !isStr(q.description)) r.bad(w, t('«description» — текст'));
    if (q.severity !== undefined && q.severity !== 'warn' && q.severity !== 'bad') r.bad(w, t('«severity» — warn або bad'));
    if (q.kinds !== undefined && (!Array.isArray(q.kinds) || q.kinds.length > 16 || !q.kinds.every(k => typeof k === 'string' && KINDS.includes(k)))) r.bad(w, t('«kinds» — види рядків: {list}', { list: KINDS.join(', ') }));
    const ch = q.check, x = `${w}.check`;
    if (!isObj(ch)) r.bad(x, t('має бути об’єктом'));
    else {
      if (ch.message !== undefined && !isStr(ch.message, 200)) r.bad(x, t('«message» — текст до 200 знаків'));
      if (ch.type === 'forbid') {
        if (!Array.isArray(ch.items) || !ch.items.length || ch.items.length > LIMITS.patterns) r.bad(x, t('«items» — від 1 до {n} шаблонів', { n: LIMITS.patterns }));
        else for (const [j, it] of ch.items.entries()) { if (matchOk(r, `${x}.items[${j}]`, it, ['replace']) && typeof (it as Record<string, unknown>).replace === 'string' && ((it as Record<string, unknown>).replace as string).length > LIMITS.pattern) r.bad(`${x}.items[${j}]`, t('«replace» — текст до {n} знаків', { n: LIMITS.pattern })); }
      } else if (ch.type === 'require') { matchOk(r, `${x}.when`, ch.when); matchOk(r, `${x}.then`, ch.then); }
      else if (ch.type === 'maxLength') { if (typeof ch.max !== 'number' || !Number.isInteger(ch.max) || ch.max < 1 || ch.max > 10_000) r.bad(x, t('«max» — ціле число від 1 до 10000')); }
      else if (ch.type !== 'sameAsSource') r.bad(x, t('«type» — forbid, require, maxLength або sameAsSource'));
    }
    return [q as unknown as QaRuleContribution];
  });
}

function glossaries(r: Report, a: unknown): GlossaryContribution[] {
  if (a === undefined) return [];
  if (!Array.isArray(a) || a.length > LIMITS.glossaries) { r.bad('contributes.glossaries', t('має бути списком (до {n})', { n: LIMITS.glossaries })); return []; }
  const seen = new Set<string>();
  return a.flatMap((g, i) => {
    const w = `contributes.glossaries[${i}]`;
    if (!isObj(g)) { r.bad(w, t('має бути об’єктом')); return []; }
    if (typeof g.id !== 'string' || !LOCAL_ID.test(g.id)) r.bad(w, t('«id» — латиниця, цифри, «-» і «_»')); else if (seen.has(g.id)) r.bad(w, t('«id» «{id}» повторюється', { id: g.id })); else seen.add(g.id);
    if (!isStr(g.title, LIMITS.name)) r.bad(w, t('«title» — непорожній рядок'));
    if (g.description !== undefined && !isStr(g.description)) r.bad(w, t('«description» — текст'));
    if (g.terms === undefined && g.file === undefined) r.bad(w, t('потрібні «terms» або «file»'));
    if (g.file !== undefined && (!safePath(g.file) || !/\.(json|tsv)$/i.test(String(g.file)))) r.bad(w, t('«file» — .json або .tsv усередині пакета'));
    if (g.terms !== undefined) {
      if (!Array.isArray(g.terms) || g.terms.length > LIMITS.terms) r.bad(w, t('«terms» — список до {n} термінів', { n: LIMITS.terms }));
      else for (const [j, tm] of g.terms.entries()) if (!isObj(tm) || !isStr(tm.en, 200) || !isStr(tm.uk, 200) || (tm.alt !== undefined && (!Array.isArray(tm.alt) || tm.alt.length > 16 || !tm.alt.every(x => isStr(x, 200)))) || (tm.note !== undefined && !isStr(tm.note, 300))) { r.bad(`${w}.terms[${j}]`, t('потрібні «en» і «uk» (текст), «alt» — список, «note» — текст')); break; }
    }
    return [g as unknown as GlossaryContribution];
  });
}

/**
 * Read and check a manifest. A manifest is untrusted text: it is parsed here, every field is checked for its type, length and form, and what is not
 * known is left out (a warning, not an error, so a plugin written for a newer version of the format still loads with what this version understands).
 */
export function checkManifest(input: string | unknown, opts: { builtin?: boolean } = {}): Checked {
  const r = new Report();
  let j: unknown = input;
  if (typeof input === 'string') {
    if (input.length > LIMITS.manifestBytes) return { ok: false, errors: [t('Опис розширення завеликий')] };
    try { j = JSON.parse(input); } catch (e) { return { ok: false, errors: [t('Опис розширення не є JSON: {why}', { why: e instanceof Error ? e.message : '' })] }; }
  }
  if (!isObj(j)) return { ok: false, errors: [t('Опис розширення має бути об’єктом')] };
  const m = j;
  if (m.manifestVersion !== MANIFEST_VERSION) r.bad('manifestVersion', t('очікується {v}, а в розширенні {got}: воно написане для іншої версії застосунку', { v: MANIFEST_VERSION, got: String(m.manifestVersion) }));
  if (typeof m.id !== 'string' || m.id.length > LIMITS.id || !ID.test(m.id)) r.bad('id', t('має бути на кшталт «автор.назва»: малі латинські літери, цифри, «-», не менше двох частин через крапку'));
  else if (!opts.builtin && m.id.split('.')[0] === 'transly') r.bad('id', t('частина «transly» зарезервована для вбудованих розширень'));
  if (!isStr(m.name, LIMITS.name)) r.bad('name', t('потрібна назва до {n} знаків', { n: LIMITS.name }));
  if (typeof m.version !== 'string' || !parseVersion(m.version) || m.version.length > 40) r.bad('version', t('має бути версією на кшталт 1.2.3'));
  for (const k of ['description'] as const) if (m[k] !== undefined && !isStr(m[k])) r.bad(k, t('має бути рядком до {n} знаків', { n: LIMITS.text }));
  if (m.sourceLanguage !== undefined && (typeof m.sourceLanguage !== 'string' || !LANG.test(m.sourceLanguage))) r.bad('sourceLanguage', t('має бути кодом мови'));
  if (m.author !== undefined && !(isStr(m.author, LIMITS.name) || (isObj(m.author) && isStr(m.author.name, LIMITS.name) && (m.author.url === undefined || isHttps(m.author.url))))) r.bad('author', t('має бути ім’ям або {name, url} з https-адресою'));
  if (m.license !== undefined && !isStr(m.license, 80)) r.bad('license', t('має бути рядком'));
  if (m.homepage !== undefined && !isHttps(m.homepage)) r.bad('homepage', t('має бути https-адресою'));
  if (m.repository !== undefined && !(isHttps(m.repository) || (typeof m.repository === 'string' && /^[\w.-]{1,39}\/[\w.-]{1,100}$/.test(m.repository)))) r.bad('repository', t('має бути owner/repo або https-адресою'));
  if (m.keywords !== undefined && (!Array.isArray(m.keywords) || m.keywords.length > 16 || !m.keywords.every(k => isStr(k, 40)))) r.bad('keywords', t('до 16 коротких слів'));
  if (m.requires !== undefined) {
    if (!isObj(m.requires)) r.bad('requires', t('має бути об’єктом'));
    else for (const k of ['transly', 'api'] as const) if (m.requires[k] !== undefined && (typeof m.requires[k] !== 'string' || !validRange(m.requires[k] as string))) r.bad(`requires.${k}`, t('діапазон версій не розпізнано'));
  }
  if (m.dependencies !== undefined) {
    if (!isObj(m.dependencies) || Object.keys(m.dependencies).length > 16) r.bad('dependencies', t('має бути об’єктом (до 16 розширень)'));
    else for (const [id, range] of Object.entries(m.dependencies)) if (!ID.test(id) || typeof range !== 'string' || !validRange(range)) r.bad('dependencies', t('«{id}»: потрібні id розширення та діапазон версій', { id }));
  }
  let perms: PluginPermission[] = [];
  if (m.permissions !== undefined) {
    if (!Array.isArray(m.permissions) || m.permissions.length > PERMISSIONS.length || !m.permissions.every(p => PERMISSIONS.includes(p as PluginPermission))) r.bad('permissions', t('дозволи: {list}', { list: PERMISSIONS.join(', ') }));
    else perms = [...new Set(m.permissions as PluginPermission[])];
  }
  if (m.network !== undefined) {
    const h = isObj(m.network) ? m.network.hosts : null;
    if (!Array.isArray(h) || !h.length || h.length > 8 || !h.every(x => typeof x === 'string' && /^[a-z0-9]([a-z0-9.-]{0,120}[a-z0-9])?$/.test(x) && x.includes('.'))) r.bad('network', t('«hosts» — до 8 доменних імен'));
  }
  if (m.main !== undefined && !(safePath(m.main) && /\.m?js$/.test(m.main))) r.bad('main', t('має бути шляхом до .js усередині пакета'));
  if ((perms.includes('network') || m.network !== undefined) && m.main === undefined) r.bad('permissions', t('дозвіл «network» має сенс лише для розширення з кодом'));
  if (perms.includes('network') && m.network === undefined) r.bad('network', t('дозвіл «network» потребує переліку «hosts»'));
  const hasCode = m.main !== undefined;
  let contributes: Contributions = {};
  if (m.contributes !== undefined) {
    if (!isObj(m.contributes)) r.bad('contributes', t('має бути об’єктом'));
    else {
      const c = m.contributes;
      for (const k of Object.keys(c)) if (!['formats', 'engines', 'languages', 'help', 'settings', 'commands', 'qaRules', 'glossaries'].includes(k)) r.warn('contributes', t('«{k}» цій версії застосунку невідоме й буде пропущене', { k }));
      const f = formats(r, c.formats, hasCode, !!opts.builtin), helps = help(r, c.help);
      contributes = { formats: f, engines: engines(r, c.engines, new Set(f.map(x => x.id))), languages: languages(r, c.languages), help: helps, settings: settings(r, c.settings), commands: commands(r, c.commands, new Set(helps.map(x => x.id))), qaRules: qaRules(r, c.qaRules), glossaries: glossaries(r, c.glossaries) };
    }
  }
  if (m.files !== undefined) {
    if (!isObj(m.files) || Object.keys(m.files).length > LIMITS.files) r.bad('files', t('має бути об’єктом (до {n} файлів)', { n: LIMITS.files }));
    else for (const [p, h] of Object.entries(m.files)) if (!safePath(p) || typeof h !== 'string' || !SHA.test(h)) r.bad('files', t('«{p}»: потрібні безпечний шлях і sha256-<64 символи>', { p }));
  }
  if (!r.errors.length && hasCode && !opts.builtin && (!isObj(m.files) || !(m.main as string in (m.files as object)))) r.bad('files', t('розширення з кодом має мати контрольну суму файлу «main»'));
  if (!r.errors.length) {
    // every file a manifest points to must be in the package and its checksum must be listed
    const files = (m.files ?? {}) as Record<string, string>;
    // a built-in plugin's files are inside the application, so there is nothing to check them against
    if (!opts.builtin) for (const c of contributes.languages ?? []) for (const cat of c.catalogs) if (!(cat.file in files)) r.bad('files', t('файл «{p}» не має контрольної суми', { p: cat.file }));
    for (const g of contributes.glossaries ?? []) if (g.file && !(g.file in files)) r.bad('files', t('файл «{p}» не має контрольної суми', { p: g.file }));
    for (const h of contributes.help ?? []) if (h.file && !(h.file in files)) r.bad('files', t('файл «{p}» не має контрольної суми', { p: h.file }));
  }
  if (r.errors.length) return { ok: false, errors: r.errors };
  const manifest = { ...(m as unknown as PluginManifest), ...(m.contributes !== undefined ? { contributes } : {}), ...(perms.length ? { permissions: perms } : {}) };
  return { ok: true, manifest, warnings: r.warnings };
}

/** Whether a plugin may run in this version of the application: the range of the application and the range of the plugin API. */
export function compatibility(m: PluginManifest, app: string = APP_VERSION, api: string = API_VERSION): { ok: true } | { ok: false; reason: string } {
  if (m.requires?.transly && !satisfies(app, m.requires.transly)) return { ok: false, reason: t('Потрібен Transly {range}, а встановлено {app}', { range: m.requires.transly, app }) };
  if (m.requires?.api && !satisfies(api, m.requires.api)) return { ok: false, reason: t('Потрібен програмний інтерфейс {range}, а застосунок пропонує {api}', { range: m.requires.api, api }) };
  return { ok: true };
}

/** The author as a line of text. */
export const authorOf = (m: Pick<PluginManifest, 'author'>): string => (typeof m.author === 'string' ? m.author : m.author?.name ?? '');
