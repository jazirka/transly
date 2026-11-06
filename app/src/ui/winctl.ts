import { getCurrentWindow } from '@tauri-apps/api/window';
import { toast } from './dom';
import { isDesktop } from './desktop';

/**
 * The window frame of the desktop app: no system title bar, the app draws its own (the top bar is the drag handle, the
 * three buttons are at its right edge). The system bar can be switched back on at any time (settings), and comes back by
 * itself when a window command is refused, so a window without working controls is never left behind.
 */
const LS = 'transly-native-chrome';

/** Caption glyphs, drawn with strokes so they stay sharp at any scale (the look of the Windows 11 caption buttons). */
const GLYPH = {
  min: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5h9"/></svg>',
  max: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="3.5" width="9" height="9" rx="1.2"/></svg>',
  restore: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 5.5v-.8a1.2 1.2 0 0 1 1.2-1.2h5.6a1.2 1.2 0 0 1 1.2 1.2v5.6a1.2 1.2 0 0 1-1.2 1.2h-.8"/><rect x="2.5" y="5.5" width="8" height="8" rx="1.2"/></svg>',
  close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>',
};

/**
 * The window controls and the strip that lets the window be dragged while a dialog is open (the top bar is dimmed and
 * inert then, see `modal.ts`). Both live outside the app root, so a dialog never switches them off.
 */
export const WINDOW_CONTROLS_HTML = `<div class="wdrag" id="wdrag" data-tauri-drag-region="deep" aria-hidden="true"></div>
<div class="wc wctl" id="wctl" role="group" aria-label="Керування вікном" hidden>
  <button type="button" id="wc-min" title="Згорнути" aria-label="Згорнути вікно">${GLYPH.min}</button>
  <button type="button" id="wc-max" title="Розгорнути" aria-label="Розгорнути вікно">${GLYPH.max}</button>
  <button type="button" id="wc-close" title="Закрити" aria-label="Закрити вікно">${GLYPH.close}</button>
</div>`;

/** True when the translator chose the system title bar. */
export const nativeChrome = (): boolean => { try { return localStorage.getItem(LS) === '1'; } catch { return false; } };

type Win = ReturnType<typeof getCurrentWindow>;
const win = (): Win | null => { try { return getCurrentWindow(); } catch { return null; } };

/** Show or hide the app's own title bar parts to match the chosen frame. */
export function applyChrome(): void {
  const own = isDesktop() && !nativeChrome();
  const root = document.documentElement;
  root.classList.toggle('chrome-own', own);
  root.classList.toggle('chrome-native', isDesktop() && !own);
  const bar = document.querySelector('.topbar'), ctl = document.getElementById('wctl');
  if (bar) { if (own) bar.setAttribute('data-tauri-drag-region', 'deep'); else bar.removeAttribute('data-tauri-drag-region'); }
  if (ctl) ctl.hidden = !own;
}

/** The system title bar again, without touching the choice (for a failed start). */
export async function restoreNativeChrome(): Promise<void> {
  if (!isDesktop()) return;
  try { await win()?.setDecorations(true); } catch { /* nothing more can be done */ }
}

/** Choose the frame: the system title bar (`true`) or the app's own (`false`). Applies at once. */
export function setNativeChrome(on: boolean): void {
  try { localStorage.setItem(LS, on ? '1' : '0'); } catch { /* the choice lasts until the next start */ }
  applyChrome();
  void win()?.setDecorations(on).catch(() => undefined);
}

/**
 * Wire the buttons. `flush` writes what is not saved yet; the close button waits for it (a little) before the window goes.
 */
export function initWindowControls(flush: () => Promise<unknown>): void {
  if (!isDesktop()) return;
  applyChrome();
  const w = win();
  if (!w) return;
  if (nativeChrome()) { void w.setDecorations(true).catch(() => undefined); return; }

  const root = document.documentElement;
  const max = document.getElementById('wc-max');
  let broken = false;
  const refused = (e: unknown): void => {
    if (broken) return;
    broken = true;
    setNativeChrome(true);
    toast(`Власний заголовок вікна не спрацював (${e instanceof Error ? e.message : String(e)}), тому повернуто системний. Змінити це можна в налаштуваннях`);
  };
  const guard = (p: Promise<unknown>): void => { p.catch(refused); };

  const sync = async (): Promise<void> => {
    let m = false;
    try { m = await w.isMaximized(); } catch { /* keep the last known state */ }
    root.classList.toggle('maximized', m);
    if (max) { max.innerHTML = m ? GLYPH.restore : GLYPH.max; const t = m ? 'Відновити розмір' : 'Розгорнути'; max.title = t; max.setAttribute('aria-label', `${t} вікна`); }
  };

  document.getElementById('wc-min')?.addEventListener('click', () => guard(w.minimize()));
  max?.addEventListener('click', () => guard(w.toggleMaximize().then(sync)));
  document.getElementById('wc-close')?.addEventListener('click', () => {
    guard((async () => {
      try { await Promise.race([flush(), new Promise(r => setTimeout(r, 2000))]); } catch { /* the app also saves by itself */ }
      try { await w.close(); } catch { await w.destroy(); }
    })());
  });
  guard(w.onResized(() => { void sync(); }));
  void sync();
}
