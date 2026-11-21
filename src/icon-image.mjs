// Local 360×360 icon PNG. Replaces the macOS `sips` step in
// Muqian-Sun/xiangsu-mcp-plus src/icons.mjs (MIT, Copyright (c) 2026 muqian,
// inspected at 05d83470): centre-crop to a square, then scale to 360.
// This file never calls sips and never writes the source path.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

export const ICON_SIZE = 360;
export const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
export const MAX_SOURCE_EDGE = 8192;

const ACCEPTED = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export function sniffImage(buf) {
  if (!Buffer.isBuffer(buf)) return null;
  if (buf.length >= 8 && buf.readUInt32BE(0) === 0x89504e47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 6 && buf.toString('latin1', 0, 4) === 'GIF8') return 'image/gif';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function isAbsoluteIconPath(src, pathImpl = path) {
  return typeof src === 'string' && src.length > 0 && !src.includes('\0') && pathImpl.isAbsolute(src);
}

// Square taken from the oriented bitmap.
// left/top use floor, so when the leftover is odd the extra pixel stays on the right or bottom.
export function centerSquare(width, height, maxEdge = MAX_SOURCE_EDGE) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw Error(`BAD_IMAGE_SIZE: ${width}×${height}`);
  }
  if (width > maxEdge || height > maxEdge) throw Error(`IMAGE_TOO_LARGE: ${width}×${height}; max edge ${maxEdge}`);
  const side = Math.min(width, height);
  return {
    left: Math.floor((width - side) / 2),
    top: Math.floor((height - side) / 2),
    side,
    source_width: width,
    source_height: height,
  };
}

// EXIF orientations 5–8 swap the stored axes. sharp's rotate() applies that swap;
// metadata() on the unrotated pipeline still reports the stored size.
export function orientedSize(meta) {
  const width = meta?.width;
  const height = meta?.height;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw Error(`BAD_IMAGE_SIZE: ${width}×${height}`);
  }
  const orientation = meta.orientation || 1;
  if (orientation >= 5 && orientation <= 8) return { width: height, height: width, orientation };
  return { width, height, orientation };
}

export function discardPreparedIcon(prepared) {
  if (prepared?.dir) fs.rmSync(prepared.dir, { recursive: true, force: true });
}

function decodeOptions(maxEdge) {
  return { failOn: 'error', animated: false, pages: 1, limitInputPixels: maxEdge * maxEdge };
}

function asImageError(src, error) {
  const message = error?.message || String(error);
  if (/pixel limit/i.test(message)) return Error(`IMAGE_TOO_LARGE: ${src} (${message})`);
  return Error(`BAD_IMAGE: ${src} (${message})`);
}

export async function prepareIcon(src, { maxBytes = MAX_SOURCE_BYTES, maxEdge = MAX_SOURCE_EDGE, tmpRoot = os.tmpdir() } = {}) {
  if (!isAbsoluteIconPath(src)) throw Error(`IMAGE_NOT_FOUND: ${src}`);
  let stat;
  try {
    stat = fs.statSync(src);
  } catch (error) {
    const code = error?.code || error?.message || 'unreadable';
    throw Error(`IMAGE_NOT_FOUND: ${src} (${code})`);
  }
  if (!stat.isFile()) throw Error(`IMAGE_NOT_A_FILE: ${src}`);
  if (stat.size === 0) throw Error(`EMPTY_IMAGE: ${src}`);
  if (stat.size > maxBytes) throw Error(`IMAGE_TOO_LARGE: ${stat.size} bytes; max ${maxBytes}`);

  const input = fs.readFileSync(src);
  const mime = sniffImage(input);
  if (!mime || !ACCEPTED.includes(mime)) throw Error(`UNSUPPORTED_IMAGE: ${src}`);

  let meta;
  try {
    meta = await sharp(input, decodeOptions(maxEdge)).metadata();
  } catch (error) {
    throw asImageError(src, error);
  }
  const oriented = orientedSize(meta);
  const crop = centerSquare(oriented.width, oriented.height, maxEdge);
  const sourceReal = fs.realpathSync(src);
  const dir = fs.mkdtempSync(path.join(tmpRoot, 'xs-icon-'));
  const pngPath = path.join(dir, 'icon.png');
  try {
    if (path.resolve(pngPath) === path.resolve(src)) throw Error(`REFUSING_SOURCE_OVERWRITE: ${src}`);
    let png;
    try {
      png = await sharp(input, decodeOptions(maxEdge))
        .rotate()
        .extract({ left: crop.left, top: crop.top, width: crop.side, height: crop.side })
        .resize(ICON_SIZE, ICON_SIZE, { fit: 'fill', kernel: 'lanczos3', withoutEnlargement: false })
        .png()
        .toBuffer();
    } catch (error) {
      throw asImageError(src, error);
    }
    if (sniffImage(png) !== 'image/png') throw Error(`ICON_CONVERT_FAILED: ${src}`);
    const outMeta = await sharp(png).metadata();
    if (outMeta.width !== ICON_SIZE || outMeta.height !== ICON_SIZE) {
      throw Error(`ICON_CONVERT_FAILED: ${outMeta.width}×${outMeta.height}`);
    }
    const handle = fs.openSync(pngPath, 'wx');
    try {
      fs.writeSync(handle, png);
    } finally {
      fs.closeSync(handle);
    }
    if (fs.realpathSync(pngPath) === sourceReal) throw Error(`REFUSING_SOURCE_OVERWRITE: ${src}`);
    const reread = fs.readFileSync(src);
    if (!reread.equals(input)) throw Error(`SOURCE_CHANGED: ${src}`);
    return {
      png: pngPath,
      dir,
      source: src,
      input: {
        mime,
        width: oriented.width,
        height: oriented.height,
        orientation: oriented.orientation,
        pages: meta.pages ?? 1,
      },
      crop,
      output: { width: ICON_SIZE, height: ICON_SIZE, mime: 'image/png', bytes: png.length },
      overwritten_source: false,
    };
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw error;
  }
}
