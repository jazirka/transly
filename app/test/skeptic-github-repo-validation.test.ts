import { describe, expect, it } from 'vitest';
import { githubRemote } from '../src/core';
import type { GithubApi } from '../src/core';

// Oracle: path traversal ("..") must never reach the request path built from a user-typed repository name
// (OWASP ASVS V12/V5: validate input used to build a URL path).
const api = (): { api: GithubApi; paths: string[] } => {
  const paths: string[] = [];
  return { paths, api: { request: async (_m, path) => { paths.push(path); return { status: 404, json: {} }; } } };
};
const cfg = (repo: string) => ({ repo, branch: '', dir: '', originals: true });

describe('githubRemote: repository name', () => {
  it('accepts «власник/назва»', () => {
    expect(() => githubRemote(api().api, cfg('ivan/my-translation'))).not.toThrow();
    expect(() => githubRemote(api().api, cfg('  Iv-an.x/My_repo.v2  '))).not.toThrow();
  });
  for (const bad of ['oops', 'a/b/c', 'a b/c', 'a/b?x=1', 'a/b#h', 'https://github.com/a/b', '/a/b', 'a/b/', '']) {
    it(`refuses ${JSON.stringify(bad)}`, async () => {
      const t = api();
      let remote;
      try { remote = githubRemote(t.api, cfg(bad)); } catch (e) { expect(String(e)).toMatch(/власник\/назва/); return; }
      await remote.head().catch(() => undefined);
      expect(t.paths.filter(p => p.includes('..') || p.includes('/./') ), 'a traversal path reached the request').toEqual([]);
      throw new Error('accepted: requests went to ' + JSON.stringify(t.paths));
    });
  }
});
