import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import { ensurePlugin, removePlugin, rollbackPlugin } from '../src/plugininstall.mjs';
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
const embeddedPath = (p) => JSON.stringify(p).slice(1, -1);

test('a fresh install keeps other plugins and points the entry at the state copy', () => {
  const pluginRoot = pluginRootWithOthers();
  const stateRoot = tmpdir('xs-st-');
  const pkgRoot = fakePackage('1.2.0');
  const res = ensurePlugin({ pluginRoot, pkgRoot, stateRoot });
  assert.equal(res.action, 'installed');
  assert.deepEqual(listed(pluginRoot).map((p) => p.name), ['Other', 'CodexXiangsuMCP', 'XiangsuMcpPlus']);
  assert.equal(res.code, path.join(stateRoot, 'editor-plugin', '1.2.0', res.build));
  assert.ok(entryCode(pluginRoot, '1.2.0').includes(JSON.stringify(path.join(res.code, 'runtime.cjs'))));
  assert.equal(JSON.parse(fs.readFileSync(path.join(pluginRoot, 'XiangsuMcpPlus@1.2.0', 'package.json'), 'utf8')).type, 'commonjs');
  assert.equal(JSON.parse(fs.readFileSync(path.join(pluginRoot, 'XiangsuMcpPlus@1.2.0', 'plugin.manifest.json'), 'utf8')).entry, 'index.js');
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
  const upgraded = ensurePlugin({ pluginRoot, pkgRoot: newest, stateRoot });
  assert.equal(upgraded.action, 'installed');
  assert.ok(entryCode(pluginRoot, '2.0.0').includes(embeddedPath(path.join(upgraded.code, 'runtime.cjs'))));
  const older = fakePackage('1.0.0');
  const forced = ensurePlugin({ pluginRoot, pkgRoot: older, stateRoot, force: true });
  assert.equal(forced.action, 'installed');
  assert.ok(entryCode(pluginRoot, '1.0.0').includes(embeddedPath(path.join(forced.code, 'runtime.cjs'))));
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
  const copy = path.join(stateRoot, 'editor-plugin', '1.2.0', res.build);
  assert.equal(res.code, copy);
  fs.rmSync(pkgRoot, { recursive: true, force: true });
  assert.deepEqual(require(path.join(copy, 'runtime.cjs')), { version: '1.2.0' });
  assert.equal(ensurePlugin({ pluginRoot, pkgRoot: fakePackage('1.2.0', cache), stateRoot }).action, 'kept');
});

test('a failed stage keeps the previous plugin files', () => {
  const pluginRoot = pluginRootWithOthers();
  const stateRoot = tmpdir('xs-st-');
  ensurePlugin({ pluginRoot, pkgRoot: fakePackage('1.0.0'), stateRoot });
  const oldIndex = path.join(pluginRoot, 'XiangsuMcpPlus@1.0.0', 'index.js');
  const oldText = fs.readFileSync(oldIndex, 'utf8');
  const oldConfig = fs.readFileSync(path.join(pluginRoot, 'plugins.config.json'), 'utf8');
  assert.throws(
    () =>
      ensurePlugin({
        pluginRoot,
        pkgRoot: fakePackage('2.0.0'),
        stateRoot,
        writeFileSync(file, data) {
          if (String(file).endsWith('index.js')) throw Error('disk full');
          fs.writeFileSync(file, data);
        },
      }),
    /disk full/,
  );
  assert.equal(fs.readFileSync(oldIndex, 'utf8'), oldText);
  assert.equal(fs.readFileSync(path.join(pluginRoot, 'plugins.config.json'), 'utf8'), oldConfig);
  assert.equal(fs.existsSync(path.join(pluginRoot, 'XiangsuMcpPlus@2.0.0')), false);
});

test('replacing a plugin keeps a restorable copy of the old directory', () => {
  const pluginRoot = pluginRootWithOthers();
  const stateRoot = tmpdir('xs-st-');
  const oldPkg = fakePackage('1.0.0');
  const first = ensurePlugin({ pluginRoot, pkgRoot: oldPkg, stateRoot });
  const upgraded = ensurePlugin({ pluginRoot, pkgRoot: fakePackage('2.0.0'), stateRoot });
  assert.equal(upgraded.action, 'installed');
  assert.ok(upgraded.directory_backups.length >= 1);
  const copied = fs.readFileSync(path.join(upgraded.directory_backups[0], 'index.js'), 'utf8');
  assert.ok(copied.includes(embeddedPath(path.join(first.code, 'runtime.cjs'))));
  assert.ok(fs.existsSync(path.join(pluginRoot, 'XiangsuMcpPlus@2.0.0', 'index.js')));
});

test('rollback restores the previous plugin directory and config without dropping other plugins', () => {
  const pluginRoot = pluginRootWithOthers();
  const stateRoot = tmpdir('xs-st-');
  const oldPkg = fakePackage('1.0.0');
  ensurePlugin({ pluginRoot, pkgRoot: oldPkg, stateRoot });
  const oldIndex = fs.readFileSync(path.join(pluginRoot, 'XiangsuMcpPlus@1.0.0', 'index.js'), 'utf8');
  const upgraded = ensurePlugin({ pluginRoot, pkgRoot: fakePackage('2.0.0'), stateRoot });
  const otherFile = path.join(pluginRoot, 'Other@1.0.0', 'keep.txt');
  fs.mkdirSync(path.dirname(otherFile), { recursive: true });
  fs.writeFileSync(otherFile, 'other');
  const result = rollbackPlugin({ pluginRoot, backupDir: upgraded.backup.dir });
  assert.equal(result.action, 'rolled-back');
  assert.ok(fs.existsSync(path.join(pluginRoot, 'XiangsuMcpPlus@1.0.0', 'index.js')));
  assert.equal(fs.existsSync(path.join(pluginRoot, 'XiangsuMcpPlus@2.0.0')), false);
  assert.equal(fs.readFileSync(path.join(pluginRoot, 'XiangsuMcpPlus@1.0.0', 'index.js'), 'utf8'), oldIndex);
  assert.deepEqual(listed(pluginRoot).map((p) => p.name), ['Other', 'CodexXiangsuMCP', 'XiangsuMcpPlus']);
  assert.equal(listed(pluginRoot).find((p) => p.name === 'XiangsuMcpPlus').version, '1.0.0');
  assert.equal(fs.readFileSync(otherFile, 'utf8'), 'other');
  assert.ok(fs.existsSync(path.join(upgraded.backup.dir, 'plugins.config.json')));
  assert.ok(fs.existsSync(path.join(upgraded.backup.dir, 'XiangsuMcpPlus@1.0.0', 'index.js')));
});

test('dry-run does not write the plugin', () => {
  const pluginRoot = pluginRootWithOthers();
  const before = fs.readdirSync(pluginRoot).sort();
  const res = ensurePlugin({ pluginRoot, pkgRoot: fakePackage('1.2.0'), stateRoot: tmpdir('xs-st-'), dryRun: true });
  assert.equal(res.action, 'dry-run');
  assert.deepEqual(fs.readdirSync(pluginRoot).sort(), before);
});

test('a same-version install without the commonjs boundary is replaced', () => {
  const pluginRoot = pluginRootWithOthers();
  const stateRoot = tmpdir('xs-st-');
  const pkgRoot = fakePackage('1.2.0');
  ensurePlugin({ pluginRoot, pkgRoot, stateRoot });
  const folder = path.join(pluginRoot, 'XiangsuMcpPlus@1.2.0');
  fs.rmSync(path.join(folder, 'package.json'));
  const markerPath = path.join(folder, 'install.json');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  delete marker.build;
  fs.writeFileSync(markerPath, JSON.stringify(marker));
  const again = ensurePlugin({ pluginRoot, pkgRoot, stateRoot });
  assert.equal(again.action, 'installed');
  assert.equal(JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8')).type, 'commonjs');
  assert.equal(ensurePlugin({ pluginRoot, pkgRoot, stateRoot }).action, 'kept');
});

test('the same version with different runtime bytes is installed again', () => {
  const pluginRoot = pluginRootWithOthers();
  const stateRoot = tmpdir('xs-st-');
  const first = ensurePlugin({ pluginRoot, pkgRoot: fakePackage('1.2.0'), stateRoot });
  const changed = fakePackage('1.2.0');
  fs.writeFileSync(path.join(changed, 'editor-plugin', 'runtime.cjs'), 'module.exports = { version: "1.2.0-fixed" };\n');
  const second = ensurePlugin({ pluginRoot, pkgRoot: changed, stateRoot });
  assert.equal(second.action, 'installed');
  assert.notEqual(second.build, first.build);
  assert.equal(fs.readFileSync(path.join(second.code, 'runtime.cjs'), 'utf8').includes('1.2.0-fixed'), true);
});

test('an index.js under an ancestor type module throws until the generated boundary is present', async () => {
  const home = tmpdir('xs-home-');
  fs.writeFileSync(path.join(home, 'package.json'), JSON.stringify({ type: 'module' }));
  const broken = path.join(home, 'Local', 'XiangsuMcpPlus@0.1.0');
  fs.mkdirSync(broken, { recursive: true });
  const runtime = path.join(home, 'runtime.cjs');
  fs.writeFileSync(runtime, 'module.exports = { Runtime: class {}, log() {} };\n');
  fs.writeFileSync(path.join(broken, 'index.js'), `'use strict';\nconst { Runtime, log } = require(${JSON.stringify(runtime)});\nmodule.exports = class { initPlugin() { this.runtime = new Runtime(); } };\n`);
  await assert.rejects(() => import(pathToFileURL(path.join(broken, 'index.js')).href), /require is not defined in ES module scope/);

  const pluginRoot = path.join(home, 'AppData', 'Local', 'DouyinAR', 'Plugins', 'v9.8.3', 'Local');
  fs.mkdirSync(pluginRoot, { recursive: true });
  const installed = ensurePlugin({ pluginRoot, pkgRoot: fakePackage('1.2.0'), stateRoot: tmpdir('xs-st-') });
  const entry = path.join(pluginRoot, 'XiangsuMcpPlus@1.2.0', 'index.js');
  const imported = await import(pathToFileURL(entry).href);
  const required = createRequire(path.join(home, 'package.json'))(entry);
  assert.equal(typeof imported.default, 'function');
  assert.equal(required, imported.default);
  const plugin = new imported.default();
  plugin.initPlugin();
  assert.equal(plugin.runtime, undefined);
  assert.equal(installed.requires_window_reopen, true);
});

test('the generated entry loads the real runtime without starting it', async () => {
  const version = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).version;
  for (const type of ['module', 'commonjs', null]) {
    const home = tmpdir('xs-home-');
    if (type) fs.writeFileSync(path.join(home, 'package.json'), JSON.stringify({ type }));
    const pluginRoot = path.join(home, 'AppData', 'Local', 'DouyinAR', 'Plugins', 'v9.8.3', 'Local');
    fs.mkdirSync(pluginRoot, { recursive: true });
    ensurePlugin({ pluginRoot, pkgRoot: repo, stateRoot: tmpdir('xs-st-') });
    const dir = path.join(pluginRoot, `XiangsuMcpPlus@${version}`);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).type, 'commonjs');
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'plugin.manifest.json'), 'utf8')).entry, 'index.js');
    const entry = path.join(dir, 'index.js');
    const imported = await import(pathToFileURL(entry).href);
    const required = createRequire(path.join(home, 'from.cjs'))(entry);
    assert.equal(imported.default, required);
    const plugin = new imported.default();
    const argv = process.argv;
    process.argv = argv.filter((arg) => arg !== '--projectType=project');
    try {
      plugin.initPlugin();
      assert.equal(plugin.runtime, undefined);
    } finally {
      process.argv = argv;
    }
    const source = fs.readFileSync(entry, 'utf8');
    assert.match(source, /const pending = this\.runtime\.start\(\)/);
    assert.match(source, /pending\.catch\(\(e\) => log\('init failed', e && e\.stack\)\)/);
  }
});

test('the generated entry logs an async ACL startup failure instead of leaving it unhandled', async () => {
  const logFile = path.join(tmpdir('xs-log-'), 'plugin.log');
  const pkg = fakePackage('1.2.0');
  fs.writeFileSync(
    path.join(pkg, 'editor-plugin', 'runtime.cjs'),
    `const fs = require('fs');
module.exports = {
  Runtime: class {
    start() { return Promise.reject(Error('ACL_FAILED: spawnSync powershell.exe ENOENT')); }
    stop() {}
  },
  log(...args) { fs.appendFileSync(${JSON.stringify(logFile)}, args.map(String).join(' ') + '\\n'); }
};
`,
  );
  const pluginRoot = pluginRootWithOthers();
  ensurePlugin({ pluginRoot, pkgRoot: pkg, stateRoot: tmpdir('xs-st-') });
  const entry = path.join(pluginRoot, 'XiangsuMcpPlus@1.2.0', 'index.js');
  const unhandled = [];
  const onUnhandled = (error) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  const argv = process.argv;
  process.argv = [...argv, '--projectType=project'];
  try {
    const Plugin = require(entry);
    const plugin = new Plugin();
    plugin.initPlugin();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled.map((error) => error.message), []);
    const text = fs.readFileSync(logFile, 'utf8');
    assert.match(text, /^init failed Error: ACL_FAILED: spawnSync powershell.exe ENOENT/m);
    assert.equal(text.includes('Unhandled Rejection'), false);
  } finally {
    process.argv = argv;
    process.off('unhandledRejection', onUnhandled);
  }
});
