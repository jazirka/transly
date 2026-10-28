import { alignReference, extract, withReference } from '../core';
import type { Reference } from '../core';
import { toast } from './dom';
import { pickGameFolder, readFiles } from './folder';
import type { Ctx } from './state';

/** Pick another-language copy of the game and align it line by line with the working language. */
export async function importReference(ctx: Ctx, lang: string): Promise<boolean> {
  const snap = ctx.s.saved.snapshot;
  if (!snap) { toast('Спершу відкрийте папку гри: довідка прив’язується до її рядків'); return false; }
  const input = document.createElement('input');
  input.type = 'file';
  input.setAttribute('webkitdirectory', '');
  const picked = await pickGameFolder(input);
  if (!picked) return false;
  if (!picked.files.length) { toast('У вибраній папці немає файлів .json'); return false; }
  toast('Читаю довідкову версію…');
  const { files } = await readFiles(picked.files, () => undefined);
  const texts: Record<string, Reference> = {};
  let paired = 0, total = 0;
  for (const f of files) {
    const units = snap[f.name];
    if (!units) continue;
    const ref = alignReference(units, extract(f));
    texts[f.name] = ref;
    total += units.length;
    paired += Object.keys(ref).length;
  }
  if (!paired) { toast('Не знайдено спільних файлів: оберіть папку тієї ж гри іншою мовою'); return false; }
  ctx.s.saved.reference = withReference(ctx.s.saved.reference, { lang, texts });
  ctx.s.saved.assetsRev = Date.now();
  ctx.persist();
  toast(`Довідку (${lang.toUpperCase()}) додано: ${paired} із ${total} рядків знайшли пару`);
  return true;
}
