import en from './en.po?raw';

/**
 * The interface languages that come with the application. Each is a gettext catalog (`<code>.po`) whose strings are in the context `core`
 * (the application's own strings, including those of the built-in plugins). Adding a language: put `<code>.po` next to this file and one line here;
 * the application offers it in «Мова інтерфейсу» and falls back to Ukrainian for every string the catalog does not have.
 */
export interface BundledLanguage {
  /** BCP 47: `en`, `pl`. */
  code: string;
  /** The name in English, for the lists made by translators. */
  name: string;
  /** The name as its speakers write it; this is what the language list shows. */
  nativeName: string;
  /** The catalog. */
  po: string;
}

export const BUNDLED_LANGUAGES: readonly BundledLanguage[] = [
  { code: 'en', name: 'English', nativeName: 'English', po: en },
];
