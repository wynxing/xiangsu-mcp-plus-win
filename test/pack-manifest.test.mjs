import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const required = [
  'package/scripts/install.mjs',
  'package/scripts/uninstall.mjs',
  'package/scripts/rollback.mjs',
  'package/src/server.mjs',
  'package/src/icon-image.mjs',
  'package/src/icons.mjs',
  'package/editor-plugin/features/icon.cjs',
  'package/editor-plugin/features/music.cjs',
  'package/src/music.mjs',
  'package/npm-shrinkwrap.json',
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

function extractTarGz(archive, dest) {
  const data = zlib.gunzipSync(fs.readFileSync(archive));
  for (let offset = 0; offset + 512 <= data.length;) {
    const header = data.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const sizeText = header.subarray(124, 136).toString('utf8').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText, 8) || 0;
    const fullName = prefix ? `${prefix}/${name}` : name;
    const file = path.join(dest, ...fullName.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (header[156] === 48 || header[156] === 0) fs.writeFileSync(file, data.subarray(offset + 512, offset + 512 + size));
    offset += 512 * (1 + Math.ceil(size / 512));
  }
}

test('npm pack tarball contains the documented entrypoints and its generated plugin loads under an ancestor type module', async () => {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'xs-pack-'));
  const stdout = npm(['pack', '--pack-destination', dest, '--json'], { cwd: root, encoding: 'utf8', windowsHide: true });
  const packed = JSON.parse(stdout.slice(stdout.indexOf('[')));
  const archive = path.join(dest, packed[0].filename);
  const names = new Set(tarNames(archive));
  const missing = required.filter((file) => !names.has(file));
  assert.deepEqual(missing, [], `tarball ${packed[0].filename} is missing ${missing.join(', ')}`);

  const extracted = path.join(dest, 'extracted');
  extractTarGz(archive, extracted);
  const pkgRoot = path.join(extracted, 'package');
  const { ensurePlugin } = await import(pathToFileURL(path.join(pkgRoot, 'src', 'plugininstall.mjs')).href);
  for (const type of ['module', 'commonjs']) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'xs-home-'));
    fs.writeFileSync(path.join(home, 'package.json'), JSON.stringify({ type }));
    const pluginRoot = path.join(home, 'AppData', 'Local', 'DouyinAR', 'Plugins', 'v9.8.3', 'Local');
    const stateRoot = path.join(home, 'state');
    const installed = ensurePlugin({ pluginRoot, pkgRoot, stateRoot });
    assert.equal(installed.action, 'installed');
    assert.equal(ensurePlugin({ pluginRoot, pkgRoot, stateRoot }).action, 'kept');
    const version = JSON.parse(fs.readFileSync(path.join(pkgRoot, 'package.json'), 'utf8')).version;
    const dir = path.join(pluginRoot, `XiangsuMcpPlus@${version}`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).type, 'commonjs');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'plugin.manifest.json'), 'utf8')).entry, 'index.js');
    assert.ok(fs.readFileSync(path.join(dir, 'index.js'), 'utf8').includes(JSON.stringify(path.join(installed.code, 'runtime.cjs'))));
    const entry = path.join(dir, 'index.js');
    const imported = await import(pathToFileURL(entry).href);
    const { createRequire } = await import('node:module');
    const required = createRequire(path.join(home, 'package.json'))(entry);
    assert.equal(typeof imported.default, 'function');
    assert.equal(required, imported.default);
    const plugin = new imported.default();
    const argv = process.argv;
    process.argv = argv.filter((arg) => arg !== '--projectType=project');
    try {
      plugin.initPlugin();
      assert.equal(plugin.runtime, undefined);
    } finally {
      process.argv = argv;
    }
  }
});
