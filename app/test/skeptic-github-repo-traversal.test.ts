import { describe, expect, it } from 'vitest';
import { githubRemote } from '../src/core';
import type { GithubApi } from '../src/core';

// Oracle: path traversal ('.' and '..' segments) must never reach the request path built from a user-typed repository name
// (OWASP ASVS V5 input validation: a value used to build a URL path is checked against what it may be).
describe('githubRemote: repository name with dot segments', () => {
  for (const bad of ['a/..', '../x', './x', 'a/.']) {
    it(`refuses ${JSON.stringify(bad)}`, async () => {
      const paths: string[] = [];
      const api: GithubApi = { request: async (_m, path) => { paths.push(path); return { status: 404, json: {} }; } };
      let remote;
      try { remote = githubRemote(api, { repo: bad, branch: '', dir: '', originals: true }); } catch (e) { expect(String(e)).toMatch(/власник\/назва/); return; }
      await remote.head().catch(() => undefined);
      throw new Error('accepted: the request went to ' + JSON.stringify(paths));
    });
  }
});
