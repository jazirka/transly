import { gunzip, gzip } from './crypto';
import type { Translations } from './model';
import { deserialize, mergeProjects } from './project';
import type { SavedProject } from './project';

/**
 * Sync a project through any shared set of files (a GitHub repository, the artifact's own database…). The project
 * is stored as plain, diff-friendly files:
 *
 *   project.json                    glossary, memory, speakers, settings (everything but the per-file work)
 *   translations/<file>.tr.json     one file per game file: unit key → translation, status, comments, history
 *   originals/snapshot.json.gz      the game's original strings (so a phone without the game can show them)
 *   originals/reference.json.gz     the reference-language texts
 *
 * Several devices write to the same place; each sync downloads what changed, merges it unit by unit (the newer edit
 * wins, like every other merge here) and writes the result back as one change. The place itself is a `RemoteFiles`.
 */
export interface RemoteFiles {
  /** The current state: an opaque id of this state, and the content id (see {@link gitBlobSha}) of every file. */
  head(): Promise<{ id: string; files: Map<string, string>; isPrivate: boolean }>;
  /** The bytes of one file, as listed by `head`. */
  read(path: string, sha: string): Promise<Uint8Array>;
  /** Write these files as one change on top of the state `id`. `ok: false` when someone else wrote since. */
  push(id: string, changes: Map<string, Uint8Array>, message: string): Promise<{ ok: true; id: string } | { ok: false }>;
}

export interface FilesOptions {
  /** Folder inside the shared place; empty = the root. */
  dir: string;
  /** Keep the game's original strings there. Only done when the place is private. */
  originals: boolean;
}

/** What this device saw in the shared place last time; lets the next sync download only what changed. */
export interface FilesState {
  shas: Record<string, string>;
  /** Id of the state we last saw or wrote. */
  commit: string;
  /** Revision of the game's originals as stored there. */
  assetsRev: number;
}
export const EMPTY_FILES_STATE: FilesState = { shas: {}, commit: '', assetsRev: 0 };

export interface FilesReport {
  project: SavedProject;
  /** Files downloaded. */
  pulled: number;
  /** Files written (0 = nothing to push). */
  pushed: number;
  conflicts: number;
  gotSnapshot: boolean;
  /** The place is not private, so the game's original strings were left out of it. */
  skippedOriginals: boolean;
  state: FilesState;
}

export const enc = new TextEncoder();
export const dec = new TextDecoder();

/** Same JSON for the same data on every device (keys sorted at every level), so unchanged work is never re-pushed. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, canonical(x)]));
  return v;
}
const pretty = (v: unknown): string => JSON.stringify(canonical(v), null, 1) + '\n';

const toHex = (b: ArrayBuffer): string => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');

/** The id git gives a file: SHA-1 of "blob <size>\0" and the bytes. Lets us tell what changed without downloading. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const head = enc.encode(`blob ${bytes.length}\0`);
  const all = new Uint8Array(head.length + bytes.length);
  all.set(head); all.set(bytes, head.length);
  return toHex(await crypto.subtle.digest('SHA-1', all));
}

export const b64 = (bytes: Uint8Array): string => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
export const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s.replace(/\s/g, '')), c => c.charCodeAt(0));

export const normDir = (d: string): string => { const t = d.trim().replace(/^\/+|\/+$/g, ''); return t ? t + '/' : ''; };

/** The files for a project. Binary assets are included only when asked. */
export async function projectFiles(p: SavedProject, dirIn: string, withAssets: boolean): Promise<Map<string, Uint8Array>> {
  const dir = normDir(dirIn);
  const out = new Map<string, Uint8Array>();
  const { files, snapshot: _s, reference: _r, ...manifest } = p;
  out.set(`${dir}project.json`, enc.encode(pretty(manifest)));
  for (const [name, entries] of Object.entries(files)) if (Object.keys(entries).length) out.set(`${dir}translations/${name}.tr.json`, enc.encode(pretty(entries)));
  if (withAssets && p.snapshot) out.set(`${dir}originals/snapshot.json.gz`, await gzip(enc.encode(JSON.stringify(p.snapshot))));
  if (withAssets && p.reference) out.set(`${dir}originals/reference.json.gz`, await gzip(enc.encode(JSON.stringify(p.reference))));
  return out;
}

type Json = Record<string, unknown>;
const asObj = (v: unknown): Json => (v && typeof v === 'object' ? (v as Json) : {});

async function inBatches<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += n) await Promise.all(items.slice(i, i + n).map(fn));
}

export async function syncFiles(remote: RemoteFiles, cfg: FilesOptions, state: FilesState, local: SavedProject, opts: { since?: number; maxTries?: number } = {}): Promise<FilesReport> {
  const dir = normDir(cfg.dir);
  const since = opts.since ?? 0, maxTries = opts.maxTries ?? 4;

  let project = local;
  let pulled = 0, conflicts = 0, gotSnapshot = false, skippedOriginals = false;

  for (let attempt = 0; attempt < maxTries; attempt++) {
    const head = await remote.head();
    const withAssets = cfg.originals && head.isPrivate;
    skippedOriginals = cfg.originals && !head.isPrivate;
    const remoteFiles = new Map([...head.files].filter(([path]) => path.startsWith(dir)));

    // ---- download what changed since this device last looked, and what differs from what we would write
    const mine = await projectFiles(project, dir, withAssets);
    const mineSha = new Map<string, string>();
    for (const [path, bytes] of mine) mineSha.set(path, await gitBlobSha(bytes));
    const wanted = (path: string) => path === `${dir}project.json` || (path.startsWith(`${dir}translations/`) && path.endsWith('.tr.json'));
    // A file we already hold (same content) or saw last time needs no download, unless this device lost its copy.
    const toGet = [...remoteFiles].filter(([path, sha]) => wanted(path) && (state.shas[path] !== sha || !mine.has(path)) && mineSha.get(path) !== sha).map(([path]) => path);
    const blobs = new Map<string, Uint8Array>();
    await inBatches(toGet, 6, async path => { blobs.set(path, await remote.read(path, remoteFiles.get(path)!)); });
    pulled += toGet.length;

    const pj = `${dir}project.json`;
    // The revision of the originals the remote holds: from its project.json when we read it, else what we knew.
    let remoteRev = remoteFiles.get(pj) === mineSha.get(pj) ? (project.assetsRev ?? 0) : state.assetsRev;
    if (toGet.length) {
      const files: Record<string, Translations> = {};
      for (const path of toGet) if (path.startsWith(`${dir}translations/`)) files[path.slice(`${dir}translations/`.length, -'.tr.json'.length)] = JSON.parse(dec.decode(blobs.get(path)!)) as Translations;
      const manifestBytes = blobs.get(pj);
      // Without a changed project.json the remote has nothing new but per-file work: merge it onto our own manifest.
      const manifest: Json = manifestBytes ? asObj(JSON.parse(dec.decode(manifestBytes))) : (() => { const { files: _f, snapshot: _s, reference: _r, ...m } = project; return m as Json; })();
      const theirs = deserialize(JSON.stringify({ ...manifest, files }));
      if (manifestBytes) remoteRev = theirs.assetsRev ?? 0;
      const myRev = project.assetsRev ?? 0;
      let remoteProject = theirs;
      let gotAssets = false;
      if (remoteRev > myRev && withAssets) {
        const read = async (path: string) => JSON.parse(dec.decode(await gunzip(await remote.read(path, remoteFiles.get(path)!)))) as unknown;
        const snapPath = `${dir}originals/snapshot.json.gz`, refPath = `${dir}originals/reference.json.gz`;
        const assets: Json = {};
        if (remoteFiles.has(snapPath)) { assets.snapshot = await read(snapPath); pulled++; }
        if (remoteFiles.has(refPath)) { assets.reference = await read(refPath); pulled++; }
        if (assets.snapshot || assets.reference) { remoteProject = { ...theirs, ...assets } as SavedProject; gotAssets = gotSnapshot = true; }
      }
      const m = mergeProjects(project, remoteProject, since);
      conflicts += m.conflicts.length;
      project = m.project;
      // Do not claim a newer revision of the originals than we actually hold.
      if (remoteRev > myRev && !gotAssets && !project.snapshot) { const { assetsRev: _a, ...rest } = project; project = { ...rest, ...(myRev ? { assetsRev: myRev } : {}) }; }
    }

    // ---- what to write: files whose content differs from the remote; originals only when they are new there
    const out = await projectFiles(project, dir, withAssets);
    const outSha = new Map<string, string>();
    for (const [path, bytes] of out) outSha.set(path, await gitBlobSha(bytes));
    const isAsset = (p: string) => p.startsWith(`${dir}originals/`);
    const newer = (project.assetsRev ?? 0) > remoteRev;
    const changed = [...out.keys()].filter(p => (isAsset(p) ? !remoteFiles.has(p) || newer : outSha.get(p) !== remoteFiles.get(p)));
    const pushedAssets = changed.some(isAsset);

    const nextShas: Record<string, string> = {};
    for (const [p, sha] of remoteFiles) if (wanted(p) || isAsset(p)) nextShas[p] = sha;
    if (!changed.length) return { project, pulled, pushed: 0, conflicts, gotSnapshot, skippedOriginals, state: { shas: nextShas, commit: head.id, assetsRev: remoteRev } };

    const res = await remote.push(head.id, new Map(changed.map(p => [p, out.get(p)!])), `Transly: синхронізація (${changed.length} ${changed.length === 1 ? 'файл' : 'файлів'})`);
    if (!res.ok) continue; // someone wrote in between: merge their work and try again
    for (const p of changed) nextShas[p] = outSha.get(p)!;
    return { project, pulled, pushed: changed.length, conflicts, gotSnapshot, skippedOriginals, state: { shas: nextShas, commit: res.id, assetsRev: pushedAssets ? project.assetsRev ?? 0 : remoteRev } };
  }
  throw new Error('Інший пристрій постійно змінює дані. Спробуйте ще раз');
}
