// Read the FileVersion string from a Windows PE version resource.
// The 4th component of a 像塑 FileVersion (for example 942073156) does not fit in
// VS_FIXEDFILEINFO's 16-bit fields, so the string table is the source of truth.
// `electron/version` is the Electron version and is intentionally ignored.
import fs from 'node:fs';

export function readFileVersion(file, { readFileSync = fs.readFileSync } = {}) {
  const version = fileVersionFromPe(readFileSync(file));
  if (!version) throw Error(`EDITOR_VERSION_UNKNOWN: no FileVersion resource in ${file}`);
  return version;
}

export function fileVersionFromPe(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 0x40 || buf.toString('ascii', 0, 2) !== 'MZ') {
    throw Error('EDITOR_VERSION_UNKNOWN: not a PE file');
  }
  const pe = buf.readUInt32LE(0x3c);
  if (pe <= 0 || pe + 24 > buf.length || buf.toString('ascii', pe, pe + 4) !== 'PE\0\0') {
    throw Error('EDITOR_VERSION_UNKNOWN: missing PE signature');
  }
  const coff = pe + 4;
  const sections = buf.readUInt16LE(coff + 2);
  const optSize = buf.readUInt16LE(coff + 16);
  const opt = coff + 20;
  if (opt + optSize > buf.length) throw Error('EDITOR_VERSION_UNKNOWN: optional header truncated');
  const magic = buf.readUInt16LE(opt);
  const ddOff = magic === 0x10b ? 96 : magic === 0x20b ? 112 : null;
  if (ddOff == null) throw Error(`EDITOR_VERSION_UNKNOWN: PE magic 0x${magic.toString(16)}`);
  const numDd = buf.readUInt32LE(opt + ddOff - 4);
  if (numDd < 3) return null;
  const resRva = buf.readUInt32LE(opt + ddOff + 16);
  const resSize = buf.readUInt32LE(opt + ddOff + 20);
  if (!resRva || !resSize) return null;
  const secTable = opt + optSize;
  const mapped = [];
  for (let i = 0; i < sections; i++) {
    const s = secTable + i * 40;
    if (s + 40 > buf.length) throw Error('EDITOR_VERSION_UNKNOWN: section table truncated');
    mapped.push({
      va: buf.readUInt32LE(s + 12),
      vsize: buf.readUInt32LE(s + 8),
      raw: buf.readUInt32LE(s + 20),
      rawSize: buf.readUInt32LE(s + 16),
    });
  }
  const rvaToOff = (rva) => {
    for (const s of mapped) {
      const size = Math.max(s.vsize, s.rawSize);
      if (rva >= s.va && rva < s.va + size) return s.raw + (rva - s.va);
    }
    throw Error(`EDITOR_VERSION_UNKNOWN: RVA 0x${rva.toString(16)} is not in a section`);
  };
  const root = rvaToOff(resRva);
  const blob = walkResources(buf, root, root, rvaToOff, 0);
  return blob ? utf16FileVersion(blob) : null;
}

function walkResources(buf, root, dir, rvaToOff, depth) {
  if (depth > 6 || dir + 16 > buf.length) return null;
  const named = buf.readUInt16LE(dir + 12);
  const ids = buf.readUInt16LE(dir + 14);
  const count = named + ids;
  let cursor = dir + 16;
  for (let i = 0; i < count; i++) {
    if (cursor + 8 > buf.length) return null;
    const nameOrId = buf.readUInt32LE(cursor);
    const offset = buf.readUInt32LE(cursor + 4);
    cursor += 8;
    const id = nameOrId & 0x80000000 ? null : nameOrId;
    if (depth === 0 && id !== 16) continue;
    const rel = offset & 0x7fffffff;
    const at = root + rel;
    if (offset & 0x80000000) {
      const found = walkResources(buf, root, at, rvaToOff, depth + 1);
      if (found) return found;
    } else if (at + 8 <= buf.length) {
      const dataRva = buf.readUInt32LE(at);
      const dataSize = buf.readUInt32LE(at + 4);
      const fileOff = rvaToOff(dataRva);
      if (fileOff < 0 || fileOff + dataSize > buf.length) return null;
      return buf.subarray(fileOff, fileOff + dataSize);
    }
  }
  return null;
}

export function utf16FileVersion(blob) {
  const text = blob.toString('utf16le');
  const key = 'FileVersion';
  const idx = text.indexOf(key);
  if (idx < 0) return null;
  let byteOff = (idx + key.length + 1) * 2;
  const limit = Math.min(blob.length - 1, byteOff + 16);
  while (byteOff + 1 < limit) {
    const c = blob.readUInt16LE(byteOff);
    if (c >= 48 && c <= 57) break;
    byteOff += 2;
  }
  let out = '';
  while (byteOff + 1 < blob.length) {
    const c = blob.readUInt16LE(byteOff);
    byteOff += 2;
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out || null;
}

export function shortEditorVersion(fileVersion) {
  const match = /^(\d+\.\d+\.\d+)(?:\.\d+)?$/.exec(String(fileVersion).trim());
  if (!match) throw Error(`EDITOR_VERSION_UNKNOWN: ${fileVersion}`);
  return { short: match[1], file: String(fileVersion).trim() };
}
