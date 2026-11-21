import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { defaultCandidates, discoverEditor, runningEditorExes, userPluginRoot } from '../src/editor.mjs';
import { peWithFileVersion } from '../support/pe-fixture.mjs';
import { tmpdir } from '../support/tmp.mjs';

const rootDir = fileURLToPath(new URL('..', import.meta.url));

function productTree() {
  const root = tmpdir('xs-editor-');
  const exe = path.join(root, 'electron', 'Douyin AR.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.mkdirSync(path.join(root, 'Resources'));
  fs.mkdirSync(path.join(root, 'electron', 'Resources'));
  fs.writeFileSync(exe, peWithFileVersion('9.8.3.942073156'));
  fs.writeFileSync(path.join(root, 'electron', 'version'), '41.7.1\n');
  return { root, exe };
}

test('electron subdirectory layout uses product Resources and the exe FileVersion', () => {
  const { root } = productTree();
  const local = path.join(tmpdir('xs-local-'), 'AppData', 'Local');
  const found = discoverEditor({
    env: { XIANGSU_EDITOR_ROOT: root, LOCALAPPDATA: local },
    platform: process.platform,
  });
  assert.equal(found.version, '9.8.3');
  assert.equal(found.fileVersion, '9.8.3.942073156');
  assert.equal(found.exe, path.join(root, 'electron', 'Douyin AR.exe'));
  assert.equal(found.resources, path.join(root, 'Resources'));
  assert.notEqual(found.resources, path.join(root, 'electron', 'Resources'));
  assert.equal(found.pluginRoot, path.join(local, 'DouyinAR', 'Plugins', 'v9.8.3', 'Local'));
  assert.equal(found.ignoredElectronVersion, true);
});

test('a root pointed at the electron folder walks up to the product root', () => {
  const { root } = productTree();
  const found = discoverEditor({
    env: { XIANGSU_EDITOR_ROOT: path.join(root, 'electron'), LOCALAPPDATA: path.join(root, 'local') },
  });
  assert.equal(found.productRoot, root);
  assert.equal(found.resources, path.join(root, 'Resources'));
});

test('an explicit root that is only an Electron version file fails', () => {
  const root = tmpdir('xs-bad-');
  fs.mkdirSync(path.join(root, 'electron'), { recursive: true });
  fs.writeFileSync(path.join(root, 'electron', 'version'), '41.7.1\n');
  assert.throws(() => discoverEditor({ env: { XIANGSU_EDITOR_ROOT: root, LOCALAPPDATA: root } }), /EDITOR_LAYOUT_UNKNOWN/);
});

test('windows discovery paths are not a personal install path', () => {
  const source = fs.readFileSync(path.join(rootDir, 'src', 'editor.mjs'), 'utf8');
  assert.equal(source.includes(['E:', 'Apps', 'Douyin AR'].join('\\')), false);
  const candidates = defaultCandidates({
    env: { LOCALAPPDATA: 'C:\\Users\\Example\\AppData\\Local', ProgramFiles: 'C:\\Program Files', 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
    platform: 'win32',
  });
  assert.deepEqual(candidates, [
    'C:\\Users\\Example\\AppData\\Local\\Douyin AR',
    'C:\\Program Files\\Douyin AR',
    'C:\\Program Files (x86)\\Douyin AR',
  ]);
});

test('win32 layout prefers a running electron exe over a default candidate', () => {
  const exists = (file) => {
    const key = file.replace(/\//g, '\\').toLowerCase();
    return [
      'd:\\example\\douyin ar\\electron\\douyin ar.exe',
      'd:\\example\\douyin ar\\resources',
      'c:\\users\\example\\appdata\\local\\douyin ar\\douyin ar.exe',
    ].includes(key);
  };
  const found = discoverEditor({
    env: { LOCALAPPDATA: 'C:\\Users\\Example\\AppData\\Local' },
    platform: 'win32',
    exists,
    readVersion: (exe) => {
      assert.equal(exe.toLowerCase(), 'd:\\example\\douyin ar\\electron\\douyin ar.exe');
      return '9.8.3.942073156';
    },
    runningExes: ['D:\\Example\\Douyin AR\\electron\\Douyin AR.exe'],
    candidates: ['C:\\Users\\Example\\AppData\\Local\\Douyin AR'],
  });
  assert.equal(found.source, 'running-process');
  assert.equal(found.resources, 'D:\\Example\\Douyin AR\\Resources');
  assert.equal(found.pluginRoot, userPluginRoot('C:\\Users\\Example\\AppData\\Local', '9.8.3', 'win32'));
});

test('an explicit editor root that does not match the layout is not replaced by a candidate', () => {
  assert.throws(
    () =>
      discoverEditor({
        env: { XIANGSU_EDITOR_ROOT: 'D:\\missing', LOCALAPPDATA: 'C:\\Users\\Example\\AppData\\Local' },
        platform: 'win32',
        exists: () => false,
        candidates: ['C:\\Users\\Example\\AppData\\Local\\Douyin AR'],
      }),
    /EDITOR_LAYOUT_UNKNOWN/,
  );
});

test('running editor lookup uses SystemRoot powershell instead of PATH', () => {
  const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  const calls = [];
  const found = runningEditorExes({
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32' },
    existsSync: (candidate) => String(candidate).replaceAll('/', '\\') === powershell,
    execFile(cmd) {
      calls.push(String(cmd));
      if (!path.win32.isAbsolute(cmd)) throw Object.assign(Error(`spawnSync ${cmd} ENOENT`), { code: 'ENOENT' });
      return 'D:\\Douyin AR\\Douyin AR.exe\r\nD:\\Douyin AR\\Douyin AR.exe\r\n';
    },
  });
  assert.deepEqual(calls, [powershell]);
  assert.deepEqual(found, ['D:\\Douyin AR\\Douyin AR.exe']);
  assert.deepEqual(
    runningEditorExes({
      platform: 'win32',
      env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32' },
      existsSync: () => false,
      execFile() {
        throw Error('PATH search');
      },
    }),
    [],
  );
});
