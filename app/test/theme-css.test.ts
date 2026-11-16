import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const DIRS = ['src/ui', 'src/mobile'].map(d => join(__dirname, '..', d));
const files = DIRS.flatMap(d => readdirSync(d).filter(f => f.endsWith('.css')).map(f => join(d, f)));

describe('the stylesheets follow the theme', () => {
  it('no hard-coded brand blue or purple of the old look is left (they must be theme tokens)', () => {
    const banned = ['#8fb2f7', '#b7a6ff', '#8d78e4', '#7a62d8', '#8b72e8', '#9a85ee', '#8b6cf0', '#6a50d0', '#7157d8', '#3a3170', '#2f2a58', '#5a4a9a'];
    for (const f of files) {
      const css = readFileSync(f, 'utf8').toLowerCase();
      for (const c of banned) expect({ f: f.split('/').slice(-2).join('/'), c, found: css.includes(c) }).toEqual({ f: f.split('/').slice(-2).join('/'), c, found: false });
    }
  });
  it('the keyboard focus ring and the hovered main buttons use the accent, not a colour of their own', () => {
    const theme = readFileSync(join(__dirname, '../src/ui/theme.css'), 'utf8');
    expect(theme).toMatch(/:focus-visible\{outline:2px solid var\(--accent\)/);
    expect(theme).not.toMatch(/\.saveb:hover\{background:#/);
  });
});
