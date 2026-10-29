import { buzz, toast } from './dom';
import { step } from './focus';
import type { Ctx } from './state';

const TEXT_FIELD = 'textarea, input:not([type=checkbox]):not([type=radio]):not([type=button])';

/**
 * What only a touch screen needs: the bottom bar gives way to the keyboard, a swipe moves between rows, and a long
 * press on a row opens its actions. Nothing here runs on a wide screen.
 */
export function initMobile(ctx: Ctx): void {
  const { s } = ctx;
  const ide = (): HTMLElement => document.getElementById('ide')!;

  // The keyboard: while a text field has the focus the bottom bar is hidden, and the field is kept in view.
  let kbTimer: ReturnType<typeof setTimeout> | undefined;
  const setKb = (on: boolean): void => { if (s.kb !== on) { s.kb = on; ide().classList.toggle('kb', on); } };
  document.addEventListener('focusin', e => {
    const t = e.target as HTMLElement;
    if (!s.phone || !t.matches(TEXT_FIELD)) return;
    clearTimeout(kbTimer); setKb(true);
    if (t.id === 'i-tr') setTimeout(() => t.scrollIntoView({ block: 'center' }), 250);
  });
  document.addEventListener('focusout', () => { clearTimeout(kbTimer); kbTimer = setTimeout(() => setKb(false), 150); });
  window.visualViewport?.addEventListener('resize', () => {
    const a = document.activeElement;
    if (s.phone && a instanceof HTMLTextAreaElement) a.scrollIntoView({ block: 'nearest' });
  });

  // A swipe across the editor moves to the next / previous row of the list.
  const editor = document.getElementById('v-focus')!;
  let sx = 0, sy = 0, st = 0, swiping = false;
  editor.addEventListener('touchstart', e => {
    swiping = s.phone && e.touches.length === 1 && !(e.target as HTMLElement).closest('textarea, button, input, .morep, .srcbox');
    if (swiping) { sx = e.touches[0]!.clientX; sy = e.touches[0]!.clientY; st = Date.now(); }
  }, { passive: true });
  editor.addEventListener('touchend', e => {
    if (!swiping) return;
    swiping = false;
    const c = e.changedTouches[0]!, dx = c.clientX - sx, dy = c.clientY - sy;
    if (Date.now() - st < 700 && Math.abs(dx) > 80 && Math.abs(dy) < Math.abs(dx) / 2) { buzz(8); step(ctx, dx < 0 ? 1 : -1); }
  }, { passive: true });

  // A long press on a row: its own small menu.
  let press: { timer: ReturnType<typeof setTimeout>; x: number; y: number } | null = null;
  let swallow = false;
  const cancel = (): void => { if (press) { clearTimeout(press.timer); press = null; } };
  const closeMenu = (): void => { document.getElementById('rowmenu')?.remove(); };
  document.addEventListener('touchstart', e => {
    const row = s.phone ? (e.target as HTMLElement).closest<HTMLElement>('.si[data-key], .gr[data-key]') : null;
    closeMenuOnOutside(e.target as HTMLElement);
    if (!row || e.touches.length !== 1) return;
    cancel();
    swallow = false; // a new touch begins a new gesture: the click of the previous long press is over
    const { clientX: x, clientY: y } = e.touches[0]!;
    press = { x, y, timer: setTimeout(() => { press = null; swallow = true; setTimeout(() => { swallow = false; }, 700); buzz(20); openMenu(row.dataset.key!, x, y); }, 520) };
  }, { passive: true });
  document.addEventListener('touchmove', e => {
    if (press && Math.hypot(e.touches[0]!.clientX - press.x, e.touches[0]!.clientY - press.y) > 10) cancel();
  }, { passive: true });
  document.addEventListener('touchend', cancel, { passive: true });
  document.addEventListener('touchcancel', cancel, { passive: true });
  // The click that follows a long press must not also open the row.
  document.addEventListener('click', e => { if (swallow) { swallow = false; e.stopPropagation(); e.preventDefault(); } }, true);

  function closeMenuOnOutside(t: HTMLElement): void { if (!t.closest('#rowmenu')) closeMenu(); }

  function openMenu(key: string, x: number, y: number): void {
    const u = ctx.unit(key);
    if (!u || !s.current) return;
    const target = ctx.entries(s.current)[u.key]?.target ?? '';
    closeMenu();
    const menu = document.createElement('div');
    menu.id = 'rowmenu'; menu.className = 'pop rowmenu'; menu.setAttribute('role', 'menu');
    const item = (label: string, fn: () => void, off = false): void => {
      const b = document.createElement('button');
      b.textContent = label; b.disabled = off;
      b.addEventListener('click', () => { closeMenu(); fn(); });
      menu.appendChild(b);
    };
    const copy = (text: string, what: string): void => { void navigator.clipboard?.writeText(text).then(() => toast(`${what} скопійовано`), () => toast('Не вдалося скопіювати')); };
    item('Відкрити в редакторі', () => ctx.select(key, 'edit'));
    item('Копіювати оригінал', () => copy(u.source, 'Оригінал'));
    item('Копіювати переклад', () => copy(target, 'Переклад'), !target);
    document.body.appendChild(menu);
    menu.hidden = false;
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.offsetHeight - 8))}px`;
  }

  // Compact editor: only the text on the screen.
  document.addEventListener('click', e => {
    if (!(e.target as HTMLElement).closest('#b-compact')) return;
    s.compact = !s.compact;
    ide().classList.toggle('compact', s.compact);
    try { localStorage.setItem('transly.compact', s.compact ? '1' : '0'); } catch { /* private mode */ }
    buzz(8);
  });

  // Work left unfinished must survive the app being put in the background.
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void ctx.autosave.flush(); });
}
