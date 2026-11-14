import { crc32 as nodeCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { createZip } from '../src/core';

// Oracle: the ZIP file format (PKWARE APPNOTE 6.3): every field little-endian; the central directory must repeat
// the CRC and sizes of the local header; offsets point at local headers. Parsed here without any external program.
function parse(zip: Uint8Array) {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const eocd = zip.length - 22;
  expect(v.getUint32(eocd, true)).toBe(0x06054b50);
  const count = v.getUint16(eocd + 10, true), cdSize = v.getUint32(eocd + 12, true), cdOff = v.getUint32(eocd + 16, true);
  expect(v.getUint16(eocd + 8, true)).toBe(count);
  expect(cdOff + cdSize).toBe(eocd);
  const out: { name: string; crc: number; size: number; data: Uint8Array; flags: number; method: number; date: number; lcrc: number; lsize: number; lname: string }[] = [];
  let p = cdOff;
  for (let i = 0; i < count; i++) {
    expect(v.getUint32(p, true)).toBe(0x02014b50);
    const flags = v.getUint16(p + 8, true), method = v.getUint16(p + 10, true), date = v.getUint16(p + 14, true);
    const crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true), elen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nlen));
    expect(csize).toBe(size);
    expect(v.getUint32(lo, true)).toBe(0x04034b50);
    const lflags = v.getUint16(lo + 6, true), lcrc = v.getUint32(lo + 14, true), lsize = v.getUint32(lo + 22, true), lnlen = v.getUint16(lo + 26, true), lelen = v.getUint16(lo + 28, true);
    const lname = new TextDecoder().decode(zip.subarray(lo + 30, lo + 30 + lnlen));
    expect(lflags).toBe(flags);
    out.push({ name, crc, size, flags, method, date, lcrc, lsize, lname, data: zip.subarray(lo + 30 + lnlen + lelen, lo + 30 + lnlen + lelen + size) });
    p += 46 + nlen + elen + clen;
  }
  expect(p).toBe(cdOff + cdSize);
  return out;
}

describe('createZip writes a structurally valid archive (checked without unzip)', () => {
  const files = [
    { name: 'data/Map001.json', data: new TextEncoder().encode('{"a":"Привіт"}') },
    { name: 'data/Empty.json', data: new Uint8Array() },
    { name: 'data/Великий/файл.json', data: Uint8Array.from({ length: 70000 }, (_, i) => (i * 31) & 0xff) },
  ];
  it('every central-directory field agrees with the data and with the local header', () => {
    const entries = parse(createZip(files));
    expect(entries.map(e => e.name)).toEqual(files.map(f => f.name));
    entries.forEach((e, i) => {
      const f = files[i]!;
      expect(e.size).toBe(f.data.length);
      expect(e.crc).toBe(nodeCrc32(f.data));
      expect(e.lcrc).toBe(e.crc);
      expect(e.lsize).toBe(e.size);
      expect(e.lname).toBe(e.name);
      expect(Array.from(e.data)).toEqual(Array.from(f.data));
      expect(e.method).toBe(0);
      expect(e.flags).toBe(0x0800);
      expect(e.date).toBe(0x0021);
    });
  });
});
