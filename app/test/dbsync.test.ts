import { describe, expect, it } from 'vitest';
import { EMPTY_CLAUDE_STATE, claudeSync, emptyProject } from '../src/core';
import type { ClaudeState, Entry, SavedProject, Unit } from '../src/core';
import { MockDb } from './mock-db';

const entry = (target: string, mt: number): Entry => ({ target, status: 'draft', mt });
const unit = (key: string, source: string): Unit => ({ key, source, speaker: '', kind: 'dialogue', context: 'c' });
const withFile = (p: SavedProject, file: string, e: Record<string, Entry>): SavedProject => ({ ...p, files: { ...p.files, [file]: { ...(p.files[file] ?? {}), ...e } } });
const pc = (): SavedProject => ({ ...withFile(withFile(emptyProject('Гра'), 'Map001.json', { a: entry('Привіт', 10), b: entry('Бувай', 11) }), 'Items.json', { '[1].name': entry('Смолоскип', 12) }), snapshot: { 'Map001.json': [unit('a', 'Hello'), unit('b', 'Bye')] }, assetsRev: 100 });
const fast = { retryDelayMs: 1, lockWaitMs: 50 };

class Device {
  state: ClaudeState = EMPTY_CLAUDE_STATE;
  constructor(public project: SavedProject, readonly db: MockDb, readonly id = 'dev-' + Math.random().toString(36).slice(2)) {}
  async sync(since = 0) {
    this.db.skew += 5000; // time passes between a person's syncs, so the previous device's short lease has lapsed
    const r = await claudeSync(this.db, this.id, this.state, this.project, { since, ...fast });
    this.project = r.project; this.state = r.state;
    return r;
  }
}
const blobDocs = (db: MockDb) => [...db.docs.keys()].filter(k => k.startsWith('blobs/'));

describe('sync through the artifact database', () => {
  it('stores the project as an index plus content-addressed chunks, each within the document limit', async () => {
    const db = new MockDb();
    const r = await new Device(pc(), db).sync();
    expect(r.pushed).toBe(4);
    const idx = db.docs.get('sync/index') as { rev: number; files: Record<string, { sha: string; n: number }> };
    expect(idx.rev).toBe(1);
    expect(Object.keys(idx.files).sort()).toEqual(['originals/snapshot.json.gz', 'project.json', 'translations/Items.json.tr.json', 'translations/Map001.json.tr.json']);
    for (const d of db.docs.values()) expect(JSON.stringify(d).length).toBeLessThan(256 * 1024);
    expect(blobDocs(db)).toHaveLength(4);
  });

  it('a second device receives translations and originals; a repeat sync writes nothing', async () => {
    const db = new MockDb();
    await new Device(pc(), db).sync();
    const phone = new Device(emptyProject('Гра'), db);
    const r = await phone.sync();
    expect(r.gotSnapshot).toBe(true);
    expect(phone.project.files['Map001.json']!.a!.target).toBe('Привіт');
    expect(phone.project.snapshot!['Map001.json']).toHaveLength(2);
    const writes = db.writes;
    const again = await phone.sync();
    expect([again.pushed, again.pulled, db.writes]).toEqual([0, 0, writes]);
  });

  it('an edit writes only the changed file; the old chunks are removed', async () => {
    const db = new MockDb();
    const a = new Device(pc(), db), b = new Device(emptyProject('Гра'), db);
    await a.sync(); await b.sync();
    const before = new Set(blobDocs(db));
    b.project = withFile(b.project, 'Map001.json', { a: entry('Вітаю', 50) });
    expect((await b.sync()).pushed).toBe(1);
    const after = new Set(blobDocs(db));
    expect([...after].filter(k => !before.has(k))).toHaveLength(1);
    expect([...before].filter(k => !after.has(k))).toHaveLength(1);
    expect((await a.sync()).pulled).toBe(1);
    expect(a.project.files['Map001.json']!.a!.target).toBe('Вітаю');
  });

  it('splits a large file into several documents and reads it back unchanged', async () => {
    const db = new MockDb();
    const big: Record<string, Entry> = {};
    for (let i = 0; i < 6000; i++) big[`k${i}`] = entry(Array.from({ length: 4 }, () => crypto.randomUUID()).join(''), 10 + i);
    const a = new Device(withFile(pc(), 'CommonEvents.json', big), db);
    await a.sync();
    const idx = db.docs.get('sync/index') as { files: Record<string, { n: number }> };
    expect(idx.files['translations/CommonEvents.json.tr.json']!.n).toBeGreaterThan(1);
    const b = new Device(emptyProject('Гра'), db);
    await b.sync();
    expect(b.project.files['CommonEvents.json']).toEqual(big);
  });

  it('retries and merges when another device writes while chunks are being uploaded', async () => {
    const db = new MockDb();
    const a = new Device(pc(), db), other = new Device(emptyProject('Гра'), db);
    await a.sync(); await other.sync();
    a.project = withFile(a.project, 'Items.json', { '[1].name': entry('Факел', 95) });
    other.project = withFile(other.project, 'Map001.json', { b: entry('Чао', 90) });
    let once = true;
    db.beforeSet = async path => {
      if (!once || !path.startsWith('blobs/')) return;
      once = false;
      await other.sync(); // the other device completes a whole sync in the middle of ours
      db.skew += 5000;
    };
    const r = await a.sync();
    expect(r.pulled).toBeGreaterThan(0);
    expect(a.project.files['Map001.json']!.b!.target).toBe('Чао');
    expect(a.project.files['Items.json']!['[1].name']!.target).toBe('Факел');
    const again = await other.sync();
    expect(again.project.files['Items.json']!['[1].name']!.target).toBe('Факел');
  });

  it('explains a busy lease, a full database and a refused write in plain words', async () => {
    const db = new MockDb();
    const a = new Device(pc(), db);
    await a.sync();
    a.project = withFile(a.project, 'Map001.json', { a: entry('Х', 99) });
    db.leases.set('sync/lock', { holder: 'someone-else', until: db.now + 600_000 });
    await expect(a.sync()).rejects.toThrow(/інший пристрій зараз синхронізує/);
    db.leases.clear();
    const full = new MockDb(); full.maxDocs = 2;
    await expect(new Device(pc(), full).sync()).rejects.toThrow(/заповнена/);
  });

  it('survives a few "busy" answers from the platform', async () => {
    const db = new MockDb();
    let n = 0;
    db.beforeSet = () => { if (n++ < 2) throw Object.assign(new Error('x'), { code: 'resource_exhausted' }); };
    const r = await new Device(pc(), db).sync();
    expect(r.pushed).toBe(4);
  });
});
