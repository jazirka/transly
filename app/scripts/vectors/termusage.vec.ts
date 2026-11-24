import { test } from 'vitest';
import { WordIndex, termUsage } from '../../src/core/termusage';
import type { FileView } from '../../src/core/project';
import { UK, genTerm, genText } from './corpus';
import { rng, writeVectors } from './util';

test('export termusage vectors', () => {
  const r = rng(31337);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  for (let n = 0; n < 60; n++) {
    // невелика «гра»: кілька файлів, у кожному кілька рядків; частина перекладена
    const files = Array.from({ length: 1 + r.int(3) }, (_, i) => `F${i}.json`);
    const views = files.map(name => ({ name, units: Array.from({ length: 1 + r.int(25) }, (_, k) => ({ key: `k${k}`, source: genText(r, 'en'), speaker: '', kind: 'dialogue' as const, context: '' })) }));
    const saved: { files: Record<string, Record<string, { target: string; status: 'draft'; mt: number }>> } = { files: {} };
    const words = views.flatMap(v => v.units.flatMap(u => u.source.split(/\s+/).filter(w => /^\p{L}+$/u.test(w))));
    const terms = Array.from({ length: 6 }, () => ({ en: r.chance(0.7) && words.length ? r.pick(words) : genTerm(r, 'en'), uk: r.pick(UK), ...(r.chance(0.4) ? { alt: [r.pick(UK)] } : {}) }));
    for (const v of views) {
      saved.files[v.name] = {};
      for (const u of v.units) if (r.chance(0.7)) {
        // переклад іноді містить відповідники термінів
        const t = terms.flatMap(x => (r.chance(0.25) ? [r.chance(0.3) && x.alt ? x.alt[0]! : x.uk] : [])).join(' ') + ' ' + genText(r, 'uk');
        saved.files[v.name]![u.key] = { target: r.chance(0.15) ? ' ' : t, status: 'draft', mt: 1 };
      }
    }
    const index = WordIndex.of(views as unknown as FileView[]);
    for (const term of terms) {
      const skip = r.chance(0.3) ? { file: files[0]!, key: 'k0' } : undefined;
      add('termUsage', { views, saved, term, skip: skip ?? null }, termUsage(index, saved as never, term, skip));
    }
  }
  add('termUsage', { views: [], saved: { files: {} }, term: { en: ' ', uk: 'x' }, skip: null }, termUsage(WordIndex.of([]), { files: {} } as never, { en: ' ', uk: 'x' }));
  writeVectors('termusage', out);
});
