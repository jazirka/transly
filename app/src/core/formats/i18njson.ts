import type { Translations, Unit } from '../model';
import { hasText } from '../rpgmaker';

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
const isObj = (v: unknown): v is { [k: string]: Json } => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Names that usually hold UI strings or dialogue (en.json, locales/uk.json, strings.json, i18n/messages.json). */
export const looksLikeLocaleFile = (name: string): boolean =>
  /(^|[\\/._-])(en|uk|ru|de|fr|es|lang|languages?|locales?|i18n|strings?|texts?|translations?|messages?|dialog(ue)?s?)([\\/._-]|$)/i.test(name) &&
  !/^(package(-lock)?|tsconfig|composer|manifest)\.json$/i.test(name.split(/[\\/]/).pop() ?? '');

export function extractLocaleJson(json: unknown): Unit[] {
  const out: Unit[] = [];
  const walk = (v: Json, path: string, ctx: string) => {
    if (typeof v === 'string') { if (hasText(v)) out.push({ key: path, source: v, speaker: '', kind: 'message', context: ctx }); }
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`, ctx));
    else if (isObj(v)) for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, path ? path : k);
  };
  walk(json as Json, '', '');
  return out;
}

export function applyLocaleJson(json: unknown, tr: Translations): unknown {
  const copy = structuredClone(json) as Json;
  const walk = (v: Json, path: string): Json => {
    if (typeof v === 'string') { const t = tr[path]?.target; return t && t.trim() ? t : v; }
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`));
    if (isObj(v)) { const o: { [k: string]: Json } = {}; for (const [k, x] of Object.entries(v)) o[k] = walk(x, path ? `${path}.${k}` : k); return o; }
    return v;
  };
  return walk(copy, '');
}
