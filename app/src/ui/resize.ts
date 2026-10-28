/** Draggable edges of the left panel: its width, and (when files and rows are shown together) the split between them. */
const KEY = 'transly.panel';
interface Sizes { w: number; split: number; rw: number; pw: number[] }
const DEFAULT: Sizes = { w: 300, split: 0.5, rw: 350, pw: [1, 1, 1, 1] };
const MIN_W = 200, MAX_W = 640, MIN_RW = 260;

const load = (): Sizes => {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Sizes>; return { w: clamp(v.w ?? DEFAULT.w, MIN_W, MAX_W), split: clamp(v.split ?? DEFAULT.split, 0.15, 0.85), rw: clamp(v.rw ?? DEFAULT.rw, MIN_RW, MAX_W), pw: Array.isArray(v.pw) && v.pw.length === 4 ? v.pw.map(x => clamp(x, 0.2, 5)) : [...DEFAULT.pw] }; } catch { return { ...DEFAULT, pw: [...DEFAULT.pw] }; }
};
const clamp = (n: number, lo: number, hi: number): number => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);

export function initResize(): void {
  const panel = document.getElementById('lpanel');
  const hx = document.getElementById('rz-x'), hy = document.getElementById('rz-y');
  if (!panel || !hx || !hy) return;
  const sz = load();
  const apply = (): void => {
    document.documentElement.style.setProperty('--lpw', `${sz.w}px`);
    panel.style.setProperty('--split', String(sz.split));
    hx.setAttribute('aria-valuenow', String(Math.round(sz.w)));
    hy.setAttribute('aria-valuenow', String(Math.round(sz.split * 100)));
    document.documentElement.style.setProperty('--rpw', `${sz.rw}px`);
    sz.pw.forEach((w, i) => document.documentElement.style.setProperty(`--pw${i}`, String(w)));
    document.getElementById('rz-r')?.setAttribute('aria-valuenow', String(Math.round(sz.rw)));
  };
  const save = (): void => { try { localStorage.setItem(KEY, JSON.stringify(sz)); } catch { /* private mode */ } };
  apply();

  const drag = (h: HTMLElement, move: (e: PointerEvent) => void): void => {
    h.addEventListener('pointerdown', e => {
      e.preventDefault(); h.setPointerCapture(e.pointerId); h.classList.add('drag'); document.body.classList.add('resizing');
      const on = (ev: PointerEvent): void => { move(ev); apply(); };
      const done = (): void => { h.classList.remove('drag'); document.body.classList.remove('resizing'); h.removeEventListener('pointermove', on); h.removeEventListener('pointerup', done); h.removeEventListener('pointercancel', done); save(); };
      h.addEventListener('pointermove', on); h.addEventListener('pointerup', done); h.addEventListener('pointercancel', done);
    });
  };
  drag(hx, e => { sz.w = clamp(e.clientX - panel.getBoundingClientRect().left, MIN_W, MAX_W); });
  drag(hy, e => { const r = panel.getBoundingClientRect(), top = r.top + 34; sz.split = clamp((e.clientY - top) / Math.max(1, r.bottom - top), 0.15, 0.85); });
  const keys = (h: HTMLElement, step: (d: number) => void): void => h.addEventListener('keydown', e => {
    const d = e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : 0;
    if (!d) return; e.preventDefault(); step(d * (e.shiftKey ? 5 : 1)); apply(); save();
  });
  keys(hx, d => { sz.w = clamp(sz.w + d * 10, MIN_W, MAX_W); });
  keys(hy, d => { sz.split = clamp(sz.split + d * 0.03, 0.15, 0.85); });
  hx.addEventListener('dblclick', () => { sz.w = DEFAULT.w; apply(); save(); });
  hy.addEventListener('dblclick', () => { sz.split = DEFAULT.split; apply(); save(); });
}

/** The right zone is created with the editing view, so its handles are driven by delegation. */
export function initRightResize(): void {
  const KEYR = KEY;
  const read = (): Sizes => load();
  const write = (z: Sizes): void => { try { localStorage.setItem(KEYR, JSON.stringify(z)); } catch { /* private mode */ } };
  const css = (z: Sizes): void => {
    const r = document.documentElement.style;
    r.setProperty('--rpw', `${z.rw}px`);
    z.pw.forEach((w, i) => r.setProperty(`--pw${i}`, String(w)));
    document.getElementById('rz-r')?.setAttribute('aria-valuenow', String(Math.round(z.rw)));
  };
  css(read());
  document.addEventListener('pointerdown', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('#rz-r,.rz-p');
    if (!t) return;
    e.preventDefault(); t.setPointerCapture(e.pointerId); t.classList.add('drag'); document.body.classList.add('resizing');
    const z = read();
    const fs = document.querySelector<HTMLElement>('.fs .ibody')!;
    const panes = [...document.querySelectorAll<HTMLElement>('.ibody .pane')];
    // The splitter sits right before pane `i + 1`; its upper neighbour is the nearest pane above that is shown.
    const i = Number(t.dataset.rzp ?? 0);
    const lower = i + 1;
    let upper = lower - 1;
    while (upper > 0 && !panes[upper]?.classList.contains('on')) upper--;
    const heights = panes.map(p => p.getBoundingClientRect().height);
    const y0 = e.clientY;
    const on = (ev: PointerEvent): void => {
      if (t.id === 'rz-r') z.rw = clamp(fs.getBoundingClientRect().right - ev.clientX, MIN_RW, MAX_W);
      else {
        const d = clamp(ev.clientY - y0, 60 - (heights[upper] ?? 0), (heights[lower] ?? 0) - 60);
        const px = heights.map((h, k) => (k === upper ? h + d : k === lower ? h - d : h));
        const shown = px.filter((_, k) => panes[k]?.classList.contains('on'));
        const mean = shown.reduce((a, b) => a + b, 0) / Math.max(1, shown.length);
        z.pw = px.map((h, k) => (panes[k]?.classList.contains('on') ? clamp(h / mean, 0.2, 5) : z.pw[k] ?? 1));
      }
      css(z);
    };
    const done = (): void => { t.classList.remove('drag'); document.body.classList.remove('resizing'); t.removeEventListener('pointermove', on); t.removeEventListener('pointerup', done); t.removeEventListener('pointercancel', done); write(z); };
    t.addEventListener('pointermove', on); t.addEventListener('pointerup', done); t.addEventListener('pointercancel', done);
  });
  document.addEventListener('dblclick', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('#rz-r,.rz-p');
    if (!t) return;
    const z = read();
    if (t.id === 'rz-r') z.rw = DEFAULT.rw; else z.pw = [...DEFAULT.pw];
    css(z); write(z);
  });
  document.addEventListener('keydown', e => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('#rz-r');
    if (!t || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    e.preventDefault();
    const z = read(); z.rw = clamp(z.rw + (e.key === 'ArrowLeft' ? 10 : -10), MIN_RW, MAX_W); css(z); write(z);
  });
}
