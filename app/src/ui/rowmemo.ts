/**
 * The row each open file was left on, so that a tab opens where the translator stopped (kept on this device, per project).
 * A pure helper: the key of the row of a file, loaded and saved through localStorage (a private window or a full disk just means «no memory»).
 */

const KEY = (project: string): string => 'transly.rowat:' + project;

export type RowMemo = Record<string, string>;

export function loadRowMemo(project: string): RowMemo {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY(project)) ?? '{}') as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch { return {}; }
}

export function saveRowMemo(project: string, memo: RowMemo): void {
  try { localStorage.setItem(KEY(project), JSON.stringify(memo)); } catch { /* no memory, no harm */ }
}

/** The number a row has in its file (1-based), or 0 when it is not there. */
export function rowNumber(units: readonly { key: string }[], key: string | undefined): number {
  if (key === undefined) return 0;
  const i = units.findIndex(u => u.key === key);
  return i + 1;
}
