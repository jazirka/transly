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
  transformIndexHtml: { order: 'pre', handler: html => (mobile ? html.replace('/src/main.ts', '/src/main-mobile.ts').replace('<title>Transly</title>', '<title>Transly</title>\n<meta name="theme-color" content="#1a1b1e">') : html) },
});

export default defineConfig(({ mode }) => ({
  define: { __BUILD_ID__: JSON.stringify(process.env.GITHUB_SHA ?? 'dev') },
  plugins: [entry(mode === 'mobile')],
  build: { outDir: mode === 'mobile' ? 'dist-mobile' : 'dist' },
}));
