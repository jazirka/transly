import { sceneTitle, statsOf } from '../core';
import type { SceneInfo } from '../core';
import { $, esc, plural } from './dom';
import { scenesOf } from './focus';
import { GROUP } from './state';
import type { Ctx } from './state';

/**
 * The scenes of the open file as a section of the left panel, next to the files, the rows and the glossary: where the
 * translator is (file → scene → line), and a way to go to any scene. A scene is one event page of the game; files
 * without events (the database, the system file, text formats) have none, and are not split artificially.
 */

const SEARCH = '<svg viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/></svg>';

export const SCENES_HTML = `<div class="slist scpanel" id="lp-sc" hidden>
  <div class="ph card-ph" data-card="scenes"><span class="grow">Сцени</span><span class="ico" data-hide-left="scenes" role="button" tabindex="0" aria-label="Сховати панель «Сцени»" title="Сховати">—</span></div>
  <div class="fh"><div class="fin">${SEARCH}<input class="qin" id="sc-q" placeholder="Пошук сцени" aria-label="Пошук сцени" autocomplete="off" spellcheck="false"></div><div class="gl-bar"><span class="hint" id="sc-n"></span></div></div>
  <div class="sl-body" id="sc-list"></div>
</div>`;

let query = '';

const norm = (s: string): string => s.trim().toLowerCase();

function item(ctx: Ctx, file: string, sc: SceneInfo, current: boolean): string {
  const st = statsOf(sc.units, ctx.entries(file));
  const pc = Math.round((100 * Math.max(st.translated, st.approved)) / st.total);
  const state = st.approved === st.total ? 'appr' : st.translated === st.total ? 'done' : st.translated ? 'draft' : 'new';
  return `<button class="sc-item ${current ? 'cur' : ''}" type="button" data-scene="${esc(sc.id)}" ${current ? 'aria-current="true"' : ''} title="${esc(sceneTitle(sc))}: перекладено ${st.translated} із ${st.total}, вичитано ${st.approved}">
    <span class="sd ${state}" aria-hidden="true"></span>
    <span class="sc-t">${esc(sceneTitle(sc))}</span>
    <span class="sc-n">${st.translated}/${st.total}</span>
    <span class="mini" aria-hidden="true"><i class="${st.approved === st.total ? 'f' : ''}" style="width:${pc}%"></i></span>
  </button>`;
}

export function renderScenesPanel(ctx: Ctx): void {
  const { s } = ctx;
  const v = s.current && s.current !== GROUP ? s.views.find(x => x.name === s.current) : undefined;
  const idx = v ? scenesOf(v.units) : null;
  const box = $('#sc-list');
  if (!v || !idx) {
    $('#sc-n').textContent = '';
    box.innerHTML = `<div class="empty-state"><b>${s.current === GROUP ? 'Відкрито кілька файлів' : 'У цьому файлі немає сцен'}</b><span>${s.current === GROUP ? 'Відкрийте один файл, щоб побачити його сцени.' : 'Сцени є лише в картах, спільних подіях і боях: у базі даних рядки не складаються в сцени.'}</span></div>`;
    return;
  }
  const q = norm(query);
  const here = s.cur ? idx.byKey.get(s.cur) : undefined;
  const list = idx.scenes.map((sc, i) => [sc, i] as const).filter(([sc]) => !q || norm(sceneTitle(sc)).includes(q));
  $('#sc-n').textContent = `${plural(idx.scenes.length, ['сцена', 'сцени', 'сцен'])}${q ? ` · знайдено ${list.length}` : ''}${idx.loose.length ? ` · ще ${plural(idx.loose.length, ['рядок', 'рядки', 'рядків'])} поза сценами` : ''}`;
  box.innerHTML = list.length ? list.map(([sc, i]) => item(ctx, v.name, sc, i === here)).join('') : '<div class="empty-state"><b>Нічого не знайдено</b></div>';
}

export function wireScenes(ctx: Ctx): void {
  $('#sc-q').addEventListener('input', () => { query = ($('#sc-q') as HTMLInputElement).value; renderScenesPanel(ctx); });
}

/** A click on a scene: go to its first line that has no translation yet, or to its first line (the mode stays, so the panel stays). */
export function scenesClick(ctx: Ctx, t: HTMLElement): boolean {
  const b = t.closest<HTMLElement>('#lp-sc [data-scene]');
  if (!b) return false;
  const { s } = ctx;
  const v = s.current && s.current !== GROUP ? s.views.find(x => x.name === s.current) : undefined;
  const sc = v ? scenesOf(v.units)?.scenes.find(x => x.id === b.dataset.scene) : undefined;
  if (!v || !sc) return true;
  const ents = ctx.entries(v.name);
  const target = sc.units.find(u => !ents[u.key]?.target) ?? sc.units[0];
  if (target) ctx.select(target.key);
  return true;
}
