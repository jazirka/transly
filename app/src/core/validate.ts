import { knownStatus } from './model';

/**
 * A project that comes from storage, a file, a sync or another device is not trusted: one entry with a wrong type used to
 * make every later launch fail ("t.trim is not a function"), and strings from it end up in the page. `repairProject` makes
 * the parsed object well-typed in place (it is freshly parsed, so nobody else holds it) and says what it had to touch;
 * `clampClock` stops clocks from the future (a device with a fast clock) from outranking every honest edit.
 */

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const strs = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');

interface Counts { entries: number; dropped: number; settings: number; other: number }

function repairComments(raw: Record<string, unknown>, n: Counts): void {
  if (!('comments' in raw)) return;
  if (!Array.isArray(raw.comments)) { delete raw.comments; n.entries++; return; }
  const ok = raw.comments.filter((c): c is Record<string, unknown> => isObj(c) && num(c.at) && typeof c.text === 'string');
  if (ok.length !== raw.comments.length) { raw.comments = ok; n.dropped++; }
  for (const c of ok) {
    if (typeof c.who !== 'string') c.who = '';
    for (const k of ['id', 're']) if (k in c && typeof c[k] !== 'string') delete c[k];
    if ('ed' in c && !num(c.ed)) delete c.ed;
    if ('del' in c && typeof c.del !== 'boolean') delete c.del;
    if ('res' in c && !(isObj(c.res) && num(c.res.at) && typeof c.res.who === 'string')) delete c.res;
  }
}

function repairHistory(raw: Record<string, unknown>, n: Counts): void {
  if (!('history' in raw)) return;
  if (!Array.isArray(raw.history)) { delete raw.history; n.entries++; return; }
  const ok = raw.history.filter((h): h is Record<string, unknown> => isObj(h) && num(h.at) && typeof h.text === 'string' && typeof h.what === 'string');
  if (ok.length !== raw.history.length) { raw.history = ok; n.dropped++; }
  for (const h of ok) {
    if (typeof h.who !== 'string') h.who = '';
    if ('batch' in h && typeof h.batch !== 'string') delete h.batch;
    if ('prev' in h) {
      const p = h.prev;
      if (!(isObj(p) && typeof p.target === 'string')) delete h.prev;
      else { if (knownStatus(p.status) !== p.status) p.status = 'new'; if ('returned' in p && typeof p.returned !== 'boolean') delete p.returned; }
    }
  }
}

/** One row: wrong types are fixed when the meaning is clear (a number as text), otherwise the row is dropped. */
function repairEntry(raw: unknown, n: Counts): Record<string, unknown> | null {
  if (!isObj(raw)) { n.dropped++; return null; }
  let touched = false;
  if (typeof raw.target !== 'string') {
    if (typeof raw.target === 'number' || typeof raw.target === 'boolean') { raw.target = String(raw.target); touched = true; }
    else { n.dropped++; return null; }
  }
  if (knownStatus(raw.status) !== raw.status) { raw.status = raw.target ? 'draft' : 'new'; touched = true; }
  if (!num(raw.mt)) { raw.mt = 0; touched = true; }
  for (const k of ['src', 'orig']) if (k in raw && typeof raw[k] !== 'string') { delete raw[k]; touched = true; }
  if ('returned' in raw && typeof raw.returned !== 'boolean') { delete raw.returned; touched = true; }
  if ('ign' in raw && !strs(raw.ign)) { delete raw.ign; touched = true; }
  if ('ignAt' in raw && !num(raw.ignAt)) { delete raw.ignAt; touched = true; }
  repairComments(raw, n); repairHistory(raw, n);
  if (touched) n.entries++;
  return raw;
}

function repairSettings(raw: unknown, n: Counts): void {
  if (!isObj(raw)) return;
  const fix = (k: string, ok: (v: unknown) => boolean): void => { if (k in raw && !ok(raw[k])) { delete raw[k]; n.settings++; } };
  fix('tolerancePct', num); fix('who', v => typeof v === 'string'); fix('blockErrors', v => typeof v === 'boolean');
  fix('propagate', v => typeof v === 'boolean'); fix('pluginCommands', strs); fix('pluginsAsked', v => typeof v === 'boolean');
  fix('lineLimit', num); fix('linkMode', v => v === 'off' || v === 'ask' || v === 'auto');
  fix('wrap', isObj); fix('qa', isObj);
}

/**
 * Make a parsed project well-typed, in place. Returns short Ukrainian notes about what was fixed or dropped (empty when
 * nothing was wrong). Unknown top-level fields are left alone (they belong to a newer version).
 */
export function repairProject(o: Record<string, unknown>): string[] {
  const n: Counts = { entries: 0, dropped: 0, settings: 0, other: 0 };
  for (const k of ['resetEpoch', 'settingsAt', 'assetsRev']) if (k in o && !num(o[k])) { if (k === 'resetEpoch') o[k] = 0; else delete o[k]; n.other++; }
  if (isObj(o.files)) {
    for (const [name, f] of Object.entries(o.files)) {
      if (!isObj(f)) { delete o.files[name]; n.dropped++; continue; }
      for (const [key, e] of Object.entries(f)) if (!repairEntry(e, n)) delete f[key];
    }
  }
  if ('settings' in o && !isObj(o.settings)) { delete o.settings; n.settings++; }
  repairSettings(o.settings, n);
  if ('memory' in o) {
    if (!Array.isArray(o.memory)) { o.memory = []; n.other++; }
    else {
      const ok = (o.memory as unknown[]).filter((m): m is Record<string, unknown> => isObj(m) && typeof m.s === 'string' && typeof m.t === 'string');
      if (ok.length !== o.memory.length) { o.memory = ok; n.dropped += (o.memory as unknown[]).length - ok.length || 1; }
      for (const m of ok) if (!num(m.mt)) m.mt = 0;
    }
  }
  if ('terms' in o) {
    if (!Array.isArray(o.terms)) { o.terms = []; n.other++; }
    else {
      const all = o.terms as unknown[];
      const ok = all.filter((t): t is Record<string, unknown> => isObj(t) && typeof t.en === 'string' && typeof t.uk === 'string');
      if (ok.length !== all.length) { o.terms = ok; n.dropped += all.length - ok.length; }
      for (const t of ok) { if (!num(t.mt)) t.mt = 0; if ('alt' in t && !strs(t.alt)) delete t.alt; if ('qa' in t && typeof t.qa !== 'boolean') delete t.qa; }
    }
  }
  const record = (k: string, ok: (v: Record<string, unknown>) => boolean, fixItem?: (v: Record<string, unknown>, id: string) => void): void => {
    const r = o[k];
    if (r === undefined) return;
    if (!isObj(r)) { delete o[k]; n.other++; return; }
    for (const [id, v] of Object.entries(r)) { if (!(isObj(v) && ok(v))) { delete r[id]; n.dropped++; } else fixItem?.(v, id); }
  };
  record('speakers', v => typeof v.name === 'string' && num(v.mt));
  record('groups', v => typeof v.name === 'string' && num(v.mt), (v, id) => {
    if (typeof v.id !== 'string') v.id = id;
    if (!num(v.at)) v.at = v.mt;
    // a colour is put into a style attribute: only plain hex colours are kept
    if ('color' in v && !(typeof v.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.color))) { delete v.color; n.other++; }
  });
  record('members', v => typeof v.g === 'string' && num(v.mt));
  if (isObj(o.deletedTerms)) { for (const [k, t] of Object.entries(o.deletedTerms)) if (!num(t)) delete o.deletedTerms[k]; } else if ('deletedTerms' in o) delete o.deletedTerms;
  if (isObj(o.snapshot)) {
    for (const [name, units] of Object.entries(o.snapshot)) {
      if (!Array.isArray(units)) { delete o.snapshot[name]; n.dropped++; continue; }
      const ok = units.filter(u => isObj(u) && typeof u.key === 'string' && typeof u.source === 'string');
      if (ok.length !== units.length) { o.snapshot[name] = ok; n.dropped += units.length - ok.length; }
    }
  } else if ('snapshot' in o) { delete o.snapshot; n.other++; }
  const notes: string[] = [];
  if (n.entries) notes.push(`виправлено рядків із неправильними даними: ${n.entries}`);
  if (n.dropped) notes.push(`відкинуто непридатних записів: ${n.dropped}`);
  if (n.settings) notes.push(`скинуто неправильних налаштувань: ${n.settings}`);
  if (n.other) notes.push(`виправлено інших полів: ${n.other}`);
  return notes;
}

/** How far ahead of this device's clock a time stamp may be before it is not believed (a wrong clock on another device). */
export const MAX_AHEAD_MS = 24 * 3600 * 1000;

/**
 * Pull time stamps that lie more than a day in the future back to `now`. Without it a device with a fast clock wins every
 * merge from then on, and its "reset" (stamped in the future) wipes edits other devices make afterwards. Returns how many
 * stamps were pulled back. Only for data that comes in; merging itself never reads the clock.
 */
export function clampClock(o: Record<string, unknown>, now: number, ahead = MAX_AHEAD_MS): number {
  const limit = now + ahead;
  let n = 0;
  const fix = (r: Record<string, unknown>, k: string): void => { const v = r[k]; if (typeof v === 'number' && v > limit) { r[k] = now; n++; } };
  for (const k of ['resetEpoch', 'settingsAt', 'assetsRev']) fix(o, k);
  if (isObj(o.files)) {
    for (const f of Object.values(o.files)) {
      if (!isObj(f)) continue;
      for (const e of Object.values(f)) {
        if (!isObj(e)) continue;
        fix(e, 'mt'); fix(e, 'ignAt');
        if (Array.isArray(e.comments)) for (const c of e.comments) if (isObj(c)) { fix(c, 'at'); fix(c, 'ed'); if (isObj(c.res)) fix(c.res, 'at'); }
        if (Array.isArray(e.history)) for (const h of e.history) if (isObj(h)) fix(h, 'at');
      }
    }
  }
  for (const list of [o.memory, o.terms]) if (Array.isArray(list)) for (const v of list) if (isObj(v)) fix(v, 'mt');
  for (const k of ['speakers', 'groups', 'members']) { const r = o[k]; if (isObj(r)) for (const v of Object.values(r)) if (isObj(v)) { fix(v, 'mt'); fix(v, 'at'); } }
  if (isObj(o.deletedTerms)) for (const k of Object.keys(o.deletedTerms)) fix(o.deletedTerms, k);
  return n;
}
