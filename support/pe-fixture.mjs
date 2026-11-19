// Minimal PE32 image whose version resource carries a FileVersion string.
import { Buffer } from 'node:buffer';

function utf16(value) {
  return Buffer.from(`${value}\0`, 'utf16le');
}

function pad4(buf) {
  const extra = (4 - (buf.length % 4)) % 4;
  return extra ? Buffer.concat([buf, Buffer.alloc(extra)]) : buf;
}

function versionBlob(fileVersion) {
  const fixed = Buffer.alloc(52);
  fixed.writeUInt32LE(0xfeef04bd, 0);
  fixed.writeUInt32LE(0x00010000, 4);
  fixed.writeUInt32LE((9 << 16) | 8, 8);
  fixed.writeUInt32LE((3 << 16) | 0, 12);
  const string = Buffer.concat([
    word(0, utf16(fileVersion).length / 2, 1),
    pad4(utf16('FileVersion')),
    pad4(utf16(fileVersion)),
  ]);
  string.writeUInt16LE(string.length, 0);
  const table = Buffer.concat([word(0, 0, 1), pad4(utf16('040904b0')), pad4(string)]);
  table.writeUInt16LE(table.length, 0);
  const info = Buffer.concat([word(0, 0, 1), pad4(utf16('StringFileInfo')), pad4(table)]);
  info.writeUInt16LE(info.length, 0);
  const root = Buffer.concat([word(0, 52, 0), pad4(utf16('VS_VERSION_INFO')), pad4(fixed), pad4(info)]);
  root.writeUInt16LE(root.length, 0);
  return root;
}

function word(length, valueLength, type) {
  const buf = Buffer.alloc(6);
  buf.writeUInt16LE(length, 0);
  buf.writeUInt16LE(valueLength, 2);
  buf.writeUInt16LE(type, 4);
  return buf;
}

function resourceSection(blob) {
  const blobOff = 88;
  const section = Buffer.alloc(blobOff + blob.length);
  section.writeUInt16LE(1, 14);
  section.writeUInt32LE(16, 16);
  section.writeUInt32LE((0x80000000 | 24) >>> 0, 20);
  section.writeUInt16LE(1, 24 + 14);
  section.writeUInt32LE(1, 24 + 16);
  section.writeUInt32LE((0x80000000 | 48) >>> 0, 24 + 20);
  section.writeUInt16LE(1, 48 + 14);
  section.writeUInt32LE(0x409, 48 + 16);
  section.writeUInt32LE(72, 48 + 20);
  blob.copy(section, blobOff);
  return { section, blobOff, blobSize: blob.length, dataEntryOff: 72 };
}

export function peWithFileVersion(fileVersion) {
  const blob = versionBlob(fileVersion);
  const { section, blobOff, blobSize, dataEntryOff } = resourceSection(blob);
  const fileAlign = 0x200;
  const sectionAlign = 0x1000;
  const headerSize = 0x200;
  const rawSize = Math.ceil(section.length / fileAlign) * fileAlign;
  const raw = Buffer.alloc(headerSize + rawSize);
  raw.write('MZ', 0, 'ascii');
  raw.writeUInt32LE(0x80, 0x3c);
  raw.write('PE\0\0', 0x80, 'ascii');
  const coff = 0x84;
  raw.writeUInt16LE(0x14c, coff);
  raw.writeUInt16LE(1, coff + 2);
  const optSize = 96 + 16 * 8;
  raw.writeUInt16LE(optSize, coff + 16);
  const opt = coff + 20;
  raw.writeUInt16LE(0x10b, opt);
  raw.writeUInt32LE(sectionAlign, opt + 32);
  raw.writeUInt32LE(fileAlign, opt + 36);
  raw.writeUInt16LE(6, opt + 40);
  raw.writeUInt32LE(sectionAlign * 2, opt + 56);
  raw.writeUInt32LE(headerSize, opt + 60);
  raw.writeUInt16LE(3, opt + 68);
  raw.writeUInt32LE(16, opt + 92);
  const resRva = 0x1000;
  raw.writeUInt32LE(resRva, opt + 96 + 16);
  raw.writeUInt32LE(section.length, opt + 96 + 20);
  const sec = opt + optSize;
  raw.write('.rsrc\0\0\0', sec, 'ascii');
  raw.writeUInt32LE(section.length, sec + 8);
  raw.writeUInt32LE(resRva, sec + 12);
  raw.writeUInt32LE(rawSize, sec + 16);
  raw.writeUInt32LE(headerSize, sec + 20);
  section.writeUInt32LE(resRva + blobOff, dataEntryOff);
  section.writeUInt32LE(blobSize, dataEntryOff + 4);
  section.copy(raw, headerSize);
  return raw;
}
