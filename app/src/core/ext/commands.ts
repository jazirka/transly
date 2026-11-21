import { literalPattern } from '../findreplace';
import type { FindMatch } from '../findreplace';
import type { FileView, SavedProject } from '../project';
import { i18n } from './i18n';
import type { PluginRecord } from './registry';
import { qualified } from './registry';
import type { CommandContribution, ReplaceStep } from './types';

/** A command of a working plugin, ready for a menu: its title is already in the language of the interface. */
export interface PluginCommand {
  /** `<plugin id>/<id>`: what the application calls it. */
  ref: string;
  plugin: string;
  pluginName: string;
  title: string;
  description?: string;
  action: CommandContribution['action'];
  steps?: ReplaceStep[];
  /** `help`: the id the registry knows the topic by (`<plugin>:<id>`). */
  help?: string;
  url?: string;
}

const tr = (rec: Pick<PluginRecord, 'manifest' | 'builtin'>, s: string): string => i18n.t(s, undefined, rec.builtin ? 'core' : `plugin:${rec.manifest.id}`);

/** The commands of every working plugin, in the order the plugins were added. */
export function pluginCommands(recs: readonly PluginRecord[]): PluginCommand[] {
  return recs.filter(r => r.state === 'enabled').flatMap(r => (r.manifest.contributes?.commands ?? []).map((c): PluginCommand => ({
    ref: qualified(r, c.id), plugin: r.manifest.id, pluginName: tr(r, r.manifest.name), title: tr(r, c.title), ...(c.description ? { description: tr(r, c.description) } : {}),
    action: c.action, ...(c.steps ? { steps: c.steps } : {}), ...(c.help ? { help: `${r.manifest.id}:${c.help}` } : {}), ...(c.url ? { url: c.url } : {}),
  })));
}

/** One text after all the steps of a replacing command, in order. */
export function runSteps(text: string, steps: readonly ReplaceStep[]): { after: string; count: number } {
  let after = text, count = 0;
  for (const st of steps) {
    if (!st.find) continue;
    after = after.replace(literalPattern(st.find, st.wholeWord === true, st.caseSensitive === true), () => { count++; return st.replace; });
  }
  return { after, count };
}

/** The translations a replacing command would change, with what each would become. Nothing is changed here. */
export function planSteps(views: FileView[], saved: SavedProject, steps: readonly ReplaceStep[], limit = 2000): FindMatch[] {
  const out: FindMatch[] = [];
  for (const v of views) {
    const ents = saved.files[v.name];
    if (!ents) continue;
    for (const u of v.units) {
      const t = ents[u.key]?.target;
      if (!t) continue;
      const { after, count } = runSteps(t, steps);
      if (count && after !== t) { out.push({ file: v.name, key: u.key, source: u.source, before: t, after, count }); if (out.length >= limit) return out; }
    }
  }
  return out;
}
