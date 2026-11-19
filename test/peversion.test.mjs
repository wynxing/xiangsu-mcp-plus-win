import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileVersionFromPe, readFileVersion, shortEditorVersion, utf16FileVersion } from '../src/peversion.mjs';
import { peWithFileVersion } from '../support/pe-fixture.mjs';
import { tmpdir } from '../support/tmp.mjs';

test('FileVersion string is read even when the fixed numeric fields cannot hold the build', () => {
  const buf = peWithFileVersion('9.8.3.942073156');
  assert.equal(fileVersionFromPe(buf), '9.8.3.942073156');
  assert.equal(shortEditorVersion('9.8.3.942073156').short, '9.8.3');
});

test('readFileVersion reads the exe and does not consult a nearby text file', () => {
  const dir = tmpdir('xs-pe-');
  const exe = path.join(dir, 'Douyin AR.exe');
  fs.writeFileSync(exe, peWithFileVersion('9.8.3.942073156'));
  fs.writeFileSync(path.join(dir, 'version'), '41.7.1\n');
  assert.equal(readFileVersion(exe), '9.8.3.942073156');
});

test('a buffer without a version string does not invent one', () => {
  const blob = Buffer.from('VS_VERSION_INFO\0', 'utf16le');
  assert.equal(utf16FileVersion(blob), null);
  assert.throws(() => shortEditorVersion('not-a-version'), /EDITOR_VERSION_UNKNOWN/);
});
