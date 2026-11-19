// Installs the XiangsuMcpPlus editor plugin into 像塑's per-version Local plugin folder.
// index.js requires editor-plugin/runtime.cjs by absolute path. The runtime is copied into
// the state directory so the entry does not depend on an extracted tarball or an npx cache.
// The plugin folder also gets {"type":"commonjs"}. Node classifies index.js from the nearest
// package.json, and a home directory "type":"module" would otherwise make require throw.
//
// Adapted from Muqian-Sun/xiangsu-mcp-plus src/plugininstall.mjs (MIT, Copyright (c) 2026 muqian).
// Windows plugin root: %LOCALAPPDATA%\DouyinAR\Plugins\v<short>\Local.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverEditor } from './editor.mjs';

export const PLUGIN_NAME = 'XiangsuMcpPlus';
const LEGACY_NAMES = new Set([PLUGIN_NAME, 'XiangsuMcpExt']);
const MARKER = 'install.json';
const ENTRY_FORMAT = 'cjs-package-boundary-1';
const PKG_ROOT = fileURLToPath(new URL('..', import.meta.url));

export function defaultStateRoot(homedir = os.homedir) {
  return path.join(homedir(), '.xiangsu-mcp-plus-win');
}

export function stateRootOf(env = process.env) {
  return env.XIANGSU_MCP_PLUS_STATE || defaultStateRoot();
}

function compareVersions(a, b) {
  const parse = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
    if (!m) throw Error(`BAD_VERSION: ${v}`);
    return m.slice(1).map(Number);
  };
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e instanceof SyntaxError) throw Error(`PLUGIN_CONFIG_INVALID: ${file} (${e.message}); not modified`);
    throw e;
  }
}

function installed(pluginRoot) {
  const listPath = path.join(pluginRoot, 'plugins.config.json');
  if (!fs.existsSync(listPath)) return null;
  const listed = (readJson(listPath).plugins || []).find((p) => p.name === PLUGIN_NAME);
  if (!listed) return null;
  const folder = path.join(pluginRoot, `${PLUGIN_NAME}@${listed.version}`);
  const marker = path.join(folder, MARKER);
  if (!fs.existsSync(marker)) return null;
  const record = readJson(marker);
  if (!record.code || !fs.existsSync(path.join(record.code, 'runtime.cjs'))) return null;
  return { ...record, folder };
}

function boundarySource() {
  return `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`;
}

function entrySource(runtimeFile) {
  return `'use strict';
const { Runtime, log } = require(${JSON.stringify(runtimeFile)});
module.exports = class {
  initPlugin() {
    if (!process.argv.includes('--projectType=project')) return;
    try { this.runtime = new Runtime(); this.runtime.start(); }
    catch (e) { log('init failed', e && e.stack); }
  }
  deinitPlugin() { this.runtime && this.runtime.stop(); }
};
`;
}

function pluginBuild(pkgRoot) {
  const hash = crypto.createHash('sha256');
  hash.update(ENTRY_FORMAT);
  hash.update('\0');
  hash.update(entrySource('__RUNTIME__'));
  hash.update('\0');
  hash.update(boundarySource());
  const dir = path.join(pkgRoot, 'editor-plugin');
  const files = [];
  const walk = (current) => {
    for (const name of fs.readdirSync(current).sort()) {
      const full = path.join(current, name);
      if (fs.statSync(full).isDirectory()) walk(full);
      else files.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  };
  walk(dir);
  for (const rel of files) {
    hash.update(rel);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(dir, ...rel.split('/'))));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 16);
}

function boundaryOk(folder) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
    const manifest = JSON.parse(fs.readFileSync(path.join(folder, 'plugin.manifest.json'), 'utf8'));
    return pkg.type === 'commonjs' && manifest.entry === 'index.js' && fs.existsSync(path.join(folder, 'index.js'));
  } catch {
    return false;
  }
}

function stableCode(pkgRoot, version, build, stateRoot) {
  const src = path.join(pkgRoot, 'editor-plugin');
  const dest = path.join(stateRoot, 'editor-plugin', version, build);
  if (path.resolve(src) === path.resolve(dest)) return dest;
  if (!fs.existsSync(path.join(dest, 'runtime.cjs'))) {
    const tmp = `${dest}.tmp-${process.pid}`;
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.cpSync(src, tmp, { recursive: true });
    if (!fs.existsSync(path.join(tmp, 'runtime.cjs'))) throw Error('INSTALL_RUNTIME_MISSING');
    fs.rmSync(dest, { recursive: true, force: true });
    fs.renameSync(tmp, dest);
  }
  return dest;
}

function backupConfig(listPath, stateRoot, raw, stamp) {
  const beside = `${listPath}.bak-${stamp}`;
  fs.copyFileSync(listPath, beside);
  const dir = path.join(stateRoot, 'install-backups', stamp);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugins.config.json'), raw);
  return { beside, dir };
}

function backupDirectory(src, stateRoot, stamp) {
  const dest = path.join(stateRoot, 'install-backups', stamp, path.basename(src));
  fs.cpSync(src, dest, { recursive: true });
  if (fs.existsSync(path.join(src, 'index.js')) && !fs.existsSync(path.join(dest, 'index.js'))) throw Error(`INSTALL_BACKUP_FAILED: ${src}`);
  return dest;
}

function ownFolders(pluginRoot) {
  if (!fs.existsSync(pluginRoot)) return [];
  return fs.readdirSync(pluginRoot).filter((entry) => LEGACY_NAMES.has(entry.split('@')[0]));
}

export function ensurePlugin({
  pluginRoot,
  pkgRoot = PKG_ROOT,
  stateRoot = stateRootOf(),
  editor = null,
  force = false,
  dryRun = false,
  manifestVersion = null,
  writeFileSync = fs.writeFileSync,
} = {}) {
  const pkg = readJson(path.join(pkgRoot, 'package.json'));
  const version = pkg.version;
  const folderVersion = manifestVersion || version;
  const build = pluginBuild(pkgRoot);
  fs.mkdirSync(pluginRoot, { recursive: true });
  const current = installed(pluginRoot);
  const samePayload = current && compareVersions(current.version, version) === 0 && current.build === build && boundaryOk(current.folder);
  const newer = current && compareVersions(current.version, version) > 0;
  if (!force && (samePayload || newer)) {
    return { action: 'kept', plugin_root: pluginRoot, version: current.version, build: current.build || null, code: current.code, editor: editor || null, requires_window_reopen: false };
  }
  const code = stableCode(pkgRoot, version, build, stateRoot);
  const runtimeFile = path.join(code, 'runtime.cjs');
  const removed = ownFolders(pluginRoot);
  const listPath = path.join(pluginRoot, 'plugins.config.json');
  let list = { plugins: [] };
  let raw = null;
  if (fs.existsSync(listPath)) {
    raw = fs.readFileSync(listPath, 'utf8');
    try {
      list = JSON.parse(raw);
    } catch (e) {
      throw Error(`PLUGIN_CONFIG_INVALID: ${listPath} (${e.message}); not modified`);
    }
    if (!list || typeof list !== 'object' || !Array.isArray(list.plugins)) {
      throw Error(`PLUGIN_CONFIG_INVALID: ${listPath} has no plugins array; not modified`);
    }
  }
  const plan = {
    action: 'installed',
    plugin_root: pluginRoot,
    version,
    build,
    code,
    plugin: path.join(pluginRoot, `${PLUGIN_NAME}@${folderVersion}`),
    removed,
    editor: editor || null,
    requires_window_reopen: true,
    preserved: (list.plugins || []).filter((p) => !LEGACY_NAMES.has(p.name)).map((p) => p.name),
  };
  if (dryRun) return { ...plan, action: 'dry-run' };
  const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  let backup = null;
  const directoryBackups = [];
  if (raw != null) backup = backupConfig(listPath, stateRoot, raw, stamp);
  for (const entry of removed) directoryBackups.push(backupDirectory(path.join(pluginRoot, entry), stateRoot, stamp));
  const dest = plan.plugin;
  const staging = path.join(pluginRoot, `.${PLUGIN_NAME}@${folderVersion}.staging-${process.pid}`);
  const configTmp = `${listPath}.tmp-${process.pid}`;
  const aside = (entry) => path.join(pluginRoot, `.${entry}.aside-${process.pid}`);
  const restoreAside = () => {
    for (const entry of removed) {
      const held = aside(entry);
      const original = path.join(pluginRoot, entry);
      if (fs.existsSync(held) && !fs.existsSync(original)) fs.renameSync(held, original);
    }
  };
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.mkdirSync(staging, { recursive: true });
    const files = {
      'index.js': entrySource(runtimeFile),
      'package.json': boundarySource(),
      'plugin.manifest.json': JSON.stringify(
        {
          name: PLUGIN_NAME,
          version: folderVersion,
          description: 'Local RPC bridge for xiangsu-mcp-plus-win (unofficial)',
          requirements: { orionSDK: '', apis: {} },
          entry: 'index.js',
          builderVersion: 1,
        },
        null,
        2,
      ),
      [MARKER]: JSON.stringify({ package: pkg.name, version, build, code, entryFormat: ENTRY_FORMAT }, null, 2),
    };
    for (const [name, contents] of Object.entries(files)) writeFileSync(path.join(staging, name), contents);
    for (const name of Object.keys(files)) {
      if (!fs.existsSync(path.join(staging, name))) throw Error(`INSTALL_STAGE_INCOMPLETE: ${name}`);
    }
    if (!fs.readFileSync(path.join(staging, 'index.js'), 'utf8').includes(JSON.stringify(runtimeFile))) throw Error('INSTALL_STAGE_INCOMPLETE: index');
    const stagedBoundary = JSON.parse(fs.readFileSync(path.join(staging, 'package.json'), 'utf8'));
    const stagedManifest = JSON.parse(fs.readFileSync(path.join(staging, 'plugin.manifest.json'), 'utf8'));
    if (stagedBoundary.type !== 'commonjs' || stagedManifest.entry !== 'index.js') throw Error('INSTALL_STAGE_INCOMPLETE: boundary');
    const next = {
      ...list,
      plugins: (list.plugins || []).filter((p) => !LEGACY_NAMES.has(p.name)).concat([{ name: PLUGIN_NAME, version: folderVersion, loadOnStartup: true }]),
    };
    writeFileSync(configTmp, JSON.stringify(next, null, 2));
    const stagedList = JSON.parse(fs.readFileSync(configTmp, 'utf8'));
    if (!stagedList.plugins.some((p) => p.name === PLUGIN_NAME && p.version === folderVersion)) throw Error('INSTALL_STAGE_INCOMPLETE: config');
    for (const entry of removed) fs.renameSync(path.join(pluginRoot, entry), aside(entry));
    if (fs.existsSync(dest)) fs.renameSync(dest, aside(path.basename(dest)));
    fs.renameSync(staging, dest);
    fs.renameSync(configTmp, listPath);
    for (const entry of removed) fs.rmSync(aside(entry), { recursive: true, force: true });
    if (path.basename(dest) !== removed.find((entry) => entry === path.basename(dest))) {
      const heldDest = aside(path.basename(dest));
      if (fs.existsSync(heldDest)) fs.rmSync(heldDest, { recursive: true, force: true });
    }
  } catch (e) {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(configTmp, { force: true });
    if (fs.existsSync(dest) && fs.existsSync(aside(path.basename(dest)))) fs.rmSync(dest, { recursive: true, force: true });
    restoreAside();
    const heldDest = aside(path.basename(dest));
    if (fs.existsSync(heldDest) && !fs.existsSync(dest)) fs.renameSync(heldDest, dest);
    throw e;
  }
  return { ...plan, backup, directory_backups: directoryBackups };
}

export function removePlugin({ pluginRoot, stateRoot = stateRootOf(), dryRun = false } = {}) {
  if (!pluginRoot) throw Error('PLUGIN_ROOT_UNSET');
  const removed = ownFolders(pluginRoot);
  const listPath = path.join(pluginRoot, 'plugins.config.json');
  let kept = [];
  let list = null;
  if (fs.existsSync(listPath)) {
    const raw = fs.readFileSync(listPath, 'utf8');
    list = JSON.parse(raw);
    if (!list || !Array.isArray(list.plugins)) throw Error(`PLUGIN_CONFIG_INVALID: ${listPath}; not modified`);
    kept = list.plugins.filter((p) => !LEGACY_NAMES.has(p.name));
    if (dryRun) return { action: 'dry-run', removed, kept: kept.map((p) => p.name), plugin_root: pluginRoot };
    const stamp = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
    const backup = backupConfig(listPath, stateRoot, raw, stamp);
    const directoryBackups = removed.map((entry) => backupDirectory(path.join(pluginRoot, entry), stateRoot, stamp));
    for (const entry of removed) fs.rmSync(path.join(pluginRoot, entry), { recursive: true, force: true });
    const tmp = `${listPath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ ...list, plugins: kept }, null, 2));
    fs.renameSync(tmp, listPath);
    return { action: 'removed', removed, kept: kept.map((p) => p.name), plugin_root: pluginRoot, backup, directory_backups: directoryBackups };
  }
  if (dryRun) return { action: 'dry-run', removed, kept, plugin_root: pluginRoot };
  for (const entry of removed) fs.rmSync(path.join(pluginRoot, entry), { recursive: true, force: true });
  return { action: 'removed', removed, kept, plugin_root: pluginRoot };
}

export function rollbackPlugin({ pluginRoot, backupDir } = {}) {
  if (!pluginRoot || !backupDir) throw Error('ROLLBACK_UNSET');
  const configBackup = path.join(backupDir, 'plugins.config.json');
  if (!fs.existsSync(configBackup)) throw Error(`ROLLBACK_BACKUP_MISSING: ${configBackup}`);
  const raw = fs.readFileSync(configBackup, 'utf8');
  const list = JSON.parse(raw);
  if (!list || !Array.isArray(list.plugins)) throw Error(`ROLLBACK_BACKUP_INVALID: ${configBackup}`);
  const restored = fs.readdirSync(backupDir).filter((name) => {
    const full = path.join(backupDir, name);
    return name !== 'plugins.config.json' && fs.statSync(full).isDirectory();
  });
  for (const name of restored) {
    const dest = path.join(pluginRoot, name);
    fs.rmSync(dest, { recursive: true, force: true });
    fs.cpSync(path.join(backupDir, name), dest, { recursive: true });
  }
  for (const name of ownFolders(pluginRoot)) {
    if (!restored.includes(name)) fs.rmSync(path.join(pluginRoot, name), { recursive: true, force: true });
  }
  const listPath = path.join(pluginRoot, 'plugins.config.json');
  const tmp = `${listPath}.rollback-${process.pid}`;
  fs.writeFileSync(tmp, raw);
  fs.renameSync(tmp, listPath);
  return { action: 'rolled-back', plugin_root: pluginRoot, backup_dir: backupDir, restored };
}

export function installFromEnvironment({ env = process.env, force = false, dryRun = false, discover = discoverEditor } = {}) {
  const pluginRoot = env.XIANGSU_PLUGIN_ROOT;
  if (pluginRoot) return ensurePlugin({ pluginRoot, stateRoot: stateRootOf(env), force, dryRun });
  const editor = discover({ env });
  return ensurePlugin({ pluginRoot: editor.pluginRoot, stateRoot: stateRootOf(env), editor, force, dryRun });
}

export function uninstallFromEnvironment({ env = process.env, dryRun = false, discover = discoverEditor } = {}) {
  const pluginRoot = env.XIANGSU_PLUGIN_ROOT || discover({ env }).pluginRoot;
  return removePlugin({ pluginRoot, stateRoot: stateRootOf(env), dryRun });
}

export function cli(argv = process.argv, fn = installFromEnvironment) {
  const force = argv.includes('--force');
  const dryRun = argv.includes('--dry-run');
  try {
    const result = fn({ force, dryRun });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exitCode = 1;
  }
}
