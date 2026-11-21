import { applyCsv, extractCsv } from '../formats/csv';
import { applyLocaleJson, extractLocaleJson, looksLikeLocaleFile } from '../formats/i18njson';
import { applyPo, extractPo } from '../formats/po';
import { applyRenpy, extractRenpy } from '../formats/renpy';
import type { GameFile } from '../model';
import { applyRpgMaker, extractRpgMaker, isRpgMakerFile } from '../rpgmaker';
import { checkManifest } from './manifest';
import { PluginRegistry } from './registry';
import type { PluginRecord } from './registry';
import type { FormatHandler, PluginManifest } from './types';
import { APP_VERSION } from './version';

/**
 * The plugins that come with the application and work from the first start: what the program could always do, now offered through the same door as
 * any other plugin. Their code is the code that was here before (nothing is rewritten): each handler only says which files it takes and calls it.
 */

const base = (name: string): string => name.split(/[\\/]/).pop() ?? name;
const ext = (name: string): string => /\.[^./\\]+$/.exec(name)?.[0].toLowerCase() ?? '';

const manifest = (m: Omit<PluginManifest, 'manifestVersion' | 'version' | 'author' | 'license'>): PluginManifest => {
  const r = checkManifest({ manifestVersion: 1, version: APP_VERSION, author: 'Transly', license: 'MIT', sourceLanguage: 'uk', ...m }, { builtin: true });
  if (!r.ok) throw new Error(`built-in plugin ${m.id}: ${r.errors.join('; ')}`);
  return r.manifest;
};

const handler = (plugin: string, h: Omit<FormatHandler, 'plugin'>): FormatHandler => ({ plugin, ...h });

export const RPGMAKER_ID = 'transly.rpgmaker';
export const TEXT_FORMATS_ID = 'transly.text-formats';

/** The abilities the interface offers for a game of RPG Maker (the names are used by the places that check them). */
export const RPGMAKER_FEATURES = ['scenes', 'play-scene', 'speakers', 'plugin-texts', 'game-window', 'game-images', 'game-names'] as const;

export function rpgMakerPlugin(): Pick<PluginRecord, 'manifest' | 'handlers'> {
  const m = manifest({
    id: RPGMAKER_ID, name: 'RPG Maker MV / MZ',
    description: 'Ігри на RPG Maker MV і MZ: діалоги, вибори, бази даних, події мап, сцени, запуск гри на потрібній сцені, мовці, тексти з плагінів гри.',
    contributes: {
      formats: [{ id: 'rpgmaker', label: 'RPG Maker MV/MZ (data/*.json)', extensions: ['.json'], text: false, handler: 'rpgmaker', priority: 100, help: 'rpgmaker-open' }],
      engines: [{
        id: 'rpgmaker', label: 'RPG Maker MV / MZ', formats: ['rpgmaker'], dataFolders: ['data', 'www/data'], features: [...RPGMAKER_FEATURES], help: 'rpgmaker-open',
        description: 'Файли гри лежать у папці data (для MV часто www/data): Map001.json, System.json, Actors.json…',
        detect: { anyFiles: ['**/system.json', '**/mapinfos.json', '**/actors.json', '**/commonevents.json', '**/map001.json'], min: 2 },
      }],
      help: [{ id: 'rpgmaker-open', topic: 'engine:rpgmaker', title: 'Як відкрити гру на RPG Maker', body: 'Оберіть папку гри (там, де лежить Game.exe), а не окремий файл.\n\n- Для MV файли лежать у `www/data`, для MZ — у `data`.\n- Файли JSON з розширених ігор зі змінами в плагінах можуть містити додаткові тексти: їх додають у «Налаштування → Гра і мови → Тексти плагінів».\n- Оригінальні файли гри не змінюються: збірка кладе переклад окремо або (на ПК) із копією оригіналів.' }],
    },
  });
  const ctx = (c: { pluginCommands?: string[] }) => ({ pluginCommands: c.pluginCommands });
  return {
    manifest: m,
    handlers: [handler(RPGMAKER_ID, {
      id: 'rpgmaker', label: 'RPG Maker MV/MZ (data/*.json)', extensions: ['.json'], text: false, priority: 100, help: `${RPGMAKER_ID}:rpgmaker-open`,
      matches: f => ext(base(f.name)) === '.json' && isRpgMakerFile(base(f.name)),
      extract: (f: GameFile, c) => extractRpgMaker({ ...f, name: base(f.name) }, ctx(c)),
      apply: (f: GameFile, tr) => applyRpgMaker({ ...f, name: base(f.name) }, tr),
    })],
  };
}

export function textFormatsPlugin(): Pick<PluginRecord, 'manifest' | 'handlers'> {
  const m = manifest({
    id: TEXT_FORMATS_ID, name: 'Текстові формати: gettext, CSV, JSON локалізації, Ren’Py',
    description: 'Файли перекладу й тексти ігор у відкритих форматах: .po/.pot, таблиці .csv/.tsv, JSON з рядками інтерфейсу (en.json…) і скрипти Ren’Py (.rpy).',
    contributes: {
      formats: [
        { id: 'locale-json', label: 'JSON локалізації (en.json, strings.json…)', extensions: ['.json'], text: false, handler: 'localeJson', priority: 90 },
        { id: 'gettext', label: 'gettext (.po, .pot)', extensions: ['.po', '.pot'], text: true, handler: 'gettext', priority: 80 },
        { id: 'csv', label: 'Таблиця CSV/TSV (ключ, оригінал, переклад)', extensions: ['.csv', '.tsv'], text: true, handler: 'csv', priority: 80 },
        { id: 'renpy', label: 'Ren’Py (.rpy)', extensions: ['.rpy'], text: true, handler: 'renpy', priority: 80 },
      ],
      engines: [{ id: 'renpy', label: 'Ren’Py', formats: ['renpy'], detect: { anyFiles: ['**/*.rpy'] }, description: 'Візуальні новели на Ren’Py: скрипти лежать у папці game (.rpy).' }],
    },
  });
  const h = (id: string, label: string, extensions: string[], text: boolean, priority: number, matches: FormatHandler['matches'], extract: FormatHandler['extract'], apply: FormatHandler['apply']): FormatHandler => handler(TEXT_FORMATS_ID, { id, label, extensions, text, priority, matches, extract, apply });
  return {
    manifest: m,
    handlers: [
      h('locale-json', 'JSON локалізації (en.json, strings.json…)', ['.json'], false, 90, f => ext(base(f.name)) === '.json' && looksLikeLocaleFile(f.name), f => extractLocaleJson(f.json), (f, tr) => applyLocaleJson(f.json, tr)),
      h('gettext', 'gettext (.po, .pot)', ['.po', '.pot'], true, 80, f => ['.po', '.pot'].includes(ext(base(f.name))), f => (f.text === undefined ? [] : extractPo(f.text)), (f, tr) => applyPo(f.text ?? '', tr)),
      h('csv', 'Таблиця CSV/TSV (ключ, оригінал, переклад)', ['.csv', '.tsv'], true, 80, f => ['.csv', '.tsv'].includes(ext(base(f.name))), f => (f.text === undefined ? [] : extractCsv(f.text)), (f, tr) => applyCsv(f.text ?? '', tr)),
      h('renpy', 'Ren’Py (.rpy)', ['.rpy'], true, 80, f => ext(base(f.name)) === '.rpy', f => (f.text === undefined ? [] : extractRenpy(f.text)), (f, tr) => applyRenpy(f.text ?? '', tr)),
    ],
  };
}

/** Put the built-in plugins into a registry (switched on; the user may switch them off in the manager). */
export function registerBuiltins(reg: PluginRegistry): void {
  for (const p of [rpgMakerPlugin(), textFormatsPlugin()]) reg.add({ manifest: p.manifest, handlers: p.handlers, builtin: true, enabled: true, files: new Map(), source: { kind: 'builtin' } }, false);
  reg.refresh();
}
