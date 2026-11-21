/** A small semantic-version toolkit: enough for plugin and API compatibility, with no dependency. */

export interface Version { major: number; minor: number; patch: number; pre: string }

const VERSION = /^v?(\d{1,9})(?:\.(\d{1,9}))?(?:\.(\d{1,9}))?(?:-([0-9A-Za-z.-]{1,40}))?(?:\+[0-9A-Za-z.-]{1,40})?$/;

/** Parse `1`, `1.2`, `1.2.3`, `1.2.3-beta.1` (a leading `v` and `+build` are tolerated). Null when it is not a version. */
export function parseVersion(s: string): Version | null {
  const m = VERSION.exec(s.trim());
  return m ? { major: Number(m[1]), minor: Number(m[2] ?? 0), patch: Number(m[3] ?? 0), pre: m[4] ?? '' } : null;
}

const cmpPre = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a) return 1;            // a release is newer than its own pre-releases
  if (!b) return -1;
  const x = a.split('.'), y = b.split('.');
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i], q = y[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn) { if (Number(p) !== Number(q)) return Number(p) < Number(q) ? -1 : 1; }
    else if (pn !== qn) return pn ? -1 : 1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
};

/** -1, 0 or 1. Unparsable versions sort before every real one. */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : 0;
  for (const k of ['major', 'minor', 'patch'] as const) if (x[k] !== y[k]) return x[k] < y[k] ? -1 : 1;
  return cmpPre(x.pre, y.pre);
}

/** The first version that is not covered by `^v` / `~v` (the caret and the tilde ranges of npm). */
function upper(v: Version, op: '^' | '~'): Version {
  if (op === '~') return { major: v.major, minor: v.minor + 1, patch: 0, pre: '' };
  if (v.major > 0) return { major: v.major + 1, minor: 0, patch: 0, pre: '' };
  if (v.minor > 0) return { major: 0, minor: v.minor + 1, patch: 0, pre: '' };
  return { major: 0, minor: 0, patch: v.patch + 1, pre: '' };
}
const text = (v: Version): string => `${v.major}.${v.minor}.${v.patch}${v.pre ? `-${v.pre}` : ''}`;

/** One comparator of a range: `>=1.2.0`, `<2`, `=1.0.0`, `^1.2`, `~1.2.3`, `1.x`, `*`. Null when it cannot be read. */
function comparator(raw: string): ((v: string) => boolean) | null {
  const t = raw.trim();
  if (t === '' || t === '*' || t === 'x' || t === 'X') return () => true;
  const m = /^(>=|<=|>|<|=|\^|~)?\s*(.+)$/.exec(t);
  if (!m) return null;
  const op = m[1] ?? '';
  const body = m[2]!;
  // 1.x and 1.2.x
  const wild = /^v?(\d+)(?:\.(\d+|[xX*]))?(?:\.([xX*]))?$/.exec(body);
  if (wild && (wild[2] === undefined || /[xX*]/.test(wild[2]!) || wild[3] !== undefined) && op === '') {
    const major = Number(wild[1]), minor = wild[2] && /^\d+$/.test(wild[2]) ? Number(wild[2]) : null;
    return v => { const p = parseVersion(v); return !!p && p.major === major && (minor === null || p.minor === minor); };
  }
  const base = parseVersion(body);
  if (!base) return null;
  const lo = text(base);
  switch (op) {
    case '^': case '~': { const hi = text(upper(base, op)); return v => compareVersions(v, lo) >= 0 && compareVersions(v, hi) < 0; }
    case '>=': return v => compareVersions(v, lo) >= 0;
    case '>': return v => compareVersions(v, lo) > 0;
    case '<=': return v => compareVersions(v, lo) <= 0;
    case '<': return v => compareVersions(v, lo) < 0;
    default: return v => compareVersions(v, lo) === 0;
  }
}

/** Whether a range is written in a form `satisfies` understands. */
export const validRange = (range: string): boolean => range.trim().split('||').every(alt => alt.trim().split(/\s+/).filter(Boolean).every((c, i, a) => (/^(>=|<=|>|<|=|\^|~)$/.test(c) ? i < a.length - 1 : comparator(c) !== null)) || alt.trim() === '');

/**
 * Whether `version` is inside `range`: comparators joined by spaces mean «all of them», `||` means «or».
 * A pre-release satisfies a range only when the range itself names a pre-release (as in npm).
 */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  return range.split('||').some(alt => {
    const tokens = alt.trim().split(/\s+/).filter(Boolean);
    const parts: string[] = [];
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i]!;
      if (/^(>=|<=|>|<|=|\^|~)$/.test(t) && tokens[i + 1] !== undefined) parts.push(t + tokens[++i]!); else parts.push(t);
    }
    if (!parts.length) parts.push('*');
    const fns = parts.map(comparator);
    if (fns.some(f => !f)) return false;
    if (v.pre && !parts.some(p => /-/.test(p))) return false;
    return fns.every(f => f!(version));
  });
}
