import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ensurePlugin, removePlugin } from '../src/plugininstall.mjs';
import { tmpdir } from '../support/tmp.mjs';

const require = createRequire(import.meta.url);
const repo = fileURLToPath(new URL('..', import.meta.url));

function fakePackage(version, parent = tmpdir('xs-pkg-')) {
  const root = path.join(parent, 'pkg');
  fs.mkdirSync(path.join(root, 'editor-plugin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'xiangsu-mcp-plus-win', version }));
  fs.writeFileSync(path.join(root, 'editor-plugin', 'runtime.cjs'), `module.exports = { version: ${JSON.stringify(version)} };\n`);
  return root;
}

function pluginRootWithOthers() {
  const root = tmpdir('xs-plugins-');
  fs.writeFileSync(
    path.join(root, 'plugins.config.json'),
    JSON.stringify({
      plugins: [
        { name: 'Other', version: '1.0.0', loadOnStartup: true },
        { name: 'CodexXiangsuMCP', version: '0.3.0', loadOnStartup: true },
      ],
    }),
  );
  return root;
}

const listed = (root) => JSON.parse(fs.readFileSync(path.join(root, 'plugins.config.json'), 'utf8')).plugins;
const entryCode = (root, version) => fs.readFileSync(path.join(root, `XiangsuMcpPlus@${version}`, 'index.js'), 'utf8');

test('a fresh install keeps other plugins and points at the package by absolute path', () => {
  const pluginRoot = pluginRootWithOthers();
  const pkgRoot = fakePackage('1.2.0');
  const res = ensurePlugin({ pluginRoot, pkgRoot, stateRoot: tmpdir('xs-st-') });
  assert.equal(res.action, 'installed');
  assert.deepEqual(listed(pluginRoot).map((p) => p.name), ['Other', 'CodexXiangsuMCP', 'XiangsuMcpPlus']);
  assert.ok(entryCode(pluginRoot, '1.2.0').includes(JSON.stringify(path.join(pkgRoot, 'editor-plugin', 'runtime.cjs'))));
  assert.ok(entryCode(pluginRoot, '1.2.0').includes("--projectType=project"));
  assert.equal(fs.readdirSync(pluginRoot).filter((name) => name.startsWith('plugins.config.json.bak-')).length, 1);
  const backupDir = fs.readdirSync(path.join(res.backup.dir, '..'));
  assert.ok(backupDir.length >= 1);
});

test('the same or a newer install is kept, an older one is replaced, and force replaces', () => {
  const pluginRoot = pluginRootWithOthers();
  const stateRoot = tmpdir('xs-st-');
  const newer = fakePackage('1.10.0');
  ensurePlugin({ pluginRoot, pkgRoot: newer, stateRoot });
  assert.equal(ensurePlugin({ pluginRoot, pkgRoot: fakePackage('1.9.0'), stateRoot }).action, 'kept');
  const newest = fakePackage('2.0.0');
  assert.equal(ensurePlugin({ pluginRoot, pkgRoot: newest, stateRoot }).action, 'installed');
  assert.ok(entryCode(pluginRoot, '2.0.0').includes(newest));
  const older = fakePackage('1.0.0');
  assert.equal(ensurePlugin({ pluginRoot, pkgRoot: older, stateRoot, force: true }).action, 'installed');
  assert.ok(entryCode(pluginRoot, '1.0.0').includes(older));
  assert.deepEqual(listed(pluginRoot).filter((p) => p.name === 'XiangsuMcpPlus'), [{ name: 'XiangsuMcpPlus', version: '1.0.0', loadOnStartup: true }]);
});

test('invalid plugin config is left untouched', () => {
  const pluginRoot = pluginRootWithOthers();
  const file = path.join(pluginRoot, 'plugins.config.json');
  fs.writeFileSync(file, '{');
  const before = fs.readFileSync(file);
  assert.throws(() => ensurePlugin({ pluginRoot, pkgRoot: fakePackage('1.0.0'), stateRoot: tmpdir('xs-st-') }), /PLUGIN_CONFIG_INVALID/);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.readdirSync(pluginRoot).some((name) => name.startsWith('XiangsuMcpPlus')), false);
});

test('uninstall removes only this plugin and keeps the backup', () => {
  const pluginRoot = pluginRootWithOthers();
  const stateRoot = tmpdir('xs-st-');
  fs.mkdirSync(path.join(pluginRoot, 'XiangsuMcpExt@0.2.0'));
  ensurePlugin({ pluginRoot, pkgRoot: fakePackage('1.2.0'), stateRoot });
  const result = removePlugin({ pluginRoot, stateRoot });
  assert.equal(result.action, 'removed');
  assert.deepEqual(result.kept, ['Other', 'CodexXiangsuMCP']);
  assert.deepEqual(listed(pluginRoot).map((p) => p.name), ['Other', 'CodexXiangsuMCP']);
  assert.equal(fs.readdirSync(pluginRoot).some((name) => name.startsWith('XiangsuMcp')), false);
  assert.ok(fs.readdirSync(pluginRoot).some((name) => name.startsWith('plugins.config.json.bak-')));
});

test('a package run from the npx cache is copied out before the cache disappears', () => {
  const pluginRoot = pluginRootWithOthers();
  const stateRoot = tmpdir('xs-st-');
  const cache = path.join(tmpdir('xs-npm-'), '_npx', 'abc', 'node_modules');
  fs.mkdirSync(cache, { recursive: true });
  const pkgRoot = fakePackage('1.2.0', cache);
  const res = ensurePlugin({ pluginRoot, pkgRoot, stateRoot });
  const copy = path.join(stateRoot, 'editor-plugin', '1.2.0', 'editor-plugin');
  assert.equal(res.code, copy);
  fs.rmSync(pkgRoot, { recursive: true, force: true });
  assert.deepEqual(require(path.join(copy, 'runtime.cjs')), { version: '1.2.0' });
  assert.equal(ensurePlugin({ pluginRoot, pkgRoot: fakePackage('1.2.0', cache), stateRoot }).action, 'kept');
});

test('dry-run does not write the plugin', () => {
  const pluginRoot = pluginRootWithOthers();
  const before = fs.readdirSync(pluginRoot).sort();
  const res = ensurePlugin({ pluginRoot, pkgRoot: fakePackage('1.2.0'), stateRoot: tmpdir('xs-st-'), dryRun: true });
  assert.equal(res.action, 'dry-run');
  assert.deepEqual(fs.readdirSync(pluginRoot).sort(), before);
});

test('the generated entry loads the real runtime without starting it', () => {
  const pluginRoot = tmpdir('xs-real-');
  ensurePlugin({ pluginRoot, pkgRoot: repo, stateRoot: tmpdir('xs-st-') });
  const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
  const Plugin = require(path.join(pluginRoot, `XiangsuMcpPlus@${version}`, 'index.js'));
  const plugin = new Plugin();
  const argv = process.argv;
  process.argv = argv.filter((arg) => arg !== '--projectType=project');
  try {
    plugin.initPlugin();
    assert.equal(plugin.runtime, undefined);
  } finally {
    process.argv = argv;
  }
});
