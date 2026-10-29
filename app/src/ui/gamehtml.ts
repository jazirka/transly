import { esc } from './dom';

/** RPG Maker's default window colours (\C[n]); close to what the game shows, not exact for games with a custom skin. */
const COLORS = ['#ffffff', '#20a0d6', '#ff784c', '#66cc40', '#99ccff', '#ccc0ff', '#ffffa0', '#808080', '#c0c0c0', '#2080cc', '#ff3820', '#00a040', '#6080c0', '#8060c0', '#ffcc20', '#000000', '#84aaff', '#ffff40', '#ff2020', '#202040', '#e08040', '#f0c040', '#4080c0', '#40c0f0', '#80ff80', '#c08080', '#8080ff', '#ff80ff', '#00a040', '#00e060', '#a060e0', '#c080ff'];

/** Text as the message window shows it: colours applied, names filled in, timing codes dropped, the rest as small chips. */
export function gameHtml(text: string, actorName: (n: number) => string | undefined, varName: (n: number) => string | undefined = () => undefined): string {
  let open = false;
  const close = () => { if (open) { open = false; return '</span>'; } return ''; };
  const chip = (t: string, title: string) => `<span class="scn-chip" title="${esc(title)}">${esc(t)}</span>`;
  const out = text.replace(/\\\\|\\([A-Za-z]+)\[(\d+)\]|\\([{}.|!><^$])|([^\\]+|\\)/g, (all: string, name?: string, n?: string, timing?: string, plain?: string) => {
    if (all === '\\\\') return '\\';
    if (timing) return '';
    if (plain !== undefined) return esc(plain);
    const num = Number(n);
    switch ((name ?? '').toUpperCase()) {
      case 'C': { const s = close(); if (num === 0) return s; open = true; return `${s}<span style="color:${COLORS[num] ?? '#fff'}">`; }
      case 'N': { const a = actorName(num); return a ? `<span class="scn-name" title="\\N[${num}]">${esc(a)}</span>` : chip(`\\N[${num}]`, `Ім’я персонажа ${num}`); }
      case 'P': return chip(`\\P[${num}]`, `Ім’я учасника групи ${num}`);
      case 'V': return chip(`\\V[${num}]`, varName(num) ? `Значення змінної ${num} «${varName(num)}»` : `Значення змінної ${num}`);
      case 'I': return chip(`\\I[${num}]`, `Піктограма ${num}`);
      default: return chip(`\\${name}[${num}]`, 'Керівний код гри');
    }
  });
  return out + close();
}
