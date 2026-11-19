import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { tmpdir } from '../support/tmp.mjs';
import { ICON_SIZE, centerSquare, discardPreparedIcon, isAbsoluteIconPath, prepareIcon, sniffImage } from '../src/icon-image.mjs';

const GIF_1X1 = Buffer.from('4749463839610100010000000021f90401000000002c00000000010001000002024c01003b', 'hex');

async function solidPng(width, height, pixels) {
  return sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function rawOf(file) {
  return sharp(file).raw().toBuffer({ resolveWithObject: true });
}

function assertSolid(data, info, rgb) {
  assert.equal(info.width, ICON_SIZE);
  assert.equal(info.height, ICON_SIZE);
  assert.equal(info.channels, 3);
  for (let i = 0; i < data.length; i += 3) {
    assert.equal(data[i], rgb[0]);
    assert.equal(data[i + 1], rgb[1]);
    assert.equal(data[i + 2], rgb[2]);
  }
}

test('centre-crop keeps the extra pixel on the right or bottom', () => {
  assert.deepEqual(centerSquare(360, 360), { left: 0, top: 0, side: 360, source_width: 360, source_height: 360 });
  assert.deepEqual(centerSquare(444, 354), { left: 45, top: 0, side: 354, source_width: 444, source_height: 354 });
  assert.deepEqual(centerSquare(4, 1).left, 1);
  assert.deepEqual(centerSquare(4, 3), { left: 0, top: 0, side: 3, source_width: 4, source_height: 3 });
  assert.deepEqual(centerSquare(3, 5), { left: 0, top: 1, side: 3, source_width: 3, source_height: 5 });
  assert.throws(() => centerSquare(0, 10), /BAD_IMAGE_SIZE/);
  assert.throws(() => centerSquare(8193, 10), /IMAGE_TOO_LARGE: 8193×10/);
});

test('absolute paths accept Windows and POSIX forms and reject relatives', () => {
  assert.equal(isAbsoluteIconPath('C:\\图标\\a.png', path.win32), true);
  assert.equal(isAbsoluteIconPath('\\\\server\\share\\图标.png', path.win32), true);
  assert.equal(isAbsoluteIconPath('图标\\a.png', path.win32), false);
  assert.equal(isAbsoluteIconPath('/tmp/图标/a.png', path.posix), true);
  assert.equal(isAbsoluteIconPath('相对.png', path.posix), false);
  assert.equal(isAbsoluteIconPath('/tmp/a\0.png', path.posix), false);
});

test('the converter does not shell out to sips', () => {
  const source = fs.readFileSync(new URL('../src/icon-image.mjs', import.meta.url), 'utf8');
  assert.equal(source.includes('child_process'), false);
  assert.equal(source.includes("'sips'"), false);
  assert.equal(source.includes('"sips"'), false);
});

test('a wide PNG is centre-cropped to the middle pixel and scaled to 360 without touching the source', async () => {
  const root = tmpdir('xs-icon-src-');
  const src = path.join(root, 'wide.png');
  const pixels = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  fs.writeFileSync(src, await solidPng(4, 1, pixels));
  fs.chmodSync(src, 0o444);
  const before = fs.readFileSync(src);
  const prepared = await prepareIcon(src);
  try {
    assert.deepEqual(prepared.crop, { left: 1, top: 0, side: 1, source_width: 4, source_height: 1 });
    assert.equal(prepared.output.width, 360);
    assert.equal(prepared.output.height, 360);
    assert.equal(prepared.output.mime, 'image/png');
    assert.equal(sniffImage(fs.readFileSync(prepared.png)), 'image/png');
    assert.notEqual(path.resolve(prepared.png), path.resolve(src));
    assert.equal(prepared.overwritten_source, false);
    assert.deepEqual(fs.readFileSync(src), before);
    const out = await rawOf(prepared.png);
    assertSolid(out.data, out.info, [0, 255, 0]);
  } finally {
    fs.chmodSync(src, 0o644);
    discardPreparedIcon(prepared);
  }
  assert.equal(fs.existsSync(prepared.dir), false);
});

test('a tall PNG keeps the centre rows', async () => {
  const root = tmpdir('xs-icon-src-');
  const src = path.join(root, 'tall.png');
  const pixels = Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 0]);
  fs.writeFileSync(src, await solidPng(1, 4, pixels));
  const prepared = await prepareIcon(src);
  try {
    assert.deepEqual(prepared.crop, { left: 0, top: 1, side: 1, source_width: 1, source_height: 4 });
    const out = await rawOf(prepared.png);
    assertSolid(out.data, out.info, [0, 255, 0]);
  } finally {
    discardPreparedIcon(prepared);
  }
});

test('jpeg, webp, gif and a misnamed file become a 360 PNG; EXIF orientation is applied before the crop', async () => {
  const root = tmpdir('xs-icon-src-');
  const jpeg = await sharp({ create: { width: 4, height: 2, channels: 3, background: { r: 8, g: 16, b: 32 } } }).jpeg().toBuffer();
  const turned = await sharp(jpeg).withMetadata({ orientation: 6 }).toBuffer();
  const turnedPath = path.join(root, 'turned.jpg');
  fs.writeFileSync(turnedPath, turned);
  const oriented = await prepareIcon(turnedPath);
  try {
    assert.equal(oriented.input.mime, 'image/jpeg');
    assert.equal(oriented.input.orientation, 6);
    assert.deepEqual([oriented.input.width, oriented.input.height], [2, 4]);
    assert.deepEqual([oriented.crop.left, oriented.crop.top, oriented.crop.side], [0, 1, 2]);
    assert.equal((await sharp(oriented.png).metadata()).width, 360);
  } finally {
    discardPreparedIcon(oriented);
  }

  const webpPath = path.join(root, 'wide.webp');
  fs.writeFileSync(webpPath, await sharp({ create: { width: 8, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } } }).webp().toBuffer());
  const webp = await prepareIcon(webpPath);
  try {
    assert.equal(webp.input.mime, 'image/webp');
    assert.deepEqual([webp.crop.left, webp.crop.side], [2, 4]);
    assert.equal(sniffImage(fs.readFileSync(webp.png)), 'image/png');
  } finally {
    discardPreparedIcon(webp);
  }

  const gifPath = path.join(root, 'dot.gif');
  fs.writeFileSync(gifPath, GIF_1X1);
  const gif = await prepareIcon(gifPath);
  try {
    assert.equal(gif.input.mime, 'image/gif');
    assert.deepEqual([gif.input.width, gif.input.height, gif.crop.side], [1, 1, 1]);
    assert.equal((await sharp(gif.png).metadata()).height, 360);
  } finally {
    discardPreparedIcon(gif);
  }

  const named = path.join(root, 'actually-png.jpg');
  fs.writeFileSync(named, await solidPng(2, 2, Buffer.from([9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9])));
  const swapped = await prepareIcon(named);
  try {
    assert.equal(swapped.input.mime, 'image/png');
    assert.equal(swapped.output.width, 360);
  } finally {
    discardPreparedIcon(swapped);
  }
});

test('unicode paths are read as files, not as a shell command', async () => {
  const root = tmpdir('xs-icon-src-');
  const src = path.join(root, '图标', 'café 测试.png');
  fs.mkdirSync(path.dirname(src), { recursive: true });
  fs.writeFileSync(src, await solidPng(2, 2, Buffer.alloc(12, 40)));
  const before = fs.readFileSync(src);
  const prepared = await prepareIcon(src);
  try {
    assert.equal(prepared.input.mime, 'image/png');
    assert.equal(prepared.output.width, 360);
    assert.deepEqual(fs.readFileSync(src), before);
    assert.equal(fs.realpathSync(prepared.png) === fs.realpathSync(src), false);
  } finally {
    discardPreparedIcon(prepared);
  }
});

test('alpha is kept and an already-square image is only scaled', async () => {
  const root = tmpdir('xs-icon-src-');
  const src = path.join(root, 'alpha.png');
  const raw = Buffer.from([200, 100, 50, 128]);
  fs.writeFileSync(src, await sharp(raw, { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer());
  const prepared = await prepareIcon(src);
  try {
    assert.deepEqual(prepared.crop, { left: 0, top: 0, side: 1, source_width: 1, source_height: 1 });
    const out = await sharp(prepared.png).raw().toBuffer({ resolveWithObject: true });
    assert.equal(out.info.channels, 4);
    for (let channel = 0; channel < 3; channel += 1) assert.ok(Math.abs(out.data[channel] - raw[channel]) <= 2);
    assert.equal(out.data[3], 128);
  } finally {
    discardPreparedIcon(prepared);
  }
});

test('bad files, directories and relative paths fail before a temp icon is left behind', async () => {
  const root = tmpdir('xs-icon-src-');
  const tmpRoot = path.join(root, 'tmp');
  fs.mkdirSync(tmpRoot);
  const empty = path.join(root, 'empty.png');
  fs.writeFileSync(empty, Buffer.alloc(0));
  const text = path.join(root, 'notes.png');
  fs.writeFileSync(text, Buffer.from('not an image'));
  const truncated = path.join(root, 'broken.png');
  fs.writeFileSync(truncated, Buffer.from('89504e470d0a1a0a00000000', 'hex'));
  const bmp = path.join(root, 'a.bmp');
  fs.writeFileSync(bmp, Buffer.from('BM' + 'xxxx'));
  const big = path.join(root, 'big.png');
  fs.writeFileSync(big, await solidPng(2, 2, Buffer.alloc(12, 1)));

  await assert.rejects(prepareIcon(path.join(root, 'missing.png'), { tmpRoot }), /IMAGE_NOT_FOUND/);
  await assert.rejects(prepareIcon('相对.png', { tmpRoot }), /IMAGE_NOT_FOUND/);
  await assert.rejects(prepareIcon(root, { tmpRoot }), /IMAGE_NOT_A_FILE/);
  await assert.rejects(prepareIcon(empty, { tmpRoot }), /EMPTY_IMAGE/);
  await assert.rejects(prepareIcon(text, { tmpRoot }), /UNSUPPORTED_IMAGE/);
  await assert.rejects(prepareIcon(bmp, { tmpRoot }), /UNSUPPORTED_IMAGE/);
  await assert.rejects(prepareIcon(truncated, { tmpRoot }), /BAD_IMAGE/);
  await assert.rejects(prepareIcon(big, { tmpRoot, maxBytes: 8 }), /IMAGE_TOO_LARGE/);
  await assert.rejects(prepareIcon(big, { tmpRoot, maxEdge: 1 }), /IMAGE_TOO_LARGE/);
  assert.deepEqual(fs.readdirSync(tmpRoot), []);
  assert.deepEqual(fs.readFileSync(big).subarray(0, 8), Buffer.from('89504e470d0a1a0a', 'hex'));
});
