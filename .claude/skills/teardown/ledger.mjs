#!/usr/bin/env node
// Merges findings and adjudications into one ledger, without softening or dropping anything.
//   node ledger.mjs <run-dir>          writes <run-dir>/ledger.json and <run-dir>/LEDGER.md
import fs from 'node:fs';
import path from 'node:path';

const run = path.resolve(process.argv[2]);
const readDir = d => (fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith('.json')).map(f => ({ f, v: JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')) })) : []);
const findings = readDir(path.join(run, 'findings')).map(x => x.v);
const adj = new Map(readDir(path.join(run, 'adjudication')).map(x => [x.v.id, x.v]));
const rank = { 'data-loss': 0, security: 1, functional: 2, ux: 3, visual: 4, maintainability: 5 };
const required = ['id', 'lens', 'title', 'claim', 'severity', 'oracle', 'expected', 'actual', 'repro', 'confidence'];
const rows = findings.map(f => {
  const a = adj.get(f.id);
  const problems = required.filter(k => f[k] === undefined || f[k] === '' || f[k] === null);
  if (!f.repro?.command && !f.repro?.path) problems.push('repro.command/path');
  return { ...f, adjudication: a ?? null, admissible: problems.length === 0, problems };
});
const status = r => (!r.admissible ? 'inadmissible' : !r.adjudication ? 'unadjudicated' : r.adjudication.verdict);
rows.sort((a, b) => (rank[a.adjudication?.severity_adjusted ?? a.severity] ?? 9) - (rank[b.adjudication?.severity_adjusted ?? b.severity] ?? 9) || b.confidence - a.confidence);
fs.writeFileSync(path.join(run, 'ledger.json'), JSON.stringify(rows, null, 2));
const by = {}; for (const r of rows) by[status(r)] = (by[status(r)] ?? 0) + 1;
let md = `# Ledger\n\nfindings: ${rows.length}; by status: ${JSON.stringify(by)}\n\n| id | lens | severity | status | title |\n|---|---|---|---|---|\n`;
for (const r of rows) md += `| ${r.id} | ${r.lens} | ${r.adjudication?.severity_adjusted ?? r.severity} | ${status(r)} | ${String(r.title).replace(/\|/g, '/')} |\n`;
fs.writeFileSync(path.join(run, 'LEDGER.md'), md);
console.log(md);
