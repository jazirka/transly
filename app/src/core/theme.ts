/**
 * The accent colour of a project: one hue, taken from the project's name (so projects look different from each other)
 * or chosen by hand; every accent token is derived from it. Plain sRGB strings, not `oklch()`, so that an older WebView draws them too.
 *
 * The roles (the same on the desktop and the phone): `--accent` lines and focus, `--accent-solid` the one main action with `--on-accent`
 * text on it, `--accent-soft` + `--accent-ring` + `--accent-text` an active element under the cursor, `--focus-glow` the keyboard ring.
 * Status colours (draft, sent, approved, error) are not part of the theme.
 */

/** The generated hue stays among the cool colours: red, yellow and green belong to the statuses and to errors. A hand-picked hue may be anything. */
export const HUE_FROM = 170;
export const HUE_SPAN = 166;

const hash = (s: string): number => {
  let h = 2166136261;
  for (const c of s.trim().toLowerCase()) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619); }
  return h >>> 0;
};

/** The hue the name gives (degrees, HUE_FROM … HUE_FROM + HUE_SPAN - 1). The same name always gives the same hue. */
export const hueOfName = (name: string): number => HUE_FROM + hash(name) % HUE_SPAN;

const validHue = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v < 360;

/** The hue in use: the hand-picked one when the project has it, else the one of the name. */
export const themeHue = (name: string, chosen?: unknown): number => (validHue(chosen) ? Math.round(chosen) : hueOfName(name));

// OKLCH -> sRGB (Björn Ottosson's matrices), the chroma is lowered until the colour fits into sRGB.
const lin2srgb = (c: number): number => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);
const toLinear = (L: number, C: number, hDeg: number): [number, number, number] => {
  const h = (hDeg * Math.PI) / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
};
const fits = (v: number[]): boolean => v.every(c => c >= -0.0005 && c <= 1.0005);
export const oklchRgb = (L: number, C: number, hDeg: number): [number, number, number] => {
  let lo = 0, hi = C, rgb = toLinear(L, C, hDeg);
  if (!fits(rgb)) {
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (fits(toLinear(L, mid, hDeg))) lo = mid; else hi = mid; }
    rgb = toLinear(L, lo, hDeg);
  }
  return rgb.map(c => Math.round(Math.min(1, Math.max(0, lin2srgb(Math.min(1, Math.max(0, c))))) * 255)) as [number, number, number];
};
const hex = ([r, g, b]: [number, number, number]): string => '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('');
const rgba = ([r, g, b]: [number, number, number], a: number): string => `rgba(${r},${g},${b},${a})`;

/** WCAG contrast ratio of two #rrggbb colours. */
export const contrastOf = (a: string, b: string): number => {
  const lum = (h: string): number => {
    const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    return 0.2126 * v[0]! + 0.7152 * v[1]! + 0.0722 * v[2]!;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};

/** The filled main action: as bright as the text on it allows (white text needs 4.5:1). */
const solidOf = (hue: number): [number, number, number] => {
  for (let L = 0.56; L > 0.3; L -= 0.01) {
    const rgb = oklchRgb(L, 0.17, hue);
    if (contrastOf(hex(rgb), '#ffffff') >= 4.5) return rgb;
  }
  return oklchRgb(0.3, 0.17, hue);
};

/** Every CSS variable of the theme for one hue. */
export const themeTokens = (hue: number): Record<string, string> => {
  const line = oklchRgb(0.72, 0.15, hue);
  const solid = solidOf(hue);
  const text = oklchRgb(0.84, 0.1, hue);
  return {
    '--accent': hex(line),
    '--accent-2': hex(line),
    '--accent-rgb': line.join(','),
    '--accent-solid': hex(solid),
    '--accent-hi': hex(oklchRgb(0.62, 0.17, hue)),
    '--on-accent': '#ffffff',
    '--accent-soft': rgba(line, 0.16),
    '--accent-ring': rgba(line, 0.5),
    '--accent-text': hex(text),
    '--focus-glow': rgba(line, 0.24),
  };
};

export interface StyleTarget { style: { setProperty(name: string, value: string): void } }

/** Puts the theme of a hue on an element (the document element). */
export const applyTheme = (el: StyleTarget, hue: number): void => { for (const [k, v] of Object.entries(themeTokens(hue))) el.style.setProperty(k, v); };

let applied = -1;
/** Puts the theme of a project on an element when its hue changed since the last call (cheap enough for every redraw). */
export const syncTheme = (el: StyleTarget, p: { name: string; settings?: { hue?: unknown } }): void => {
  const h = themeHue(p.name, p.settings?.hue);
  if (h === applied) return;
  applied = h; applyTheme(el, h);
};
