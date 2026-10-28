import type { SysNames } from './sysnames';

export interface CodeMeaning { code: string; meaning: string }

/** What the control codes in a text stand for, once each, in order of appearance. */
export function explainCodes(text: string, actor: (n: number) => string | undefined, names?: SysNames): CodeMeaning[] {
  const out: CodeMeaning[] = [];
  const seen = new Set<string>();
  const add = (code: string, meaning: string) => { if (!seen.has(code)) { seen.add(code); out.push({ code, meaning }); } };
  for (const m of text.matchAll(/\\([A-Za-z]+)\[(\d+)\]|\\([{}.|!><^$GgSs])/g)) {
    const code = m[0], n = Number(m[2]);
    switch ((m[1] ?? '').toUpperCase()) {
      case 'N': add(code, actor(n) ? `ім’я персонажа: ${actor(n)}` : `ім’я персонажа ${n}`); continue;
      case 'V': add(code, names?.variables[n] ? `значення змінної ${n} «${names.variables[n]}»` : `значення змінної ${n}`); continue;
      case 'P': add(code, `ім’я учасника групи №${n}`); continue;
      case 'I': add(code, `піктограма №${n}`); continue;
      case 'C': add(code, n === 0 ? 'звичайний колір' : `колір №${n}`); continue;
      case '': break;
      default: add(code, 'керівний код гри'); continue;
    }
    const c = m[3]!;
    add(code, ({ G: names?.currency ? `назва валюти: ${names.currency}` : 'назва валюти', S: 'повільний показ тексту', '{': 'збільшити шрифт', '}': 'зменшити шрифт', '.': 'пауза чверть секунди', '|': 'пауза секунда', '!': 'чекати натискання', '>': 'миттєвий показ до \\<', '<': 'кінець миттєвого показу', '^': 'не чекати натискання в кінці', $: 'вікно із золотом' } as Record<string, string>)[c.toUpperCase() === 'G' ? 'G' : c] ?? 'керівний код гри');
  }
  return out;
}
