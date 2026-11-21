/**
 * The plural rule of a language, as written in a gettext header: `plural=(n != 1)` or
 * `plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2)`.
 * It is read by a small parser and never run as code (a language pack is data, not a program).
 */
export type PluralFn = (n: number) => number;

type Node = { t: 'n' } | { t: 'num'; v: number } | { t: 'un'; op: string; a: Node } | { t: 'bin'; op: string; a: Node; b: Node } | { t: 'cond'; c: Node; a: Node; b: Node };

const TOKEN = /\s*(\d+|n|&&|\|\||==|!=|<=|>=|[-+*/%<>!?:()])/y;

function tokens(src: string): string[] | null {
  const out: string[] = [];
  TOKEN.lastIndex = 0;
  let end = 0;
  while (end < src.length) {
    TOKEN.lastIndex = end;
    const m = TOKEN.exec(src);
    if (!m) return /^\s*$/.test(src.slice(end)) ? out : null;
    out.push(m[1]!);
    end = TOKEN.lastIndex;
  }
  return out;
}

const BIN: Record<string, number> = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '+': 5, '-': 5, '*': 6, '/': 6, '%': 6 };

function parse(tk: string[]): Node | null {
  let i = 0;
  const primary = (): Node | null => {
    const t = tk[i++];
    if (t === undefined) return null;
    if (t === 'n') return { t: 'n' };
    if (/^\d+$/.test(t)) return { t: 'num', v: Number(t) };
    if (t === '(') { const e = expr(); if (!e || tk[i++] !== ')') return null; return e; }
    if (t === '!' || t === '-') { const a = primary(); return a ? { t: 'un', op: t, a } : null; }
    return null;
  };
  const binary = (min: number): Node | null => {
    let a = primary();
    while (a) {
      const op = tk[i];
      const p = op !== undefined ? BIN[op] : undefined;
      if (p === undefined || p < min) break;
      i++;
      const b = binary(p + 1);
      if (!b) return null;
      a = { t: 'bin', op: op!, a, b };
    }
    return a;
  };
  const expr = (): Node | null => {
    const c = binary(1);
    if (!c) return null;
    if (tk[i] !== '?') return c;
    i++;
    const a = expr();
    if (!a || tk[i++] !== ':') return null;
    const b = expr();
    return b ? { t: 'cond', c, a, b } : null;
  };
  const e = expr();
  return e && i === tk.length ? e : null;
}

const run = (e: Node, n: number): number => {
  switch (e.t) {
    case 'n': return n;
    case 'num': return e.v;
    case 'un': return e.op === '!' ? (run(e.a, n) ? 0 : 1) : -run(e.a, n);
    case 'cond': return run(e.c, n) ? run(e.a, n) : run(e.b, n);
    case 'bin': {
      const a = run(e.a, n), b = run(e.b, n);
      switch (e.op) {
        case '||': return a || b ? 1 : 0;
        case '&&': return a && b ? 1 : 0;
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return b === 0 ? 0 : Math.trunc(a / b);
        default: return b === 0 ? 0 : a % b;
      }
    }
  }
};

/** The function for a rule, or null when the rule is not written in the supported form. */
export function pluralFn(expr: string): PluralFn | null {
  if (expr.length > 300) return null;
  const tk = tokens(expr.replace(/;\s*$/, ''));
  const tree = tk ? parse(tk) : null;
  if (!tree) return null;
  return n => { const r = Math.trunc(run(tree, Math.abs(Math.trunc(n)))); return Number.isFinite(r) && r >= 0 ? r : 0; };
}

/** The rules of the common languages (used when a pack says nothing, or says something unreadable). */
export const KNOWN_PLURALS: Record<string, string> = {
  uk: 'n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2', ru: 'n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2',
  be: 'n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2',
  pl: 'n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2', cs: '(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2', sk: '(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2',
  en: 'n != 1', de: 'n != 1', nl: 'n != 1', es: 'n != 1', it: 'n != 1', pt: 'n != 1', sv: 'n != 1', da: 'n != 1', nb: 'n != 1', fi: 'n != 1', tr: 'n > 1',
  fr: 'n > 1', ja: '0', zh: '0', ko: '0', vi: '0', th: '0', id: '0',
};
