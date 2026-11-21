#!/usr/bin/env node
// Prepares a Transly plugin for publishing: writes the SHA-256 checksums of its files into `transly-plugin.json` (the application refuses a package whose
// files do not match its manifest), checks the manifest for the mistakes the application would refuse, and can make a `.transly-plugin` (zip) archive.
//
//   node scripts/plugin-pack.mjs <plugin folder>                 update the checksums in place and check the manifest
//   node scripts/plugin-pack.mjs <plugin folder> --zip out.zip   … and write an archive
//   node scripts/plugin-pack.mjs <plugin folder> --check         only check (exit code 1 when something is wrong, nothing is written)
//
// The checks here are the basic ones (the application makes all of them again when a plugin is installed).
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { deflateRawSync } from 'node:zlib';

const args = process.argv.slice(2);
const dir = args.find(a => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--zip');
const check = args.includes('--check');
const zipAt = args.includes('--zip') ? args[args.indexOf('--zip') + 1] : null;
if (!dir) { console.error('usage: node scripts/plugin-pack.mjs <plugin folder> [--zip out.zip] [--check]'); process.exit(2); }

const root = resolve(dir), MANIFEST = 'transly-plugin.json';
const files = [];
(function walk(d) {
  for (const name of readdirSync(d).sort()) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p); else files.push(relative(root, p).split(sep).join('/'));
  }
})(root);

let manifest;
try { manifest = JSON.parse(readFileSync(join(root, MANIFEST), 'utf8')); } catch (e) { console.error(`cannot read ${MANIFEST}: ${e.message}`); process.exit(1); }

const problems = [];
if (manifest.manifestVersion !== 1) problems.push('manifestVersion must be 1');
if (typeof manifest.id !== 'string' || !/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/.test(manifest.id)) problems.push('id must look like author.name (lower case letters, digits and "-", at least two parts)');
if (typeof manifest.name !== 'string' || !manifest.name.trim()) problems.push('name is missing');
if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(manifest.version)) problems.push('version must look like 1.2.3');
const sums = {};
for (const f of files.filter(f => f !== MANIFEST)) {
  const bytes = readFileSync(join(root, f));
  if (bytes.includes(0)) problems.push(`${f} is not a text file (the application accepts only UTF-8 text)`);
  if (bytes.length > 2_000_000) problems.push(`${f} is larger than 2 MB`);
  if (!/^[\p{L}\p{N}_ .()+/-]+$/u.test(f) || f.split('/').some(s => s === '..')) problems.push(`${f} has a name the application will not accept`);
  sums[f] = 'sha256-' + createHash('sha256').update(bytes).digest('hex');
}
if (manifest.main && !(manifest.main in sums)) problems.push(`main "${manifest.main}" is not in the folder`);
for (const l of manifest.contributes?.languages ?? []) for (const c of l.catalogs ?? []) if (!(c.file in sums)) problems.push(`catalog "${c.file}" is not in the folder`);
for (const h of manifest.contributes?.help ?? []) if (h.file && !(h.file in sums)) problems.push(`help file "${h.file}" is not in the folder`);

if (problems.length) { for (const p of problems) console.error(`✗ ${p}`); process.exit(1); }
const same = JSON.stringify(manifest.files ?? {}) === JSON.stringify(sums);
if (check) { if (!same) { console.error('✗ the checksums in the manifest are out of date: run without --check'); process.exit(1); } console.log(`✓ ${manifest.id} ${manifest.version}: ${Object.keys(sums).length} file(s), checksums match`); process.exit(0); }
if (!same) { manifest.files = sums; writeFileSync(join(root, MANIFEST), JSON.stringify(manifest, null, 2) + '\n'); console.log(`✓ checksums written for ${Object.keys(sums).length} file(s)`); }
else console.log('✓ checksums are up to date');

if (zipAt) {
  const crcTable = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const u16 = n => Buffer.from([n & 255, (n >> 8) & 255]), u32 = n => Buffer.from([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
  const parts = [], central = [];
  let off = 0;
  for (const f of [MANIFEST, ...Object.keys(sums)]) {
    const data = readFileSync(join(root, f)), c = deflateRawSync(data), name = Buffer.from(f), k = crc(data);
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(0), u16(0x21), u32(k), u32(c.length), u32(data.length), u16(name.length), u16(0), name, c]);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(0), u16(0x21), u32(k), u32(c.length), u32(data.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(off), name]));
    parts.push(local); off += local.length;
  }
  const cd = Buffer.concat(central), n = parts.length;
  writeFileSync(zipAt, Buffer.concat([...parts, cd, u32(0x06054b50), u16(0), u16(0), u16(n), u16(n), u32(cd.length), u32(off), u16(0)]));
  console.log(`✓ ${zipAt}`);
}
