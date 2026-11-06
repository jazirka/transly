import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WINDOW_CONTROLS_HTML } from '../src/ui/winctl';

const UI = join(__dirname, '..', 'src', 'ui');
const sources = readdirSync(UI).filter(f => f.endsWith('.ts')).map(f => [f, readFileSync(join(UI, f), 'utf8')] as const);

describe('the app draws its own window frame', () => {
  it('dialogs are never opened with showModal: its layer would cover the window controls', () => {
    const offenders = sources.filter(([f, src]) => f !== 'modal.ts' && /\.showModal\s*\(/.test(src)).map(([f]) => f);
    expect(offenders).toEqual([]);
  });

  it('the three window buttons and the drag strip are in the markup', () => {
    for (const id of ['wc-min', 'wc-max', 'wc-close', 'wctl', 'wdrag']) expect(WINDOW_CONTROLS_HTML).toContain(`id="${id}"`);
    // Every button has a name for assistive technology, and the group says what it is.
    expect(WINDOW_CONTROLS_HTML.match(/<button[^>]*aria-label="[^"]+"/g)).toHaveLength(3);
    expect(WINDOW_CONTROLS_HTML).toContain('role="group"');
    // Hidden until the own frame is switched on, so a browser never shows them.
    expect(WINDOW_CONTROLS_HTML).toMatch(/id="wctl"[^>]*hidden/);
  });

  it('the controls are not inside the app root (a dialog makes the root inert)', () => {
    const app = readFileSync(join(UI, 'app.ts'), 'utf8');
    const shell = app.slice(app.indexOf('const SHELL = `'), app.indexOf('`;', app.indexOf('const SHELL = `')));
    const at = shell.indexOf('${WINDOW_CONTROLS_HTML}');
    expect(at).toBeGreaterThan(0);
    // The root closes before the controls: count the divs opened and closed up to that point.
    const before = shell.slice(0, at);
    const root = before.indexOf('id="ide"');
    const opened = (before.slice(root).match(/<div\b/g) ?? []).length + 1; // the root itself
    const closed = (before.slice(root).match(/<\/div>/g) ?? []).length;
    expect(closed).toBeGreaterThanOrEqual(opened); // the root and everything in it is closed (the scroll wrapper around it may be too)
  });

  it('the capability file allows exactly the window commands the controls use', () => {
    const cap = JSON.parse(readFileSync(join(__dirname, '..', 'src-tauri', 'capabilities', 'default.json'), 'utf8')) as { permissions: string[] };
    for (const p of ['allow-minimize', 'allow-toggle-maximize', 'allow-close', 'allow-destroy', 'allow-start-dragging', 'allow-set-decorations']) {
      expect(cap.permissions).toContain(`core:window:${p}`);
    }
    // Reading the maximised state and the double click on the bar come with the default set.
    expect(cap.permissions).toContain('core:default');
  });

  it('the window is created without the system title bar and cannot shrink below the width the top bar needs', () => {
    const conf = JSON.parse(readFileSync(join(__dirname, '..', 'src-tauri', 'tauri.conf.json'), 'utf8')) as { app: { windows: { decorations?: boolean; minWidth?: number }[] } };
    const w = conf.app.windows[0]!;
    expect(w.decorations).toBe(false);
    expect(w.minWidth).toBeGreaterThanOrEqual(1000);
  });
});
