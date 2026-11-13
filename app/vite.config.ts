import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';
import type { Plugin } from 'vite';

// The commit this build was made from (set by the CI workflows): the app compares it with the latest release to say
// "a new version is available". Local builds are marked "dev" and never offer an update.
//
// Two separate apps share only `src/core`: the desktop one (src/main.ts → src/ui, also the default and what Tauri
// packages) and the phone one (src/main-mobile.ts → src/mobile, what the Android app packages).
//   default (desktop)         → dist
//   `--mode mobile`           → dist-mobile

const entry = (mobile: boolean): Plugin => ({
  name: 'transly-entry',
  transformIndexHtml: { order: 'pre', handler: html => (mobile ? html.replace('/src/main.ts', '/src/main-mobile.ts').replace('width=device-width,initial-scale=1', 'width=device-width,initial-scale=1,interactive-widget=resizes-content').replace('<title>Transly</title>', '<title>Transly</title>\n<meta name="theme-color" content="#1a1b1e">') : html) },
});

// A Content-Security-Policy for the built pages (the Android app and the browser build have none otherwise, so one injected
// tag would run with everything the page can reach). Scripts come only from the app itself plus the small inline script of the
// page, allowed by its hash (computed here, so editing that script cannot break the policy). Only for builds: the dev server
// needs inline scripts. The desktop app has its own policy in tauri.conf.json, which applies together with this one.
const csp = (): Plugin => ({
  name: 'transly-csp',
  apply: 'build',
  transformIndexHtml: {
    order: 'post',
    handler: html => {
      const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => `'sha256-${createHash('sha256').update(m[1] ?? '').digest('base64')}'`);
      const policy = [
        "default-src 'self'",
        `script-src 'self' ${hashes.join(' ')}`.trim(),
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self' ipc: http://ipc.localhost http: https: blob:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ].join('; ');
      return html.replace('</title>', `</title>\n<meta http-equiv="Content-Security-Policy" content="${policy}">`);
    },
  },
});

export default defineConfig(({ mode }) => ({
  define: { __BUILD_ID__: JSON.stringify(process.env.GITHUB_SHA ?? 'dev'), __BUILD_TIME__: JSON.stringify(process.env.GITHUB_SHA ? new Date().toISOString() : '') },
  plugins: [entry(mode === 'mobile'), csp()],
  build: { outDir: mode === 'mobile' ? 'dist-mobile' : 'dist' },
}));
