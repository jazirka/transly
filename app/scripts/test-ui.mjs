#!/usr/bin/env node
// Runs the browser checks in test-ui/ against the built apps (`npm run test:ui`).
// Needs Chromium and Playwright (not part of the dependencies: `npm i --no-save playwright` and `npx playwright install chromium`,
// or any machine where `require('playwright')` already works). The apps are built here and served by `vite preview`.
//   node scripts/test-ui.mjs             every test-ui/*.cjs
//   node scripts/test-ui.mjs s2 s9       only the scripts whose name contains one of the words
//   SKIP_BUILD=1 …                        use the existing dist/ and dist-mobile/
import { spawn, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PC_PORT = process.env.PC_PORT || '4285', PHONE_PORT = process.env.PHONE_PORT || '4284';
const only = process.argv.slice(2);
const sh = (args, opts = {}) => spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, { cwd: root, stdio: 'inherit', ...opts });

if (!process.env.SKIP_BUILD) {
  if (sh(['vite', 'build']).status !== 0 || sh(['vite', 'build', '--mode', 'mobile']).status !== 0) { console.error('build failed'); process.exit(1); }
}

const servers = [
  spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--port', PC_PORT, '--strictPort'], { cwd: root, stdio: 'ignore' }),
  spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', 'preview', '--mode', 'mobile', '--outDir', 'dist-mobile', '--port', PHONE_PORT, '--strictPort'], { cwd: root, stdio: 'ignore' }),
];
const stop = () => { for (const s of servers) s.kill(); };
process.on('exit', stop);
process.on('SIGINT', () => { stop(); process.exit(130); });

const up = async (port) => {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`http://localhost:${port}/`)).ok) return true; } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
};
if (!(await up(PC_PORT)) || !(await up(PHONE_PORT))) { console.error('the preview servers did not start'); process.exit(1); }

const env = { ...process.env, PC_URL: `http://localhost:${PC_PORT}/`, PHONE_URL: `http://localhost:${PHONE_PORT}/` };
const files = readdirSync(join(root, 'test-ui')).filter(f => f.endsWith('.cjs') && (!only.length || only.some(w => f.includes(w)))).sort();
const failed = [];
for (const f of files) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [join('test-ui', f)], { cwd: root, stdio: 'inherit', env, timeout: 300_000 });
  if (r.status !== 0) failed.push(f);
}
console.log(`\n${files.length - failed.length} of ${files.length} scripts passed${failed.length ? `; failed: ${failed.join(', ')}` : ''}`);
process.exit(failed.length ? 1 : 0);
