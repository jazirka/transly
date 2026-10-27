import { applyCsv, extractCsv } from './formats/csv';
import { applyLocaleJson, extractLocaleJson, looksLikeLocaleFile } from './formats/i18njson';
import { applyPo, extractPo } from './formats/po';
import { applyRenpy, extractRenpy } from './formats/renpy';
import type { GameFile, Translations, Unit } from './model';
import { applyRpgMaker, extractRpgMaker, isRpgMakerFile } from './rpgmaker';

export type FormatId = 'rpgmaker' | 'gettext' | 'csv' | 'locale-json' | 'renpy';

export interface FormatInfo { id: FormatId; label: string; extensions: string[] }

export const FORMATS: FormatInfo[] = [
  { id: 'rpgmaker', label: 'RPG Maker MV/MZ (data/*.json)', extensions: ['.json'] },
  { id: 'gettext', label: 'gettext (.po, .pot)', extensions: ['.po', '.pot'] },
  { id: 'csv', label: 'Таблиця CSV/TSV (ключ, оригінал, переклад)', extensions: ['.csv', '.tsv'] },
  { id: 'locale-json', label: 'JSON локалізації (en.json, strings.json…)', extensions: ['.json'] },
  { id: 'renpy', label: 'Ren’Py (.rpy)', extensions: ['.rpy'] },
];

/** File extensions the app can read at all. */
export const READABLE_EXTENSIONS = [...new Set(FORMATS.flatMap(f => f.extensions))];

const base = (name: string) => name.split(/[\\/]/).pop() ?? name;
const ext = (name: string) => /\.[^./\\]+$/.exec(name)?.[0].toLowerCase() ?? '';

/** Which format handles this file, or null when it has no translatable text for us. */
export function formatOf(file: Pick<GameFile, 'name'>): FormatId | null {
  const n = base(file.name);
  const e = ext(n);
  if (e === '.json') return isRpgMakerFile(n) ? 'rpgmaker' : looksLikeLocaleFile(file.name) ? 'locale-json' : null;
  if (e === '.po' || e === '.pot') return 'gettext';
  if (e === '.csv' || e === '.tsv') return 'csv';
  if (e === '.rpy') return 'renpy';
  return null;
}

/** Text formats carry their content in `text`; JSON formats in `json`. */
export const isTextFormat = (id: FormatId | null): boolean => id === 'gettext' || id === 'csv' || id === 'renpy';

/** Extract every translatable unit from one file. Unknown files yield no units. */
export function extract(file: GameFile): Unit[] {
  switch (formatOf(file)) {
    case 'rpgmaker': return extractRpgMaker({ ...file, name: base(file.name) });
    case 'locale-json': return extractLocaleJson(file.json);
    case 'gettext': return file.text === undefined ? [] : extractPo(file.text);
    case 'csv': return file.text === undefined ? [] : extractCsv(file.text);
    case 'renpy': return file.text === undefined ? [] : extractRenpy(file.text);
    default: return [];
  }
}

/** Translated copy of the file: parsed JSON for JSON formats, a string for text formats. The input is never changed. */
export function apply(file: GameFile, tr: Translations): unknown {
  switch (formatOf(file)) {
    case 'rpgmaker': return applyRpgMaker({ ...file, name: base(file.name) }, tr);
    case 'locale-json': return applyLocaleJson(file.json, tr);
    case 'gettext': return applyPo(file.text ?? '', tr);
    case 'csv': return applyCsv(file.text ?? '', tr);
    case 'renpy': return applyRenpy(file.text ?? '', tr);
    default: return file.json;
  }
}
