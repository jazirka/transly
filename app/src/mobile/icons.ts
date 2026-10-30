const P = (d: string): string => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS: Record<string, string> = {
  files: P('<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  rows: P('<path d="M4 6h16M4 12h16M4 18h10"/>'),
  edit: P('<path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/>'),
  more: P('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  search: P('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/>'),
  copy: P('<rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>'),
  book: P('<path d="M5 4.5h10a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M8 8h6"/>'),
  send: P('<path d="M4 12l16-8-6 16-3-6.5z"/><path d="M11 13.5L20 4"/>'),
  down: P('<path d="M6 9l6 6 6-6"/>'),
  prev: P('<path d="M15 5l-7 7 7 7"/>'),
  next: P('<path d="M9 5l7 7-7 7"/>'),
  check: P('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  folder: P('<path d="M3 7.5a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  sync: P('<path d="M20 11a8 8 0 0 0-14-4M4 5v4h4M4 13a8 8 0 0 0 14 4M20 19v-4h-4"/>'),
};
export const icon = (name: string): string => ICONS[name] ?? '';
