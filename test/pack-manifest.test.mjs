import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const required = [
  'package/scripts/install.mjs',
  'package/scripts/uninstall.mjs',
  'package/scripts/rollback.mjs',
  'package/src/server.mjs',
];

function npm(args, options) {
  const cli = process.env.npm_execpath;
  if (cli) return execFileSync(process.execPath, [cli, ...args], options);
  const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  return execFileSync(command, args, { ...options, shell: process.platform === 'win32' });
}

function tarNames(archive) {
  const data = zlib.gunzipSync(fs.readFileSync(archive));
  const names = [];
  for (let offset = 0; offset + 512 <= data.length;) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText, 8) || 0;
    names.push(prefix ? `${prefix}/${name}` : name);
    offset += 512 * (1 + Math.ceil(size / 512));
  }
  return names;
}

test('npm pack tarball contains the documented install, uninstall, rollback, and server entrypoints', () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'xs-pack-'));
  const stdout = npm(['pack', '--pack-destination', dest, '--json'], { cwd: root, encoding: 'utf8', windowsHide: true });
  const packed = JSON.parse(stdout.slice(stdout.indexOf('[')));
  const archive = path.join(dest, packed[0].filename);
  const names = new Set(tarNames(archive));
  const missing = required.filter((file) => !names.has(file));
  assert.deepEqual(missing, [], `tarball ${packed[0].filename} is missing ${missing.join(', ')}`);
});
