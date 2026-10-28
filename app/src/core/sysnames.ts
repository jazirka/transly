import type { GameFile, PageInfo } from './model';

/** Names the developer gave to switches and variables, and the currency: they explain `\V[12]` and event conditions. */
export interface SysNames {
  variables: Record<string, string>;
  switches: Record<string, string>;
  currency?: string;
}

export function sysNamesOf(files: GameFile[]): SysNames | undefined {
  const j = files.find(f => f.name === 'System.json')?.json as Record<string, unknown> | undefined;
  if (!j || typeof j !== 'object') return undefined;
  const list = (v: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (Array.isArray(v)) v.forEach((n, i) => { if (typeof n === 'string' && n.trim()) out[String(i)] = n.trim(); });
    return out;
  };
  const variables = list(j.variables), switches = list(j.switches);
  const currency = typeof j.currencyUnit === 'string' && j.currencyUnit ? j.currencyUnit : undefined;
  return Object.keys(variables).length || Object.keys(switches).length || currency ? { variables, switches, ...(currency ? { currency } : {}) } : undefined;
}

const TRIGGERS = ['кнопка дії', 'дотик гравця', 'дотик події', 'автозапуск', 'паралельний процес'];

/** The conditions of an event page as short Ukrainian phrases. */
export function describePage(p: PageInfo, names?: SysNames): string[] {
  const sw = (id: number) => `перемикач ${id}${names?.switches[id] ? ` «${names.switches[id]}»` : ''} увімкнено`;
  const out = [`запуск: ${TRIGGERS[p.trigger] ?? p.trigger}`, `клітинка ${p.x}, ${p.y}`];
  for (const id of p.switches) out.push(sw(id));
  if (p.variable) out.push(`змінна ${p.variable.id}${names?.variables[p.variable.id] ? ` «${names.variables[p.variable.id]}»` : ''} ≥ ${p.variable.min}`);
  if (p.selfSwitch) out.push(`локальний перемикач ${p.selfSwitch}`);
  if (p.item) out.push(`є предмет ${p.item}`);
  if (p.actor) out.push(`в групі персонаж ${p.actor}`);
  return out;
}
