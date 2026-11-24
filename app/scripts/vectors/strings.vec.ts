import { test } from 'vitest';
import { pluginStrings, pluginTemplate } from '../../src/core/ext/strings';
import { rng, writeVectors } from './util';

const S = ['Name', 'Назва', '', ' ', '  x ', 'a"b', 'back\slash', 'line1\nline2', 'tab\there', 'dup', 'dup', 'Привіт {name}', '😀'];

test('export strings vectors', () => {
  const r = rng(31337);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });
  const s = (p = 0.7): string | undefined => (r.chance(p) ? r.pick(S) : undefined);
  const o = (k: string, v: unknown): Record<string, unknown> => (v === undefined ? {} : { [k]: v });
  for (let i = 0; i < 300; i++) {
    const files: Record<string, string> = { 'h/a.md': r.pick(S), 'h/b.md': r.pick(S) };
    const m: Record<string, unknown> = {
      manifestVersion: 1, id: r.pick(['acme.wolf', 'x.y']), version: r.pick(['1.0.0', '2.3.4-beta']), name: r.pick(S), ...o('description', s()), ...o('sourceLanguage', r.chance(0.3) ? r.pick(['uk', 'pl', 'en']) : undefined),
    };
    if (r.chance(0.9)) m.contributes = {
      ...(r.chance(0.7) ? { formats: Array.from({ length: r.int(3) }, () => ({ id: 'f', label: r.pick(S) })) } : {}),
      ...(r.chance(0.7) ? { engines: Array.from({ length: r.int(3) }, () => ({ id: 'e', label: r.pick(S), ...o('description', s()) })) } : {}),
      ...(r.chance(0.7) ? { help: Array.from({ length: r.int(4) }, () => ({ id: 'h', title: r.pick(S), ...(r.chance(0.5) ? { body: r.pick([...S, null as never]) } : {}), ...(r.chance(0.6) ? { file: r.pick(['h/a.md', 'h/b.md', 'h/none.md', '']) } : {}) })) } : {}),
      ...(r.chance(0.7) ? { settings: Array.from({ length: r.int(3) }, () => ({ id: 's', title: r.pick(S), ...o('description', s()), fields: Array.from({ length: r.int(3) }, () => ({ key: 'k', type: 'select', label: r.pick(S), ...o('description', s()), ...(r.chance(0.6) ? { options: Array.from({ length: r.int(3) }, () => ({ value: 'v', label: r.pick(S) })) } : {}) })) })) } : {}),
    };
    const read = (p: string): string | undefined => files[p];
    const lang = r.pick(['pl', 'pt-BR', 'xx']);
    add('strings', { m, files, lang }, { strings: pluginStrings(m as never, read), template: pluginTemplate(m as never, lang, read) });
  }
  writeVectors('strings', out);
});
