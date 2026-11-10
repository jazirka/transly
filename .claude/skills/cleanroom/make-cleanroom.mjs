#!/usr/bin/env node
// Builds a notes-free copy of a repository for a blind audit.
//   node make-cleanroom.mjs <repo-root> <out-dir> [--keep-tests]   (tests stay only for the lens that audits the tests themselves)
// Keeps `app/` and `.github/` from the committed tree (no history), removes every Markdown file, mock-ups and tests, and
// blanks out all comments while keeping every line and column where it was (so line numbers in findings stay true).
// Then it proves the result: no comment tokens remain, and a random sample of the original comments cannot be found.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const keepTests = process.argv.includes('--keep-tests');
const [repo, out] = process.argv.slice(2).filter(a => !a.startsWith('--')).map(p => p && path.resolve(p));
if (!repo || !out) { console.error('usage: make-cleanroom.mjs <repo-root> <out-dir>'); process.exit(2); }
const require = createRequire(path.join(repo, 'app', 'node_modules') + path.sep);
const ts = require('typescript');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
execFileSync('sh', ['-c', `git -C ${JSON.stringify(repo)} archive HEAD app .github | tar -x -C ${JSON.stringify(out)}`], { stdio: 'inherit' });

const blank = s => s.replace(/[^\n\r]/g, ' ');
const stats = { removedFiles: [], stripped: {}, comments: 0 };
const originals = []; // comment texts before stripping, for the proof

/* ---------- per-language strippers: each returns { text, found: string[] } ---------- */
function stripTs(text, file) {
  const kind = /\.(m?js|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const ranges = new Map();
  const add = rs => { if (rs) for (const r of rs) ranges.set(r.pos, r.end); };
  const visit = node => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const kids = node.getChildren(sf);
    if (!kids.length) { add(ts.getLeadingCommentRanges(text, node.pos)); add(ts.getTrailingCommentRanges(text, node.end)); }
    else for (const k of kids) visit(k);
  };
  visit(sf);
  let res = text; const found = [];
  for (const [pos, end] of [...ranges].sort((a, b) => b[0] - a[0])) { found.push(text.slice(pos, end)); res = res.slice(0, pos) + blank(text.slice(pos, end)) + res.slice(end); }
  return { text: res, found };
}
function commentCountTs(text, file) {
  const kind = /\.(m?js|cjs)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  let n = 0;
  const visit = node => {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) return;
    const kids = node.getChildren(sf);
    if (!kids.length) { n += (ts.getLeadingCommentRanges(text, node.pos) ?? []).length + (ts.getTrailingCommentRanges(text, node.end) ?? []).length; }
    else for (const k of kids) visit(k);
  };
  visit(sf);
  return n;
}
function stripRegexComments(text, re) {
  const found = [];
  return { text: text.replace(re, m => { found.push(m); return blank(m); }), found };
}
/** Rust, Java, Kotlin, Groovy: strings, chars and raw strings are skipped so `"//"` is not a comment. */
function stripCLike(text, { rust = false, singleStrings = false } = {}) {
  let o = '', i = 0; const n = text.length, found = [];
  while (i < n) {
    const c = text[i], d = text[i + 1];
    if (c === '/' && d === '/') { let j = text.indexOf('\n', i); if (j < 0) j = n; found.push(text.slice(i, j)); o += blank(text.slice(i, j)); i = j; continue; }
    if (c === '/' && d === '*') {
      let depth = 1, j = i + 2;
      while (j < n && depth > 0) {
        if (rust && text[j] === '/' && text[j + 1] === '*') { depth++; j += 2; } else if (text[j] === '*' && text[j + 1] === '/') { depth--; j += 2; } else j++;
      }
      found.push(text.slice(i, j)); o += blank(text.slice(i, j)); i = j; continue;
    }
    if (rust && c === 'r' && (i === 0 || !/[A-Za-z0-9_]/.test(text[i - 1]))) {
      const m = /^r(#*)"/.exec(text.slice(i, i + 12));
      if (m) { const close = '"' + m[1]; const j = text.indexOf(close, i + m[0].length); const e = j < 0 ? n : j + close.length; o += text.slice(i, e); i = e; continue; }
    }
    if (c === '"') {
      if (text.startsWith('"""', i)) { const j = text.indexOf('"""', i + 3); const e = j < 0 ? n : j + 3; o += text.slice(i, e); i = e; continue; }
      let j = i + 1; while (j < n && text[j] !== '"') { if (text[j] === '\\') j++; j++; }
      o += text.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === "'") {
      const m = /^'(\\.[^']*|[^\\'\n])'/.exec(text.slice(i, i + 12));
      if (m) { o += m[0]; i += m[0].length; continue; }
      if (singleStrings) { let j = i + 1; while (j < n && text[j] !== "'" && text[j] !== '\n') { if (text[j] === '\\') j++; j++; } o += text.slice(i, j + 1); i = j + 1; continue; }
    }
    o += c; i++;
  }
  return { text: o, found };
}
/** `#` comments of YAML, TOML, properties, ignore files: a `#` that starts a line or follows whitespace, outside quotes. */
function stripHash(text) {
  const found = [];
  const res = text.split('\n').map(line => {
    let q = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === q && line[i - 1] !== '\\') q = ''; continue; }
      if (c === '"' || c === "'") { q = c; continue; }
      if (c === '#' && (i === 0 || /\s/.test(line[i - 1]))) { found.push(line.slice(i)); return line.slice(0, i) + ' '.repeat(line.length - i); }
    }
    return line;
  }).join('\n');
  return { text: res, found };
}
function stripJsonDescriptions(text) {
  try {
    const o = JSON.parse(text); const found = [];
    const walk = v => { if (v && typeof v === 'object') for (const k of Object.keys(v)) { if (k === 'description' && typeof v[k] === 'string') { found.push(v[k]); delete v[k]; } else walk(v[k]); } };
    walk(o);
    return { text: JSON.stringify(o, null, 2) + '\n', found };
  } catch { return { text, found: [] }; }
}

/* ---------- walk ---------- */
const skipDirs = new Set(['node_modules', 'target', 'dist', 'dist-mobile', 'dist-single', 'build', '.gradle']);
const list = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!skipDirs.has(e.name)) walk(p); } else list.push(p);
  }
})(out);

const rm = p => { fs.rmSync(p, { force: true }); stats.removedFiles.push(path.relative(out, p)); };
for (const p of list) {
  const rel = path.relative(out, p);
  const isTest = /(^|\/)(test|tests|__tests__)\//.test(rel) || /\.(test|spec)\.[mc]?[jt]sx?$/.test(p);
  if (/\.md$/i.test(p) || /(^|\/)mockup\//.test(rel) || (isTest && !keepTests) || /(^|\/)(README|CHANGELOG|NOTES)/i.test(rel)) { rm(p); continue; }
  const ext = path.extname(p).toLowerCase(), base = path.basename(p);
  let r = null;
  if (/\.(tsx?|mts|cts|m?js|cjs)$/.test(p)) r = stripTs(fs.readFileSync(p, 'utf8'), p);
  else if (ext === '.css') r = stripRegexComments(fs.readFileSync(p, 'utf8'), /\/\*[\s\S]*?\*\//g);
  else if (ext === '.rs') r = stripCLike(fs.readFileSync(p, 'utf8'), { rust: true });
  else if (ext === '.java' || ext === '.kt') r = stripCLike(fs.readFileSync(p, 'utf8'));
  else if (ext === '.gradle' || ext === '.kts') r = stripCLike(fs.readFileSync(p, 'utf8'), { singleStrings: true });
  else if (ext === '.xml' || ext === '.html' || ext === '.svg') r = stripRegexComments(fs.readFileSync(p, 'utf8'), /<!--[\s\S]*?-->/g);
  else if (/\.(ya?ml|toml|properties)$/.test(p) || base === '.gitignore') r = stripHash(fs.readFileSync(p, 'utf8'));
  else if (ext === '.json' && /(capabilities|package\.json|tauri\.conf)/.test(rel)) r = stripJsonDescriptions(fs.readFileSync(p, 'utf8'));
  if (!r) continue;
  if (r.text !== fs.readFileSync(p, 'utf8')) fs.writeFileSync(p, r.text);
  stats.stripped[ext || base] = (stats.stripped[ext || base] ?? 0) + r.found.length;
  stats.comments += r.found.length;
  for (const f of r.found) originals.push(f);
}

for (const d of [...new Set(stats.removedFiles.map(f => path.dirname(path.join(out, f))))].sort((a, b) => b.length - a.length)) { try { fs.rmdirSync(d); } catch { /* not empty */ } }

/* ---------- proof ---------- */
const textFiles = list.filter(p => fs.existsSync(p)).filter(p => /\.(tsx?|mts|m?js|cjs|css|rs|java|kt|gradle|kts|xml|html|svg|ya?ml|toml|json|properties)$/.test(p) || path.basename(p) === '.gitignore');
const corpus = textFiles.map(p => fs.readFileSync(p, 'utf8'));
let tsLeft = 0;
for (const p of textFiles.filter(p => /\.(tsx?|mts|m?js|cjs)$/.test(p))) tsLeft += commentCountTs(fs.readFileSync(p, 'utf8'), p);
const needles = originals
  .map(c => c.replace(/^\s*(\/\/+!?|\/\*+!?|#|<!--)\s?/, '').replace(/(\*\/|-->)\s*$/, '').split('\n').map(l => l.replace(/^\s*\*+\s?/, '').trim()).filter(l => l.length >= 35)[0])
  .filter(Boolean);
for (let i = needles.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [needles[i], needles[j]] = [needles[j], needles[i]]; }
const sample = needles.slice(0, 600).map(s => s.slice(0, 40));
const survivors = sample.filter(s => corpus.some(t => t.includes(s)));
const report = { out, removedFiles: stats.removedFiles.length, markdownLeft: textFiles.filter(p => /\.md$/i.test(p)).length, commentsRemoved: stats.comments, byType: stats.stripped, tsCommentTokensLeft: tsLeft, sampledNeedles: sample.length, needlesStillPresent: survivors.length, survivors: survivors.slice(0, 15) };
fs.writeFileSync(path.join(out, '..', 'cleanroom-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (tsLeft > 0 || report.markdownLeft > 0) { console.error('CLEANROOM NOT CLEAN'); process.exit(1); }
