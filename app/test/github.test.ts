import { describe, expect, it } from 'vitest';
import { EMPTY_GITHUB_STATE, emptyProject, githubSync, gitBlobSha } from '../src/core';
import type { Entry, GithubSettings, GithubState, SavedProject, Unit } from '../src/core';
import { MockGithub } from './mock-github';

const cfg = (o: Partial<GithubSettings> = {}): GithubSettings => ({ repo: 'me/tr', branch: '', dir: '', originals: true, ...o });
const entry = (target: string, mt: number): Entry => ({ target, status: 'draft', mt });
const unit = (key: string, source: string): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: 'c' });
const withFile = (p: SavedProject, file: string, e: Record<string, Entry>): SavedProject => ({ ...p, files: { ...p.files, [file]: { ...(p.files[file] ?? {}), ...e } } });
const pc = (): SavedProject => ({ ...withFile(withFile(emptyProject('Гра'), 'Map001.json', { a: entry('Привіт', 10), b: entry('Бувай', 11) }), 'Items.json', { '[1].name': entry('Смолоскип', 12) }), snapshot: { 'Map001.json': [unit('a', 'Hello'), unit('b', 'Bye')] }, assetsRev: 100 });

class Device {
  state: GithubState = EMPTY_GITHUB_STATE;
  constructor(public project: SavedProject, readonly gh: MockGithub, readonly settings: GithubSettings = cfg()) {}
  async sync(since = 0) {
    const r = await githubSync(this.gh, this.settings, this.state, this.project, { since });
    this.project = r.project; this.state = r.state;
    return r;
  }
}

describe('github sync', () => {
  it('first push writes readable files and one commit; the originals go in gzipped', async () => {
    const gh = new MockGithub();
    const a = new Device(pc(), gh);
    const r = await a.sync();
    expect(r.pushed).toBe(4);
    expect([...gh.files().keys()].sort()).toEqual(['README.md', 'originals/snapshot.json.gz', 'project.json', 'translations/Items.json.tr.json', 'translations/Map001.json.tr.json']);
    expect(JSON.parse(gh.text('translations/Map001.json.tr.json')!).a.target).toBe('Привіт');
    expect(gh.commitCount()).toBe(2);
    expect(gh.text('project.json')).not.toContain('snapshot');
  });

  it('a second device receives translations and originals; a repeat sync changes nothing', async () => {
    const gh = new MockGithub();
    await new Device(pc(), gh).sync();
    const phone = new Device(emptyProject('Гра'), gh);
    const r = await phone.sync();
    expect(r.gotSnapshot).toBe(true);
    expect(phone.project.files['Map001.json']!.a!.target).toBe('Привіт');
    expect(phone.project.snapshot!['Map001.json']).toHaveLength(2);
    expect(phone.project.assetsRev).toBe(100);
    const before = gh.commitCount();
    const again = await phone.sync();
    expect(again.pushed).toBe(0);
    expect(again.pulled).toBe(0);
    expect(gh.commitCount()).toBe(before);
  });

  it('an edit travels as one changed file, and only that file is downloaded', async () => {
    const gh = new MockGithub();
    const a = new Device(pc(), gh), b = new Device(emptyProject('Гра'), gh);
    await a.sync(); await b.sync();
    b.project = withFile(b.project, 'Map001.json', { a: entry('Вітаю', 50) });
    const r = await b.sync();
    expect(r.pushed).toBe(1);
    gh.requests.length = 0;
    const got = await a.sync();
    expect(got.pulled).toBe(1);
    expect(a.project.files['Map001.json']!.a!.target).toBe('Вітаю');
    expect(gh.requests.filter(q => q.includes('/git/blobs/'))).toHaveLength(1);
  });

  it('edits to different rows on both devices are both kept', async () => {
    const gh = new MockGithub();
    const a = new Device(pc(), gh), b = new Device(emptyProject('Гра'), gh);
    await a.sync(); await b.sync();
    a.project = withFile(a.project, 'Map001.json', { a: entry('Алло', 60) });
    b.project = withFile(b.project, 'Map001.json', { b: entry('Пока', 61) });
    await a.sync(40); const r = await b.sync(40); await a.sync(40);
    expect(r.conflicts).toBe(0);
    for (const d of [a, b]) expect([d.project.files['Map001.json']!.a!.target, d.project.files['Map001.json']!.b!.target]).toEqual(['Алло', 'Пока']);
  });

  it('merges and retries when another device pushes between reading and writing', async () => {
    const gh = new MockGithub();
    const a = new Device(pc(), gh);
    await a.sync();
    const other = JSON.parse(gh.text('translations/Map001.json.tr.json')!) as Record<string, Entry>;
    other.b = entry('Чао', 90);
    let once = true;
    gh.beforeRefUpdate = () => { if (once) { once = false; gh.commitFiles('main', { 'translations/Map001.json.tr.json': JSON.stringify(other) }); } };
    a.project = withFile(a.project, 'Items.json', { '[1].name': entry('Факел', 95) });
    const r = await a.sync();
    expect(r.pushed).toBeGreaterThan(0);
    expect(a.project.files['Map001.json']!.b!.target).toBe('Чао');
    expect(JSON.parse(gh.text('translations/Items.json.tr.json')!)['[1].name'].target).toBe('Факел');
  });

  it('does not loop when GitHub refuses the ref update although nobody else pushed: it says why', async () => {
    const gh = new MockGithub();
    const a = new Device(pc(), gh);
    gh.rejectRefUpdates = true;
    await expect(a.sync()).rejects.toThrow(/оновлення гілки відхилено: Required status check is expected/);
    expect(gh.requests.filter(r => r.startsWith('PATCH')).length).toBe(1);
  });

  it('keeps the same bytes for the same data so devices do not ping-pong commits', async () => {
    const gh = new MockGithub();
    const a = new Device(pc(), gh), b = new Device(emptyProject('Гра'), gh);
    await a.sync(); await b.sync();
    const n = gh.commitCount();
    await a.sync(); await b.sync(); await a.sync();
    expect(gh.commitCount()).toBe(n);
  });

  it('leaves the originals out of a public repository and says so', async () => {
    const gh = new MockGithub('me/tr', false);
    const r = await new Device(pc(), gh).sync();
    expect(r.skippedOriginals).toBe(true);
    expect([...gh.files().keys()].some(p => p.startsWith('originals/'))).toBe(false);
    expect(gh.text('translations/Map001.json.tr.json')).toContain('Привіт');
  });

  it('does not claim originals it never received', async () => {
    const gh = new MockGithub('me/tr', false);
    await new Device(pc(), gh).sync();
    const phone = new Device(emptyProject('Гра'), gh);
    const r = await phone.sync();
    expect(r.gotSnapshot).toBe(false);
    expect(phone.project.snapshot).toBeUndefined();
    expect(phone.project.assetsRev ?? 0).toBe(0);
  });

  it('can write into a folder and onto a branch created from the default one', async () => {
    const gh = new MockGithub();
    const a = new Device(pc(), gh, cfg({ dir: '/work/', branch: 'translations' }));
    await a.sync();
    expect(gh.files('translations').has('work/translations/Map001.json.tr.json')).toBe(true);
    expect(gh.files('translations').has('README.md')).toBe(true);
    expect(gh.files('main').has('work/project.json')).toBe(false);
  });

  it('puts originals in later when the repository first lacked them', async () => {
    const gh = new MockGithub();
    const a = new Device({ ...pc(), snapshot: undefined } as SavedProject, gh);
    await a.sync();
    expect(gh.files().has('originals/snapshot.json.gz')).toBe(false);
    a.project = { ...pc(), assetsRev: 200 };
    await a.sync();
    expect(gh.files().has('originals/snapshot.json.gz')).toBe(true);
    const phone = new Device(emptyProject('Гра'), gh);
    await phone.sync();
    expect(phone.project.assetsRev).toBe(200);
  });

  it('explains failures in plain words', async () => {
    const gh = new MockGithub();
    const bad: Device = new Device(pc(), Object.assign(Object.create(gh) as MockGithub, { request: (m: string, p: string, b: unknown) => gh.request(m, p, b, 'wrong') }));
    await expect(bad.sync()).rejects.toThrow(/токен недійсний/);
    await expect(new Device(pc(), gh, cfg({ repo: 'me/other' })).sync()).rejects.toThrow(/репозиторій не знайдено/);
    await expect(new Device(pc(), gh, cfg({ repo: 'oops' })).sync()).rejects.toThrow(/власник\/назва/);
    await expect(new Device(pc(), new MockGithub('me/tr', true, 'tok', 'main', false)).sync()).rejects.toThrow(/порожній/);
  });

  it('computes git blob ids the way git does', async () => {
    expect(await gitBlobSha(new TextEncoder().encode('hello\n'))).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
  });
});
