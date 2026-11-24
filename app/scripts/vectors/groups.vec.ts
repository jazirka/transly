import { test } from 'vitest';
import type { Entry, Translations, Unit } from '../../src/core/model';
import { sceneAddress, sceneKey, sceneLines, sceneUnits } from '../../src/core/scene';
import { buildSceneIndex, sceneAt, sceneTitle, stepScene } from '../../src/core/sceneindex';
import { headerName, speakerCandidates, speakerOf } from '../../src/core/speakers';
import { GroupIndex, createGroup, deleteGroup, findOrphans, groupBySpeaker, groupByScene, groupRows, liveGroups, placeFile, placeRows, placeScene, recolorGroup, renameGroup, rowsOfGroup, rowsProgress } from '../../src/core/groups';
import type { GroupData } from '../../src/core/groups';
import { LinkIndex, afterSend, clearMain, linkChanges, linkModeOf, linkView, pendingLinks, planLinkSync, relinkRow, reviewClusters, setMain, unlinkRow } from '../../src/core/links';
import type { LinkMode, LinkView } from '../../src/core/links';
import type { FileView, SavedProject } from '../../src/core/project';
import { emptyProject } from '../../src/core/project';
import { genEntry } from './entrygen';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const VOCAB = ['Hello', 'Hi there', 'Yes', 'No', 'Run!', 'Take it', 'Open', 'Fire', 'Ice', 'Wait', 'x'];
const NAMES = ['Anna', 'Ґанна', 'Анна', 'Єва', 'іван', 'Іван', 'Їжак', 'Zed', 'zed', 'Alpha', 'alpha 2', 'Alpha 10', 'ґанок', 'Гном', 'Яна', 'Ярослав', 'ёж', 'Zoë', '1st', '  spaced   name ', 'Ab', 'AB', 'ab'];
const FACES = ['Actor1#3', 'Actor2#0', 'Monster#1'];
const NOTES = ['MARCOH', 'SMALL_TALK', 'ELDER'];
const EVENTS = ['ghoul111', 'villager_a', 'guard'];
const HDR = ['\\>\\i[73]\\}ANITOR\\{\\<\nHello there', '\\i[64]\\}LEX\\{\\< hi', '\\>\\i[100]\\}BAD\\{\\<\nx', '\\>\\i[84]\\}EV\\{\\<\n', 'no header'];

const unit = (key: string, source: string, kind: Unit['kind'], context: string, extra: Partial<Unit> = {}): Unit => ({ key, source, speaker: '', kind, context, ...extra });

function genFile(r: Rng, name: string): FileView {
  const units: Unit[] = [];
  const src = (): string => (r.chance(0.12) ? r.pick(HDR) : r.pick(VOCAB));
  const spk = (): Partial<Unit> => ({ ...(r.chance(0.2) ? { speaker: r.pick(['Anna', 'Bob']) } : {}), ...(r.chance(0.4) ? { face: r.pick(FACES) } : {}), ...(r.chance(0.3) ? { note: r.pick(NOTES) } : {}), ...(r.chance(0.4) ? { event: r.pick(EVENTS) } : {}) });
  const list = (prefix: string, ctx: string, pageInfo: boolean): void => {
    for (let l = 0, first = true; l < 1 + r.int(5); l++) {
      const roll = r.next(), base = `${prefix}.list[${l * 2}]`;
      const extra = first && pageInfo ? { page: { trigger: r.int(5), x: r.int(9), y: r.int(9), switches: [r.int(5)] } } : {};
      if (roll < 0.15) { for (let c = 0; c < 1 + r.int(3); c++) units.push(unit(`${base}.choice[${c}]`, src(), 'choice', ctx, c === 0 ? extra : {})); }
      else if (roll < 0.25) units.push(unit(`${base}.cmd`, src(), 'dialogue', ctx, { ...spk(), ...extra }));
      else units.push(unit(base, src(), r.pick(['dialogue', 'dialogue', 'scroll'] as const), ctx, { ...spk(), ...extra }));
      first = false;
    }
  };
  if (/^Map/.test(name)) {
    units.push(unit('displayName', 'Forest', 'name', ''));
    for (let e = 1; e <= 1 + r.int(3); e++) for (let p = 0; p <= r.int(3); p++) if (r.chance(0.8)) list(`events[${e}].pages[${p}]`, `EV00${e} · ${r.pick(['Старий солдат', 'Guard'])}`, true);
  } else if (name === 'CommonEvents.json') { for (let c = 1; c <= 1 + r.int(3); c++) list(`[${c}]`, `CE${c}`, r.chance(0.5)); }
  else if (name === 'Troops.json') { for (let t = 1; t <= 1 + r.int(2); t++) for (let p = 0; p < 1 + r.int(2); p++) list(`[${t}].pages[${p}]`, `Troop ${t}`, false); }
  else { for (let i = 0; i < 1 + r.int(4); i++) units.push(unit(r.pick([`[${i}].name`, `[${i}].description`, `name${i}`, `L${i}`, `a␟L${i}`]), src(), r.pick(['name', 'description', 'message'] as const), '')); }
  // однакові оригінали поміж файлами для зв'язків
  return { name, units, ...(r.chance(0.3) ? { label: r.pick(['Ліс', '', 'Forest']) } : {}) };
}
function genViews(r: Rng): FileView[] {
  const names = ['Map001.json', 'Map002.json', 'CommonEvents.json', 'Troops.json', 'Items.json'].filter(() => r.chance(0.7));
  return (names.length ? names : ['Map001.json']).map(n => genFile(r, n));
}
function genFiles(r: Rng, views: FileView[]): Record<string, Translations> {
  const files: Record<string, Translations> = {};
  for (const v of views) {
    files[v.name] = {};
    for (const u of v.units) if (r.chance(0.6)) {
      const e = genEntry(r);
      e.target = r.chance(0.1) ? '' : r.pick(['Привіт', 'Так', 'Ні', 'X' + r.int(3)]);
      e.status = r.pick(['new', 'draft', 'done', 'appr'] as const);
      e.mt = r.pick([1, 5, 10, 100]);
      files[v.name]![u.key] = e;
    }
  }
  return files;
}
const allRows = (views: FileView[]) => views.flatMap(v => v.units.map(u => ({ file: v.name, key: u.key })));

const viewJson = (v: LinkView | null) => (v ? { text: v.text, rows: v.rows, self: v.rows.indexOf(v.self), ...(v.reference ? { reference: v.rows.indexOf(v.reference) } : {}), ...(v.main ? { main: v.rows.indexOf(v.main) } : {}) } : null);

test('export groups vectors', () => {
  const r = rng(112358);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  // сцени
  for (const k of ['events[3].pages[0].list[12]', 'events[3].pages[0].list[14].choice[1]', '[5].list[2].cmd', 'name', 'x.list[1]y', '.list[0]', 'a.list[1].list[2]', '[1].pages[2].list[3].choice[0]', 'L12']) add('sceneKey', k, sceneKey(k));
  for (const [f, k] of [['Map012.json', 'events[3].pages[1].list[7]'], ['Map012.json', 'name'], ['CommonEvents.json', '[4].list[9]'], ['Troops.json', '[2].pages[1].list[0]'], ['Troops.json', 'x'], ['Items.json', '[1].list[0]'], ['Mapx.json', 'events[1].pages[0].list[0]'], ['CommonEvents.json', 'events[1].pages[0].list[0]']] as const) add('sceneAddress', { f, k }, sceneAddress(f, k));
  for (let i = 0; i < 20; i++) {
    const views = genViews(r), idx = views.map(v => buildSceneIndex(v.units));
    add('sceneIndex', views, views.map((v, j) => {
      const ix = idx[j]!;
      const keys = v.units.map(u => u.key);
      return {
        index: ix && { scenes: ix.scenes, byKey: [...ix.byKey], loose: ix.loose },
        at: keys.map(k => sceneAt(ix, k)?.id ?? null), titles: ix?.scenes.map(sceneTitle) ?? null,
        steps: keys.map(k => [stepScene(ix, k, 1)?.id ?? null, stepScene(ix, k, -1)?.id ?? null]),
        atNull: sceneAt(null, 'x'), stepNull: stepScene(null, 'x', 1),
        units: keys.slice(0, 6).map(k => [sceneUnits(v.units, k).map(u => u.key), sceneUnits(v.units, k, 2).map(u => u.key)]), unitsMissing: sceneUnits(v.units, 'nope').length,
        lines: ix ? ix.scenes.map(s => sceneLines(s.units)) : [],
      };
    }));
  }

  // мовці
  for (const s of [...HDR, undefined, '', '\\i[73]\\}X\\{\\<', '\\>\\i[64]\\}  \\{\\<']) add('headerName', s ?? null, headerName(s));
  for (let i = 0; i < 40; i++) {
    const views = genViews(r);
    const map = r.chance(0.7) ? Object.fromEntries([['hdr:ANITOR', 'Anna'], ['face:Actor1#3', 'Hero'], ['note:MARCOH', ''], ['event:ghoul111', 'Ghoul'], ['hdr:LEX', 'Lex']].filter(() => r.chance(0.5)).map(([k, n]) => [k, { name: n, mt: 1 }])) : undefined;
    add('speakers', { views, map: map ?? null }, {
      of: views.flatMap(v => v.units.map(u => speakerOf(u, map))),
      cands: speakerCandidates(views), cands1: speakerCandidates(views, 1),
    });
  }

  // групи
  for (let i = 0; i < 30; i++) {
    const views = genViews(r), files = genFiles(r, views), rows = allRows(views);
    const p: GroupData = {};
    const ops: Record<string, unknown>[] = [], results: unknown[] = [], ids: string[] = [];
    let now = 100;
    const pickId = (): string => (ids.length && r.chance(0.85) ? r.pick(ids) : 'nope');
    for (let n = 0; n < 4 + r.int(12); n++) {
      now += 1 + r.int(50);
      const kind = r.pick(['create', 'create', 'rename', 'recolor', 'delete', 'rows', 'rows', 'scene', 'file']);
      if (kind === 'create') {
        const name = r.pick(NAMES), color = r.chance(0.3) ? r.pick(['#111', '#abcdef']) : undefined, rnd = r.next(), suffix = rnd.toString(36).slice(2, 6);
        const orig = Math.random; Math.random = () => rnd;
        const g = createGroup(p, name, now, color); Math.random = orig;
        if (g) ids.push(g.id);
        ops.push({ kind, name, color: color ?? null, suffix, now }); results.push(g);
      } else if (kind === 'rename') { const id = pickId(), name = r.pick(NAMES.concat([''])); ops.push({ kind, id, name, now }); results.push(renameGroup(p, id, name, now)); }
      else if (kind === 'recolor') { const id = pickId(), color = r.pick(['#fff', 'red']); ops.push({ kind, id, color, now }); results.push(recolorGroup(p, id, color, now)); }
      else if (kind === 'delete') { const id = pickId(); ops.push({ kind, id, now }); results.push(deleteGroup(p, id, now)); }
      else if (kind === 'rows') { const id = r.chance(0.15) ? null : pickId(), pick = rows.filter(() => r.chance(0.3)); ops.push({ kind, id, rows: pick, now }); results.push(placeRows(p, views, pick, id, now)); }
      else if (kind === 'scene') { const v = r.pick(views), sc = buildSceneIndex(v.units)?.scenes, id = r.chance(0.2) ? null : pickId(), scene = sc?.length ? r.pick(sc).id : 'nope.list'; ops.push({ kind, file: v.name, scene, id, now }); placeScene(p, v.name, scene, id, now); results.push(null); }
      else { const v = r.pick(views), id = r.chance(0.2) ? null : pickId(); ops.push({ kind, file: v.name, id, now }); placeFile(p, v.name, id, now); results.push(null); }
    }
    // хто куди потрапив, і що лишилось без місця; склад гри змінюється: файл зникає, рядок зникає чи міняється оригінал
    const changed: FileView[] = views.filter(() => r.chance(0.8)).map(v => ({ ...v, units: v.units.filter(() => r.chance(0.85)).map(u => ({ ...u, source: r.chance(0.2) ? u.source + '!' : u.source })) }));
    const idx = new GroupIndex(p);
    const gid = ids.length ? r.pick(ids) : 'nope';
    const speakers = r.chance(0.5) ? { 'face:Actor1#3': { name: 'Hero', mt: 1 } } : undefined;
    add('groups', { views, files, ops, changed, gid, speakers: speakers ?? null }, {
      results, p, live: liveGroups(p), index: { empty: idx.empty, of: rows.map(x => [idx.groupOf(x.file, x.key), idx.groupOf(x.file, x.key, true)]) },
      rows: [...groupRows(p, views)], rowsOf: rowsOfGroup(p, views, gid), orphans: findOrphans(p, changed), orphansAll: findOrphans(p, views),
      progress: rowsProgress(rows, f => files[f] ?? {}), bySpeaker: groupBySpeaker(views, speakers), byScene: groupByScene(views),
    });
  }
  add('groupsEmpty', null, { live: liveGroups({}), rows: [...groupRows({}, [])], create: createGroup({}, '   ', 1), idx: new GroupIndex({}).groupOf('a', 'b') });

  // зв'язки
  for (const m of [undefined, { linkMode: 'auto' }, { linkMode: 'x' }, { propagate: false }, { propagate: true }, { linkMode: 'off', propagate: true }]) add('linkMode', m ?? null, linkModeOf(m as never));
  for (let i = 0; i < 35; i++) {
    const views = genViews(r), files = genFiles(r, views);
    const saved: SavedProject = { ...emptyProject('x'), files };
    const idx = new LinkIndex(views), now = 500;
    const rows = allRows(views);
    // винятки: деякі рядки роз'єднані, деякі гнізда мають головний переклад (частина застаріла)
    const ops: Record<string, unknown>[] = [];
    for (const row of rows) if (r.chance(0.12)) {
      const u = views.find(v => v.name === row.file)!.units.find(x => x.key === row.key)!;
      const kind = r.pick(['unlink', 'unlink', 'main', 'clearMain', 'relink']), src = r.chance(0.15) ? u.source + 'x' : u.source;
      const t = 10 + ops.length;
      ops.push({ kind, ...row, source: src, now: t });
      if (kind === 'unlink') unlinkRow(saved, { ...row, source: src }, t);
      else if (kind === 'main') setMain(saved, { ...row, source: src }, t);
      else if (kind === 'clearMain') clearMain(saved, u.source, t);
      else relinkRow(saved, row, t);
    }
    const sample = rows.filter(() => r.chance(0.3));
    const per = sample.map(x => {
      const plan = planLinkSync(saved, idx, x.file, x.key), v = linkView(saved, idx, x.file, x.key);
      const modes = (['ask', 'auto', 'off'] as LinkMode[]).map(mode => afterSend(saved, idx, mode, x.file, x.key, now));
      return { ...x, others: idx.others(x.file, x.key), view: viewJson(v), plan: plan && { view: viewJson(plan.view), fills: plan.fills.map(q => plan.view.rows.indexOf(q)), updates: plan.updates.map(q => plan.view.rows.indexOf(q)), edited: plan.edited.map(q => plan.view.rows.indexOf(q)) }, modes, changes: plan ? linkChanges(plan.view.reference!.target, plan.fills, now) : null };
    });
    const rc = reviewClusters(saved, idx, 300), rcSmall = reviewClusters(saved, idx, 1);
    const clusters = (c: typeof rc) => ({ total: c.total, clusters: c.clusters.map(k => ({ text: k.text, view: viewJson(k.view), counts: k.counts, variants: k.variants.map(x => ({ target: x.target, rows: x.rows.map(q => k.view.rows.indexOf(q)) })) })) });
    add('links', { views, files, ops, sample, now }, { links: saved.links ?? null, size: idx.size, per, pending: pendingLinks(saved, idx, sample), review: clusters(rc), reviewSmall: clusters(rcSmall), clusters: [...idx.clusters()].map(([t, rs]) => [t, rs.length]) });
  }
  void ({} as Entry);
  writeVectors('groups', out);
});
