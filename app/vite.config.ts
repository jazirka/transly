import { defineConfig } from 'vite';

// The commit this build was made from (set by the CI workflows): the app compares it with the latest release to say
// "a new version is available". Local builds are marked "dev" and never offer an update.
export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(process.env.GITHUB_SHA ?? 'dev') },
});
