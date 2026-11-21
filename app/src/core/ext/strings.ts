import type { PluginManifest } from './types';

/**
 * The strings a plugin shows to the user, gathered from its manifest and help files: what a translator needs to translate it into another language
 * (the plugin's own strings live in the context `plugin:<id>`, and a language pack may translate them without the plugin's author doing anything).
 */
export function pluginStrings(m: PluginManifest, read: (path: string) => string | undefined): string[] {
  const out = new Set<string>();
  const add = (s: unknown): void => { if (typeof s === 'string' && s.trim()) out.add(s); };
  add(m.name); add(m.description);
  const c = m.contributes ?? {};
  for (const f of c.formats ?? []) add(f.label);
  for (const e of c.engines ?? []) { add(e.label); add(e.description); }
  for (const h of c.help ?? []) { add(h.title); add(h.body ?? (h.file ? read(h.file) : undefined)); }
  for (const s of c.settings ?? []) {
    add(s.title); add(s.description);
    for (const f of s.fields) { add(f.label); add(f.description); for (const o of f.options ?? []) add(o.label); }
  }
  return [...out];
}

/** The `.po` template of a plugin's strings, to be translated into `lang`. */
export function pluginTemplate(m: PluginManifest, lang: string, read: (path: string) => string | undefined): string {
  const q = (s: string): string => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t') + '"';
  const head = `msgid ""\nmsgstr ""\n"Content-Type: text/plain; charset=UTF-8\\n"\n"Language: ${lang}\\n"\n"Plural-Forms: nplurals=2; plural=(n != 1);\\n"\n"X-Source-Language: ${m.sourceLanguage ?? 'en'}\\n"\n"X-Plugin: ${m.id} ${m.version}\\n"\n`;
  return head + pluginStrings(m, read).map(s => `\nmsgctxt ${q(`plugin:${m.id}`)}\nmsgid ${q(s)}\nmsgstr ""\n`).join('');
}
