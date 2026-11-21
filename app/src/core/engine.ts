import type { GameFile, Translations, Unit } from './model';
import { plugins, t } from './ext';
import { cleanUnits } from './ext/units';
import type { ExtractContext } from './ext';

/** The id of a format: `rpgmaker`, `gettext`… for the built-in ones, `<plugin id>/<format id>` for the formats of the installed plugins. */
export type FormatId = string;

export interface FormatInfo { id: FormatId; label: string; extensions: string[] }

/** The formats the application reads now (the ones of the plugins that are switched on), the first asked first. */
export const formatInfos = (): FormatInfo[] => plugins.formats().map(h => ({ id: h.id, label: h.label, extensions: h.extensions }));

/** File extensions the app can read at all, now. */
export const readableExtensions = (): string[] => plugins.extensions();

/** Which format handles this file, or null when it has no translatable text for us. */
export function formatOf(file: Pick<GameFile, 'name'>): FormatId | null {
  return plugins.handlerOf(file)?.id ?? null;
}

/** Text formats carry their content in `text`; JSON formats in `json`. */
export const isTextFormat = (id: FormatId | null): boolean => plugins.handler(id)?.text ?? false;

/** Extract every translatable unit from one file. Unknown files yield no units; a plugin that fails yields none either (and the failure is recorded against it). */
export function extract(file: GameFile, opts: ExtractContext = {}): Unit[] {
  const h = plugins.handlerOf(file);
  if (!h) return [];
  return plugins.guard(h, t('читання файлу «{name}»', { name: file.name }), () => (plugins.isBuiltinHandler(h) ? h.extract(file, opts) : cleanUnits(h.extract(file, opts))), () => []);
}

/** Translated copy of the file: parsed JSON for JSON formats, a string for text formats. The input is never changed. */
export function apply(file: GameFile, tr: Translations): unknown {
  const h = plugins.handlerOf(file);
  if (!h) return file.json;
  // a plugin that cannot write the file must not hand back the original as if it were translated: the failure stops the build
  return plugins.guard(h, t('запис файлу «{name}»', { name: file.name }), () => h.apply(file, tr, {}), () => { throw new Error(t('Розширення «{name}» не змогло записати файл «{file}»', { name: plugins.get(h.plugin)?.manifest.name ?? h.plugin, file: file.name })); });
}
