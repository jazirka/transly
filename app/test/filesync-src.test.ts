import { describe, expect, it } from 'vitest';
import { emptyProject, projectFiles, syncFiles } from '../src/core';
import type { Entry, RemoteFiles, SavedProject } from '../src/core';

const dec = new TextDecoder();
const entry = (target: string, src?: string): Entry => ({ target, status: 'draft', mt: 5, ...(src ? { src } : {}) });
const project = (): SavedProject => ({ ...emptyProject('P'), files: { 'Map001.json': { k0: entry('Привіт', 'Hello there'), k1: entry('Бувай', 'Goodbye') } } });

describe('the original text in a repository that must not hold it', () => {
  it('translation files of a public repository carry no `src`, those of a private one do', async () => {
    const without = await projectFiles(project(), 'p', false);
    const text = dec.decode(without.get('p/translations/Map001.json.tr.json')!);
    expect(text).toContain('Привіт');
    expect(text).not.toContain('Hello there');
    expect(text).not.toContain('"src"');
    const withSrc = dec.decode((await projectFiles(project(), 'p', true)).get('p/translations/Map001.json.tr.json')!);
    expect(withSrc).toContain('Hello there');
  });

  it('a pull from such a repository keeps the originals this device already knows', async () => {
    // the remote holds one translation changed later, without `src`
    const remote = new Map<string, Uint8Array>();
    const theirs = project(); theirs.files['Map001.json']!.k0 = { target: 'Вітаю', status: 'draft', mt: 50 };
    for (const [p, b] of await projectFiles(theirs, 'p', false)) remote.set(p, b);
    const sha = async (b: Uint8Array) => (await import('../src/core')).gitBlobSha(b);
    const shas = new Map<string, string>(); for (const [p, b] of remote) shas.set(p, await sha(b));
    const api: RemoteFiles = {
      head: async () => ({ id: 'c1', isPrivate: false, files: shas }),
      read: async (path: string) => remote.get(path)!,
      push: async () => ({ ok: true, id: 'c2' }),
    } as unknown as RemoteFiles;
    const r = await syncFiles(api, { dir: 'p', originals: true } as never, { shas: {}, commit: '', assetsRev: 0 }, project());
    const e = r.project.files['Map001.json']!.k0!;
    expect(e.target).toBe('Вітаю');
    expect(e.src).toBe('Hello there');
  });
});
