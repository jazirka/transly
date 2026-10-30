// Builds self-contained HTML pages from the Vite builds (for hosts that serve a single page, or to open from a file):
//   dist-single/transly-desktop.html  desktop app (dist/)
//   dist-single/transly-phone.html    phone app (dist-mobile/)
//   dist-single/transly.html          both, the loader picks by device (override: ?app=phone or ?app=desktop)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../', import.meta.url).pathname;
const out = join(root, 'dist-single');

function bundle(dirName) {
  const dir = join(root, dirName);
  if (!existsSync(join(dir, 'index.html'))) throw new Error(`${dirName}/ is missing: run the build first`);
  const html = readFileSync(join(dir, 'index.html'), 'utf8');
  const css = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"[^>]*>/g)].map(m => readFileSync(join(dir, m[1]), 'utf8')).join('\n');
  const js = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/g)].map(m => readFileSync(join(dir, m[1]), 'utf8')).join('\n');
  if (!css || !js) throw new Error(`${dirName}/ has no css/js`);
  return { css, js: js.replace(/<\/script/gi, '<\\/script'), cssSafe: css.replace(/<\/style/gi, '<\\/style') };
}

const head = `<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Transly</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap">`;
const single = b => `<!doctype html><html lang="uk"><head>${head}<style>:root{color-scheme:dark}html,body{height:100%;margin:0}${b.cssSafe}</style></head><body><div id="app"></div>
<script type="module">${b.js}</script></body></html>
`;

const desktop = bundle('dist'), phone = bundle('dist-mobile');
const both = `<!doctype html><html lang="uk"><head>${head}<style>:root{color-scheme:dark}html,body{height:100%;margin:0}</style></head><body><div id="app"></div>
<script type="text/plain" id="b-desktop-css">${desktop.cssSafe}</script><script type="text/plain" id="b-desktop-js">${desktop.js}</script>
<script type="text/plain" id="b-phone-css">${phone.cssSafe}</script><script type="text/plain" id="b-phone-js">${phone.js}</script>
<script>
// Both apps live in this file, only the right one starts: a phone gets the phone app, a computer the desktop app.
(function () {
  var q = new URLSearchParams(location.search).get('app');
  var app = q === 'phone' || q === 'desktop' ? q : (matchMedia('(pointer:coarse) and (max-width:900px)').matches ? 'phone' : 'desktop');
  var text = function (id) { return document.getElementById(id).textContent; };
  var st = document.createElement('style'); st.textContent = text('b-' + app + '-css'); document.head.appendChild(st);
  var sc = document.createElement('script'); sc.type = 'module'; sc.textContent = text('b-' + app + '-js'); document.body.appendChild(sc);
})();
</script></body></html>
`;

mkdirSync(out, { recursive: true });
for (const [name, html] of [['transly-desktop.html', single(desktop)], ['transly-phone.html', single(phone)], ['transly.html', both]]) {
  writeFileSync(join(out, name), html);
  console.log('dist-single/' + name, (html.length / 1024).toFixed(0) + ' KB');
}
