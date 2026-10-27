import type { GameFile, Translations, Unit } from './model';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
interface Cmd { code: number; indent: number; parameters: Json[] }
interface Page { list: Cmd[] }
interface MapEvent { id: number; name: string; pages: Page[] }

const isObj = (v: unknown): v is Record<string, Json> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';

/** Database files and the string fields worth translating in each. */
const DB_FIELDS: Record<string, string[]> = {
  'Actors.json': ['name', 'nickname', 'profile'],
  'Armors.json': ['name', 'description'],
  'Classes.json': ['name'],
  'Enemies.json': ['name'],
  'Items.json': ['name', 'description'],
  'Skills.json': ['name', 'description', 'message1', 'message2'],
  'States.json': ['name', 'message1', 'message2', 'message3', 'message4'],
  'Weapons.json': ['name', 'description'],
};
const DB_KIND: Record<string, Unit['kind']> = { name: 'name', nickname: 'name', description: 'description', profile: 'description' };

/** Does this look like one of RPG Maker MV/MZ's data files? */
export const isRpgMakerFile = (name: string): boolean => /^Map\d+\.json$/.test(name) || name === 'CommonEvents.json' || name === 'Troops.json' || name === 'System.json' || name in DB_FIELDS;

const isMap = (name: string) => /^Map\d+\.json$/.test(name);
const isCommonEvents = (name: string) => name === 'CommonEvents.json';
const isTroops = (name: string) => name === 'Troops.json';
const isSystem = (name: string) => name === 'System.json';

/** System.json: plain string arrays plus the `terms` dictionaries. */
const SYSTEM_ARRAYS = ['elements', 'skillTypes', 'weaponTypes', 'armorTypes', 'equipTypes'] as const;
const SYSTEM_TERMS = ['basic', 'commands', 'params'] as const;

/** Strings with no letters (`\p[1]`, `...`, `---`) need no translation and only add noise. */
export const hasText = (source: string): boolean => /\p{L}/u.test(source.replace(/\\[A-Za-z]+\[\d+\]|\\[{}.|!><^$]/g, ''));

/** Extract every translatable unit from one game file. Unknown files yield no units. */
export function extractRpgMaker(file: GameFile): Unit[] {
  return extractAll(file).filter(u => hasText(u.source));
}

function extractAll(file: GameFile): Unit[] {
  if (isMap(file.name)) return extractMap(file.json);
  if (isCommonEvents(file.name)) return extractCommon(file.json);
  if (isTroops(file.name)) return extractTroops(file.json);
  if (isSystem(file.name)) return extractSystem(file.json);
  const fields = DB_FIELDS[file.name];
  if (fields) return extractDb(file.json, fields);
  return [];
}

function extractMap(json: unknown): Unit[] {
  if (!isObj(json) || !Array.isArray(json.events)) return [];
  const out: Unit[] = [];
  if (isStr(json.displayName) && json.displayName) out.push({ key: 'displayName', source: json.displayName, speaker: '', kind: 'name', context: 'Назва місцевості' });
  json.events.forEach((ev, ei) => {
    if (!isObj(ev) || !Array.isArray(ev.pages)) return;
    const evName = isStr(ev.name) ? ev.name : '';
    const evId = typeof ev.id === 'number' ? ev.id : ei;
    ev.pages.forEach((page, pi) => {
      if (!isObj(page) || !Array.isArray(page.list)) return;
      out.push(...extractList(page.list as unknown as Cmd[], `events[${ei}].pages[${pi}].list`, `EV${String(evId).padStart(3, '0')}${evName ? ' · ' + evName : ''}`, evName));
    });
  });
  return out;
}

function extractCommon(json: unknown): Unit[] {
  if (!Array.isArray(json)) return [];
  const out: Unit[] = [];
  json.forEach((ev, i) => {
    if (!isObj(ev) || !Array.isArray(ev.list)) return;
    out.push(...extractList(ev.list as unknown as Cmd[], `[${i}].list`, `Common ${i}${isStr(ev.name) && ev.name ? ' · ' + ev.name : ''}`, isStr(ev.name) ? ev.name : ''));
  });
  return out;
}

function extractTroops(json: unknown): Unit[] {
  if (!Array.isArray(json)) return [];
  const out: Unit[] = [];
  json.forEach((t, i) => {
    if (!isObj(t) || !Array.isArray(t.pages)) return;
    t.pages.forEach((page, pi) => {
      if (isObj(page) && Array.isArray(page.list)) out.push(...extractList(page.list as unknown as Cmd[], `[${i}].pages[${pi}].list`, `Бій ${i}${isStr(t.name) && t.name ? ' · ' + t.name : ''}`));
    });
  });
  return out;
}

function extractSystem(json: unknown): Unit[] {
  if (!isObj(json)) return [];
  const out: Unit[] = [];
  const add = (key: string, v: unknown, context: string) => { if (isStr(v) && v) out.push({ key, source: v, speaker: '', kind: 'term', context }); };
  add('gameTitle', json.gameTitle, 'Назва гри');
  add('currencyUnit', json.currencyUnit, 'Валюта');
  for (const name of SYSTEM_ARRAYS) {
    const arr = json[name];
    if (Array.isArray(arr)) arr.forEach((v, i) => add(`${name}[${i}]`, v, name));
  }
  const terms = isObj(json.terms) ? json.terms : null;
  if (terms) {
    for (const name of SYSTEM_TERMS) {
      const arr = terms[name];
      if (Array.isArray(arr)) arr.forEach((v, i) => add(`terms.${name}[${i}]`, v, `terms.${name}`));
    }
    if (isObj(terms.messages)) for (const [k, v] of Object.entries(terms.messages)) add(`terms.messages.${k}`, v, 'terms.messages');
  }
  return out;
}

function extractList(list: Cmd[], base: string, context: string, evName = ''): Unit[] {
  const out: Unit[] = [];
  for (let i = 0; i < list.length; i++) {
    const c = list[i];
    if (!c) continue;
    if (c.code === 101) {
      const { lines } = textRun(list, i + 1, 401);
      if (lines.length) {
        const speaker = isStr(c.parameters[4]) ? c.parameters[4] : '';
        const face = isStr(c.parameters[0]) && c.parameters[0] ? `${c.parameters[0]}#${typeof c.parameters[1] === 'number' ? c.parameters[1] : 0}` : '';
        out.push({ key: `${base}[${i}]`, source: lines.join('\n'), speaker, kind: 'dialogue', context, ...(face ? { face } : {}), ...(evName ? { event: evName } : {}) });
      }
    } else if (c.code === 105) {
      const { lines } = textRun(list, i + 1, 405);
      if (lines.length) out.push({ key: `${base}[${i}]`, source: lines.join('\n'), speaker: '', kind: 'scroll', context });
    } else if (c.code === 102 && Array.isArray(c.parameters[0])) {
      (c.parameters[0] as Json[]).forEach((opt, oi) => {
        if (isStr(opt) && opt) out.push({ key: `${base}[${i}].choice[${oi}]`, source: opt, speaker: '', kind: 'choice', context });
      });
    }
  }
  return out;
}

/** Collect the continuation lines (401 / 405) that follow a text header command. */
function textRun(list: Cmd[], from: number, code: number): { lines: string[]; end: number } {
  const lines: string[] = [];
  let i = from;
  while (list[i] && list[i]!.code === code) {
    const p = list[i]!.parameters[0];
    lines.push(isStr(p) ? p : '');
    i++;
  }
  return { lines, end: i };
}

function extractDb(json: unknown, fields: string[]): Unit[] {
  if (!Array.isArray(json)) return [];
  const out: Unit[] = [];
  json.forEach((row, i) => {
    if (!isObj(row)) return;
    const label = isStr(row.name) && row.name ? row.name : `#${i}`;
    for (const f of fields) {
      const v = row[f];
      if (isStr(v) && v) out.push({ key: `[${i}].${f}`, source: v, speaker: '', kind: DB_KIND[f] ?? 'message', context: label });
    }
  });
  return out;
}

/**
 * Return a deep copy of the file with translated units written back.
 * Units without a non-empty translation are left untouched.
 */
export function applyRpgMaker(file: GameFile, translations: Translations): unknown {
  const copy = structuredClone(file.json) as Json;
  const get = (key: string) => {
    const t = translations[key]?.target;
    return t && t.trim() ? t : null;
  };
  if (isMap(file.name) && isObj(copy) && Array.isArray(copy.events)) {
    const dn = get('displayName');
    if (dn !== null) copy.displayName = dn;
    copy.events.forEach((ev, ei) => {
      if (!isObj(ev) || !Array.isArray(ev.pages)) return;
      ev.pages.forEach((page, pi) => {
        if (isObj(page) && Array.isArray(page.list)) applyList(page.list as unknown as Cmd[], `events[${ei}].pages[${pi}].list`, get);
      });
    });
  } else if (isCommonEvents(file.name) && Array.isArray(copy)) {
    copy.forEach((ev, i) => {
      if (isObj(ev) && Array.isArray(ev.list)) applyList(ev.list as unknown as Cmd[], `[${i}].list`, get);
    });
  } else if (isTroops(file.name) && Array.isArray(copy)) {
    copy.forEach((t, i) => {
      if (!isObj(t) || !Array.isArray(t.pages)) return;
      t.pages.forEach((page, pi) => {
        if (isObj(page) && Array.isArray(page.list)) applyList(page.list as unknown as Cmd[], `[${i}].pages[${pi}].list`, get);
      });
    });
  } else if (isSystem(file.name) && isObj(copy)) {
    const put = (key: string, set: (v: string) => void) => { const t = get(key); if (t !== null) set(t); };
    put('gameTitle', v => { copy.gameTitle = v; });
    put('currencyUnit', v => { copy.currencyUnit = v; });
    for (const name of SYSTEM_ARRAYS) {
      const arr = copy[name];
      if (Array.isArray(arr)) arr.forEach((_, i) => put(`${name}[${i}]`, v => { arr[i] = v; }));
    }
    const terms = isObj(copy.terms) ? copy.terms : null;
    if (terms) {
      for (const name of SYSTEM_TERMS) {
        const arr = terms[name];
        if (Array.isArray(arr)) arr.forEach((_, i) => put(`terms.${name}[${i}]`, v => { arr[i] = v; }));
      }
      const msg = terms.messages;
      if (isObj(msg)) for (const k of Object.keys(msg)) put(`terms.messages.${k}`, v => { msg[k] = v; });
    }
  } else if (DB_FIELDS[file.name] && Array.isArray(copy)) {
    copy.forEach((row, i) => {
      if (!isObj(row)) return;
      for (const f of DB_FIELDS[file.name]!) {
        const t = get(`[${i}].${f}`);
        if (t !== null && isStr(row[f])) row[f] = t;
      }
    });
  }
  return copy;
}

function applyList(list: Cmd[], base: string, get: (key: string) => string | null): void {
  // Walk backwards so splicing continuation lines never shifts indices still to be visited.
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i];
    if (!c) continue;
    if (c.code === 101 || c.code === 105) {
      const t = get(`${base}[${i}]`);
      if (t === null) continue;
      const cont = c.code === 101 ? 401 : 405;
      const { end } = textRun(list, i + 1, cont);
      const indent = c.indent;
      const lines = t.split('\n').map((line): Cmd => ({ code: cont, indent, parameters: [line] }));
      list.splice(i + 1, end - (i + 1), ...lines);
    } else if (c.code === 102 && Array.isArray(c.parameters[0])) {
      const opts = c.parameters[0] as Json[];
      opts.forEach((_, oi) => {
        const t = get(`${base}[${i}].choice[${oi}]`);
        if (t !== null) opts[oi] = t;
      });
    }
  }
}
