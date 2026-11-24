import { test } from 'vitest';
import { gunzip } from '../../src/core/crypto';
import { EMPTY_FILES_STATE, gitBlobSha, normDir, projectFiles, syncFiles } from '../../src/core/filesync';
import type { FilesOptions, FilesState, RemoteFiles } from '../../src/core/filesync';
import { deserialize, serialize } from '../../src/core/project';
import type { SavedProject } from '../../src/core/project';
import { rng, writeVectors } from './util';
import type { Rng } from './util';

const dec = new TextDecoder();
const enc = new TextEncoder();

class Mock implements RemoteFiles {
  files = new Map<string, Uint8Array>();
  id = 'c0'; n = 0; pushes = 0;
  messages: string[] = [];
  constructor(public isPrivate: boolean, public interfere: { onPush: number; files: Record<string, string> } | null) {}
  async head() { const m = new Map<string, string>(); for (const [p, b] of this.files) m.set(p, await gitBlobSha(b)); return { id: this.id, files: m, isPrivate: this.isPrivate }; }
  async read(path: string): Promise<Uint8Array> { return this.files.get(path)!; }
  async push(id: string, changes: Map<string, Uint8Array>, message: string): Promise<{ ok: true; id: string } | { ok: false }> {
    this.pushes++;
    if (this.interfere && this.pushes === this.interfere.onPush) { for (const [p, t] of Object.entries(this.interfere.files)) this.files.set(p, enc.encode(t)); this.id = `c${++this.n}`; }
    if (id !== this.id) return { ok: false };
    for (const [p, b] of changes) this.files.set(p, b);
    this.messages.push(message);
    this.id = `c${++this.n}`;
    return { ok: true, id: this.id };
  }
  async listing(): Promise<[string, string][]> {
    const out: [string, string][] = [];
    for (const [p, b] of [...this.files].sort(([a], [c]) => (a < c ? -1 : a > c ? 1 : 0))) out.push([p, p.endsWith('.gz') ? dec.decode(await gunzip(b)) : dec.decode(b)]);
    return out;
  }
}

const ENTRY_TEXTS = ['Привіт', 'Hello', 'Так', '', 'Ні', 'Ґанок'];
function genProject(r: Rng, name: string): Record<string, unknown> {
  const files: Record<string, Record<string, unknown>> = {};
  for (const f of ['a.json', 'b.json', 'dir/c.json']) {
    if (r.chance(0.2)) continue;
    const rows: Record<string, unknown> = {};
    for (const k of ['k1', 'k2', 'k3']) if (r.chance(0.7)) rows[k] = { target: r.pick(ENTRY_TEXTS), status: r.pick(['draft', 'done', 'appr']), mt: 1000 + r.int(50), ...(r.chance(0.5) ? { src: 'Source ' + k } : {}) };
    files[f] = rows;
  }
  return {
    version: 1, name, sourceLang: 'en', targetLang: 'uk', resetEpoch: 0, files, memory: r.chance(0.3) ? [{ s: 'a', t: 'b', mt: 5 }] : [], terms: r.chance(0.4) ? [{ en: 'sword', uk: 'меч', mt: 7 }] : [],
    settings: { tolerancePct: 25, blockErrors: true, who: 'Ви', propagate: true, pluginCommands: [], pluginsAsked: false, lineLimit: 0 },
    ...(r.chance(0.3) ? { stamps: { copy: { mt: 1, how: 'x' } } } : {}),
    ...(r.chance(0.4) ? { snapshot: { 'a.json': [{ key: 'k1', source: 'Hi', speaker: '', kind: 'dialogue', context: '' }] }, assetsRev: r.pick([1, 2]) } : {}),
    ...(r.chance(0.2) ? { reference: { lang: 'pl', texts: { 'a.json': { k1: 'Cześć' } } } } : {}),
  };
}

test('export filesync vectors', async () => {
  const r = rng(777000);
  const out: Record<string, { input: unknown; output: unknown }[]> = {};
  const add = (name: string, input: unknown, output: unknown) => (out[name] ??= []).push({ input, output });

  for (const d of ['', ' ', '/', 'a', '/a/', 'a/b', ' /x/ ', 'a//', '//']) add('normDir', d, normDir(d));

  for (let i = 0; i < 25; i++) {
    const p = deserialize(JSON.stringify(genProject(r, 'p')), 1);
    const dir = r.pick(['', 'sync', '/deep/dir/']);
    const withAssets = r.chance(0.5);
    const files = await projectFiles(p, dir, withAssets);
    const listing: [string, string, string][] = [];
    for (const [path, b] of [...files].sort(([a], [c]) => (a < c ? -1 : a > c ? 1 : 0))) listing.push([path, path.endsWith('.gz') ? dec.decode(await gunzip(b)) : dec.decode(b), path.endsWith('.gz') ? '' : await gitBlobSha(b)]);
    add('files', { project: serialize(p), dir, withAssets }, listing);
  }

  for (let i = 0; i < 45; i++) {
    const ndev = 1 + r.int(3);
    const base = genProject(r, 'p');
    const initial: string[] = Array.from({ length: ndev }, () => JSON.stringify(r.chance(0.5) ? base : genProject(r, 'p')));
    const devs: SavedProject[] = initial.map(t => deserialize(t, 1));
    const states: FilesState[] = devs.map(() => ({ ...EMPTY_FILES_STATE, shas: {} }));
    const cfg: FilesOptions = { dir: r.pick(['', 'sync', '/deep/']), originals: r.chance(0.5) };
    const isPrivate = r.chance(0.6);
    const interfere = r.chance(0.3) ? { onPush: 1 + r.int(2), files: { [`${normDir(cfg.dir)}translations/x.json.tr.json`]: JSON.stringify({ z: { target: 'Чужий', status: 'draft', mt: 2000 } }, null, 1) + '\n' } } : null;
    const remote = new Mock(isPrivate, interfere);
    const steps: { dev: number; edit: { file: string; key: string; target: string; mt: number }[]; since: number }[] = [];
    const log: unknown[] = [];
    const nsteps = 2 + r.int(5);
    for (let s = 0; s < nsteps; s++) {
      const dev = r.int(ndev);
      const edit = r.chance(0.6) ? Array.from({ length: 1 + r.int(2) }, () => ({ file: r.pick(['a.json', 'b.json', 'new.json']), key: r.pick(['k1', 'k2', 'k9']), target: r.pick(ENTRY_TEXTS) || 'x', mt: 3000 + s * 10 + r.int(5) })) : [];
      const since = r.chance(0.2) ? 1500 : 0;
      steps.push({ dev, edit, since });
      let local = devs[dev]!;
      if (edit.length) {
        local = JSON.parse(JSON.stringify(local)) as SavedProject;
        for (const e of edit) { (local.files[e.file] ??= {})[e.key] = { target: e.target, status: 'draft', mt: e.mt }; }
      }
      try {
        const rep = await syncFiles(remote, cfg, states[dev]!, local, { since });
        devs[dev] = rep.project; states[dev] = rep.state;
        const shas = Object.fromEntries(Object.entries(rep.state.shas).filter(([p]) => !p.includes('originals/')));
        log.push({ ok: { project: serialize(rep.project), pulled: rep.pulled, pushed: rep.pushed, conflicts: rep.conflicts, gotSnapshot: rep.gotSnapshot, skippedOriginals: rep.skippedOriginals, state: { ...rep.state, shas }, remote: await remote.listing(), id: remote.id, messages: remote.messages.length } });
      } catch (e) { log.push({ err: (e as Error).message }); }
    }
    add('sync', { initial, cfg, isPrivate, interfere, steps }, { log });
  }
  writeVectors('filesync', out);
});
