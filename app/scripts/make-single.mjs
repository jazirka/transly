// Builds dist/index.html + assets into one self-contained HTML fragment (for hosts that serve a single page).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const css = [...html.matchAll(/<link[^>]+href="([^"]+\.css)"[^>]*>/g)].map(m => readFileSync(join(dist, m[1]), 'utf8')).join('\n');
const js = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"[^>]*><\/script>/g)].map(m => readFileSync(join(dist, m[1]), 'utf8')).join('\n');
if (!css || !js) throw new Error('dist has no css/js: run `npm run build` first');
const out = `<title>Transly</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;600&display=swap">
<style>:root{color-scheme:dark}html,body{height:100%;margin:0}${css}</style>
<div id="app"></div>
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>
`;
mkdirSync(new URL('../dist-single/', import.meta.url).pathname, { recursive: true });
writeFileSync(new URL('../dist-single/transly.html', import.meta.url).pathname, out);
console.log('dist-single/transly.html', (out.length / 1024).toFixed(0) + ' KB');
