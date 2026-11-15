import { describe, expect, it } from 'vitest';
import { HUE_FROM, HUE_SPAN, applyTheme, contrastOf, hueOfName, themeHue, themeTokens } from '../src/core/theme';

const BG = '#1e1f22', PANEL = '#2b2d30';

describe('theme: the hue of a project', () => {
  it('the same name always gives the same hue, within the cool range', () => {
    for (const n of ['Transly', 'Новий проєкт', 'Fear & Hunger 2: Termina', '', ' x ', '🎮']) {
      const h = hueOfName(n);
      expect(h).toBe(hueOfName(n));
      expect(h).toBeGreaterThanOrEqual(HUE_FROM);
      expect(h).toBeLessThan(HUE_FROM + HUE_SPAN);
    }
  });
  it('case and the spaces around the name do not matter', () => { expect(hueOfName('  Transly ')).toBe(hueOfName('transly')); });
  it('different names mostly give different hues', () => {
    const hues = new Set(Array.from({ length: 40 }, (_, i) => hueOfName('project ' + i)));
    expect(hues.size).toBeGreaterThan(20);
  });
  it('a hand-picked hue wins; a broken one is ignored', () => {
    expect(themeHue('Transly', 20)).toBe(20);
    expect(themeHue('Transly', 20.4)).toBe(20);
    for (const bad of [undefined, null, -1, 360, NaN, Infinity, '200', {}]) expect(themeHue('Transly', bad)).toBe(hueOfName('Transly'));
  });
});

describe('theme: the tokens', () => {
  it('are plain sRGB (no oklch), so an old WebView draws them', () => {
    for (const v of Object.values(themeTokens(250))) expect(v).toMatch(/^(#[0-9a-f]{6}|\d+,\d+,\d+|rgba\(\d+,\d+,\d+,[\d.]+\))$/);
  });
  it('the white text on the main action reaches 4.5:1 for every hue', () => {
    for (let h = 0; h < 360; h++) expect(contrastOf(themeTokens(h)['--accent-solid']!, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
  it('the accent text and the accent line stand out of the dark ground for every hue (4.5:1 text, 3:1 line)', () => {
    for (let h = 0; h < 360; h += 5) {
      const t = themeTokens(h);
      expect(contrastOf(t['--accent-text']!, BG)).toBeGreaterThanOrEqual(4.5);
      expect(contrastOf(t['--accent-text']!, PANEL)).toBeGreaterThanOrEqual(4.5);
      expect(contrastOf(t['--accent']!, BG)).toBeGreaterThanOrEqual(3);
    }
  });
  it('the white text of a choice in the working window reaches 4.5:1 on its fill over the panel and the ground, for every hue', () => {
    const over = (fg: string, a: number, bg: string): string => '#' + [1, 3, 5].map(i => Math.round(parseInt(bg.slice(i, i + 2), 16) + (parseInt(fg.slice(i, i + 2), 16) - parseInt(bg.slice(i, i + 2), 16)) * a).toString(16).padStart(2, '0')).join('');
    for (let h = 0; h < 360; h += 5) {
      const t = themeTokens(h);
      const alpha = Number(/,([\d.]+)\)$/.exec(t['--use']!)![1]);
      for (const ground of [PANEL, BG]) expect(contrastOf('#ffffff', over(t['--accent']!, alpha, ground))).toBeGreaterThanOrEqual(4.5);
      expect(contrastOf(t['--accent']!, PANEL)).toBeGreaterThanOrEqual(3);
    }
  });
  it('the main action is darker than the accent line, and its hover is brighter than it', () => {
    const t = themeTokens(250);
    expect(contrastOf(t['--accent-solid']!, BG)).toBeLessThan(contrastOf(t['--accent']!, BG));
    expect(contrastOf(t['--accent-hi']!, BG)).toBeGreaterThan(contrastOf(t['--accent-solid']!, BG));
  });
  it('different hues give different colours', () => { expect(themeTokens(200)['--accent']).not.toBe(themeTokens(300)['--accent']); });
  it('applyTheme sets every token on the element', () => {
    const set: Record<string, string> = {};
    applyTheme({ style: { setProperty: (k, v) => { set[k] = v; } } }, 250);
    expect(set).toEqual(themeTokens(250));
  });
});
