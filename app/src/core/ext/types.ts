import type { GameFile, Translations, Unit, UnitKind } from '../model';

/**
 * The public shape of a plugin. A plugin is a folder (or a zip) with a `transly-plugin.json` (the manifest) and the files the manifest names.
 * What a plugin brings is listed in `contributes`; the application reads the list, so it knows what a plugin offers before running anything of it.
 * Everything here is data: a plugin that has no code (`main`) can do nothing that the application's own code does not do.
 */

/** What a plugin that has code may ask for. A plugin with no code needs none of them. */
export type PluginPermission = 'network' | 'storage' | 'notify';
export const PERMISSIONS: readonly PluginPermission[] = ['network', 'storage', 'notify'];

/** `key=value` lines (a `.lang`, `.properties` or `.ini` file): every line with a separator is a row. */
export interface KeyValueSpec { type: 'keyvalue'; separator?: string; comments?: string[]; /** `\n` in a value is a line break. */ unescape?: boolean }
/** A table (CSV or TSV): the columns are named by the header or counted from 0. */
export interface TableSpec {
  type: 'table'; delimiter?: ',' | ';' | '\t' | 'auto'; header?: boolean;
  /** The column (or columns, joined with `:`) that tells one row from another. */
  key: string | number | (string | number)[]; source: string | number; target: string | number; speaker?: string | number; context?: string | number; kind?: UnitKind;
}
/** JSON: the values at `path` are the rows. The path is `a.b[0].c`, with `[*]` for every element of a list and `*` for every key of an object. */
export interface JsonSpec { type: 'json'; rules: { path: string; kind?: UnitKind; speaker?: string; context?: string }[] }
export type FormatSpec = KeyValueSpec | TableSpec | JsonSpec;

export interface FormatContribution {
  /** Local id, unique inside the plugin; the application calls it `<plugin id>/<id>`. */
  id: string;
  label: string;
  /** With the dot, lower case: `.lang`. */
  extensions: string[];
  /** Name patterns when the extension alone is too broad: `*.lang`, `data/*.json`. Without them every file with the extension is taken. */
  files?: string[];
  /** Whether the content is text (`true`) or JSON (`false`). */
  text: boolean;
  /** How to read and write the file, as data. A format without `spec` is handled by `handler` (a plugin with code). */
  spec?: FormatSpec;
  /** The name of the function of the plugin's code that handles the format. */
  handler?: string;
  /** Who is asked first when two formats take the same file (higher first; the built-in formats are 100 and above). Default 0. */
  priority?: number;
  /** The id of the help topic that explains this format. */
  help?: string;
}

/** How a game is told from the list of its files (lower case paths with `/`, relative to the picked folder). `*` is any characters in a name, `**` any folders. */
export interface EngineDetect { /** All of these must be there. */ files?: string[]; /** At least `min` (default 1) of these. */ anyFiles?: string[]; min?: number; /** None of these may be there. */ excludeFiles?: string[] }

export interface EngineContribution {
  id: string;
  label: string;
  description?: string;
  /** Local ids of the formats this engine uses. */
  formats?: string[];
  detect?: EngineDetect;
  /** Folders to prefer when a whole game is picked (`data`, `www/data`). */
  dataFolders?: string[];
  /** Names of the abilities the interface offers for this engine (`scenes`, `speakers`…). The built-in RPG Maker plugin lists its own; others may list their own names. */
  features?: string[];
  /** The id of the help topic about opening and translating a game of this engine. */
  help?: string;
}

export interface LanguageContribution {
  /** BCP 47: `en`, `pl`, `pt-BR`. */
  code: string;
  name: string;
  nativeName?: string;
  /** A gettext plural rule (`n != 1`); when missing, the rule of the language is taken from the catalog's header. */
  plural?: string;
  /** Languages to ask when a string is not in this one (`pt-BR` → `pt` is automatic). */
  fallback?: string[];
  /** The catalogs: `.po` or `.json` files. `context` limits the file to the strings of a plugin (`plugin:acme.wolf`); a `.po` with `msgctxt` carries its own. */
  catalogs: { file: string; context?: string }[];
}

export interface HelpContribution {
  id: string;
  title: string;
  /** Short text, or `file` for a longer one (Markdown-like: paragraphs, `- ` lists, `**bold**`, `` `code` ``, https links). */
  body?: string;
  file?: string;
  /** Where the topic is shown: `general` (the list of help topics), or `engine:<local id>` (in the guidance about that engine). */
  topic?: string;
  order?: number;
}

export interface SettingField {
  key: string;
  type: 'boolean' | 'string' | 'number' | 'select';
  label: string;
  description?: string;
  default?: string | number | boolean;
  options?: { value: string; label: string }[];
  min?: number; max?: number;
  /** `project`: kept in the project and shared with the other devices; `app` (default): kept on this device. */
  scope?: 'app' | 'project';
}
export interface SettingsContribution { id: string; title: string; description?: string; fields: SettingField[] }

/** A piece of text to look for. Never a regular expression: a pattern that can hang the program has no place in a plugin without code. */
export interface TextMatch { find: string; wholeWord?: boolean; caseSensitive?: boolean }

/** One step of a replacing command: every translation with `find` gets `replace` in its place. */
export interface ReplaceStep extends TextMatch { replace: string }

/**
 * A command of a plugin, in the menu «Інструменти → Розширення». `replace`: replacements in the translations of the whole project, with a preview and undo.
 * `help`: opens a help topic of the plugin. `link`: opens an https page.
 */
export interface CommandContribution {
  id: string;
  title: string;
  description?: string;
  action: 'replace' | 'help' | 'link';
  /** `replace`: the steps, made in order on every translation. */
  steps?: ReplaceStep[];
  /** `help`: the local id of one of the plugin's help topics. */
  help?: string;
  /** `link`: an https address. */
  url?: string;
}

/**
 * What a rule of QA checks, as data. `forbid`: the translation must not contain these (with a ready fix when `replace` is given). `require`: when the
 * original has `when`, the translation must have `then`. `maxLength`: the translation is not longer than `max` characters. `sameAsSource`: the
 * translation is not just the original.
 */
export type QaCheck =
  | { type: 'forbid'; items: (TextMatch & { replace?: string })[]; message?: string }
  | { type: 'require'; when: TextMatch; then: TextMatch; message?: string }
  | { type: 'maxLength'; max: number; message?: string }
  | { type: 'sameAsSource'; message?: string };

export interface QaRuleContribution {
  id: string;
  title: string;
  description?: string;
  /** The level when the project has not chosen one: an advice (default) or an error. The project can change it in «Правила QA». */
  severity?: 'warn' | 'bad';
  /** Only for rows of these kinds (`dialogue`, `name`…); every kind when missing. */
  kinds?: string[];
  check: QaCheck;
}

/** A list of terms the plugin brings, to be added to a project's glossary after the user has looked at it. */
export interface GlossaryContribution {
  id: string;
  title: string;
  description?: string;
  /** The terms themselves (a short list)… */
  terms?: { en: string; uk: string; alt?: string[]; note?: string }[];
  /** …or a file of the package: `.json` (a list of such objects) or `.tsv` (original, tab, translation, tab, alternatives with `;`). */
  file?: string;
}

export interface Contributions {
  formats?: FormatContribution[];
  engines?: EngineContribution[];
  languages?: LanguageContribution[];
  help?: HelpContribution[];
  settings?: SettingsContribution[];
  commands?: CommandContribution[];
  qaRules?: QaRuleContribution[];
  glossaries?: GlossaryContribution[];
}

export interface PluginManifest {
  /** The version of the manifest format. */
  manifestVersion: number;
  /** `author.name`: lower case letters, digits and `-`, at least two parts separated by dots. The part `transly` is the application's own. */
  id: string;
  name: string;
  version: string;
  description?: string;
  /** The language of the strings the plugin writes itself (names, descriptions, help, settings); `en` when missing. Packs translate from it. */
  sourceLanguage?: string;
  author?: string | { name: string; url?: string };
  license?: string;
  homepage?: string;
  /** `owner/repo` on GitHub, or an https address. Where updates are looked for. */
  repository?: string;
  keywords?: string[];
  requires?: { transly?: string; api?: string };
  dependencies?: Record<string, string>;
  permissions?: PluginPermission[];
  /** The hosts a plugin with `network` may reach (the application makes the request for it). */
  network?: { hosts: string[] };
  /** The file with the code of the plugin (a script). Without it the plugin is data only. */
  main?: string;
  contributes?: Contributions;
  /** The files of the package with their SHA-256 (`sha256-<hex>`); every file that is installed must be listed and must match. */
  files?: Record<string, string>;
}

/** Where a plugin stands in the application. */
export type PluginState = 'enabled' | 'disabled' | 'incompatible' | 'missing-dependency' | 'error';

export interface ExtractContext { pluginCommands?: string[]; settings?: Record<string, unknown> }

/** What the application keeps for a format that is switched on: the handler that reads and writes a kind of file. */
export interface FormatHandler {
  /** Unique over the application: `rpgmaker` for the built-in ones, `<plugin id>/<local id>` for the others. */
  id: string;
  plugin: string;
  label: string;
  extensions: string[];
  text: boolean;
  priority: number;
  help?: string;
  matches(file: { name: string }): boolean;
  extract(file: GameFile, ctx: ExtractContext): Unit[];
  apply(file: GameFile, tr: Translations, ctx: ExtractContext): unknown;
}
