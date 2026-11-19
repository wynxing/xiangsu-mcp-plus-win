import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const required = [
  'package/scripts/install.mjs',
  'package/scripts/uninstall.mjs',
  'package/scripts/rollback.mjs',
  'package/src/server.mjs',
];

test('npm pack tarball contains the documented install, uninstall, rollback, and server entrypoints', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'xs-pack-'));
  const packed = JSON.parse(execFileSync('npm', ['pack', '--pack-destination', dest, '--json'], { cwd: root, encoding: 'utf8' }));
  const archive = path.join(dest, packed[0].filename);
  const names = new Set(execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).split(/\r?\n/).filter(Boolean));
  const missing = required.filter((file) => !names.has(file));
  assert.deepEqual(missing, [], `tarball ${packed[0].filename} is missing ${missing.join(', ')}`);
});
