import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { tmpdir } from '../support/tmp.mjs';

const require = createRequire(import.meta.url);
const { Library } = require('../editor-plugin/library.cjs');
const { M } = require('../editor-plugin/features/common.cjs');
const { sameIconPath } = require('../editor-plugin/features/icon.cjs');
const { MUTATING } = require('../editor-plugin/runtime.cjs');

const ICON_MAP = { 0: 'Icon/femaleIcon.png', 1: 'Icon/maleIcon.png', 2: 'Icon/commonIcon.png' };

function editor({ upload = async () => true, drop } = {}) {
  const projectDir = tmpdir('xs-icon-proj-');
  const calls = { upload: 0, show: 0, saved: 0 };
  class IconPreviewManager {
    constructor() {
      this.created = new Set();
      this.state = { 0: { iconUri: 'old-female' }, 1: { iconUri: 'old-male' } };
    }
    importAndCreateIcon(slot, projectPath) {
      calls.imported = calls.imported || [];
      calls.imported.push([slot, projectPath]);
      this.created.add(slot);
    }
    setIconExistState() {}
    updateIcon(slot, value) {
      this.state[slot] = { ...this.state[slot], ...value };
    }
    saveIconJson() {
      calls.saved += 1;
      calls.state = JSON.parse(JSON.stringify(this.state));
    }
    isIconCreated(slot) {
      return this.created.has(slot);
    }
    deleteIcon(slot) {
      calls.deleted = calls.deleted || [];
      calls.deleted.push(slot);
    }
    uploadDeleteIcon(slot) {
      this.created.delete(slot);
      fs.rmSync(path.join(projectDir, ICON_MAP[slot]), { force: true });
    }
  }
  const icons = new IconPreviewManager();
  IconPreviewManager.getInstance = () => icons;
  function ProjectClass() {}
  ProjectClass.prototype.isProjectChanged = () => false;
  const project = { path: projectDir, isProjectChanged: () => false };
  const registry = {
    [M.ef]: {
      Project: Object.assign(ProjectClass, {
        unload() {},
        Project: ProjectClass,
      }),
      ProjectManager: {
        getInstance: () => ({
          hasActiveProject: () => true,
          getCurrentActiveProject: () => project,
          getActiveProject: () => project,
        }),
      },
    },
    [M.analytics]: { AnalyticsBusinessPlugin: { instance: { flush() {}, safelyExitApplication() {} } } },
    [M.ipc]: { OpenProjectFromEditCommand() {} },
    [M.sender]: { EditSender: { getInstance: () => ({}) } },
    [M.scene]: { SceneModule: { getEditingSceneService: () => ({}) } },
    [M.iconPreview]: { iconTypeToProjectIconPathMap: ICON_MAP, IconPreviewManager },
    [M.iconUpload]: {
      default: {
        uploadIcon: async () => {
          calls.upload += 1;
          return upload(calls, projectDir, icons);
        },
      },
    },
    [M.iconWindow]: {
      showIconCreationWindow(from) {
        calls.show += 1;
        calls.from = from;
      },
    },
  };
  if (drop === 'deleteIcon') delete IconPreviewManager.prototype.deleteIcon;
  if (drop === 'project') delete registry[M.ipc].OpenProjectFromEditCommand;
  const lib = new Library((name) => {
    if (!Object.prototype.hasOwnProperty.call(registry, name)) throw Error(`MODULE_NOT_FOUND: ${name}`);
    return registry[name];
  });
  return { lib, projectDir, calls, icons, project };
}

test('icon self-check is separate from the project gate', () => {
  const ready = editor();
  assert.equal(ready.lib.selfCheck('icon').ok, true);
  assert.equal(ready.lib.selfCheck().features.project, true);
  assert.equal(ready.lib.selfCheck().ok, true);
  const broken = editor({ drop: 'deleteIcon' });
  const check = broken.lib.selfCheck();
  assert.equal(check.features.icon, false);
  assert.equal(check.features.project, true);
  assert.equal(check.ok, true);
  assert.ok(check.missing.some((item) => item.includes('deleteIcon')));
});

test('a missing project module still fails project even when icon modules exist', () => {
  const { lib } = editor({ drop: 'project' });
  const check = lib.selfCheck();
  assert.equal(check.features.project, false);
  assert.equal(check.features.icon, true);
  assert.equal(check.ok, false);
});

test('icon_set writes the mapped slots, uploads once, and reads the files back', async () => {
  const { lib, projectDir, calls } = editor();
  const png = path.join(tmpdir('xs-png-'), 'icon.png');
  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  const out = await lib.iconSet({ png_path: png, expected_project_path: projectDir });
  assert.deepEqual(out.types, ['female', 'male']);
  assert.deepEqual(out.icon_paths, [path.join(projectDir, ICON_MAP[0]), path.join(projectDir, ICON_MAP[1])]);
  for (const file of out.icon_paths) assert.deepEqual(fs.readFileSync(file), fs.readFileSync(png));
  assert.equal(out.uploaded, true);
  assert.deepEqual(out.project_icons, ['female', 'male']);
  assert.equal(calls.upload, 1);
  assert.equal(calls.saved, 1);
  assert.equal(calls.state[0].iconUri, undefined);
  assert.deepEqual(out.readback.map((item) => item.exists), [true, true]);
});

test('common replaces female and male, and a bad type or the wrong window writes nothing', async () => {
  const { lib, projectDir, calls, icons } = editor();
  const png = path.join(tmpdir('xs-png-'), 'icon.png');
  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  fs.mkdirSync(path.join(projectDir, 'Icon'));
  fs.writeFileSync(path.join(projectDir, ICON_MAP[0]), Buffer.from('old'));
  icons.created.add(1);
  const out = await lib.iconSet({ png_path: png, types: ['common'], expected_project_path: projectDir });
  assert.deepEqual(out.removed, ['female', 'male']);
  assert.deepEqual(out.project_icons, ['common']);
  assert.equal(fs.existsSync(path.join(projectDir, ICON_MAP[0])), false);
  assert.equal(calls.upload, 1);
  const before = fs.readdirSync(projectDir);
  await assert.rejects(lib.iconSet({ png_path: png, types: ['kid'], expected_project_path: projectDir }), /INVALID_ICON_TYPE: kid/);
  await assert.rejects(lib.iconSet({ png_path: png, expected_project_path: path.join(projectDir, 'other') }), /ICON_WINDOW_MISMATCH/);
  await assert.rejects(lib.iconSet({ png_path: path.join(projectDir, 'missing.png'), expected_project_path: projectDir }), /ICON_FILE_NOT_FOUND/);
  await assert.rejects(lib.iconSet({ png_path: png }), /ICON_TARGET_REQUIRED/);
  assert.equal(calls.upload, 1);
  assert.deepEqual(fs.readdirSync(projectDir).sort(), before.sort());
});

test('upload failure and an unclear upload result are not retried', async () => {
  const failed = editor({ upload: async () => false });
  const png = path.join(tmpdir('xs-png-'), 'icon.png');
  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  await assert.rejects(failed.lib.iconSet({ png_path: png, expected_project_path: failed.projectDir }), /ICON_UPLOAD_FAILED/);
  assert.equal(failed.calls.upload, 1);
  assert.equal(failed.calls.saved, 1);
  assert.equal(failed.calls.state[0].iconUri, undefined);

  const unclear = editor({ upload: async () => ({ uri: 'x' }) });
  await assert.rejects(unclear.lib.iconSet({ png_path: png, expected_project_path: unclear.projectDir }), /ICON_UPLOAD_UNCONFIRMED/);
  assert.equal(unclear.calls.upload, 1);

  const thrown = editor({
    upload: async () => {
      throw Error('socket hang up');
    },
  });
  await assert.rejects(thrown.lib.iconSet({ png_path: png, expected_project_path: thrown.projectDir }), /ICON_UPLOAD_UNKNOWN: socket hang up/);
  assert.equal(thrown.calls.upload, 1);
  assert.equal(thrown.calls.saved, 0);

  const unreadable = editor({
    upload: async (_calls, dir) => {
      fs.rmSync(path.join(dir, 'Icon'), { recursive: true, force: true });
      return true;
    },
  });
  await assert.rejects(unreadable.lib.iconSet({ png_path: png, expected_project_path: unreadable.projectDir }), /ICON_READBACK_FAILED/);
  assert.equal(unreadable.calls.upload, 1);
});

test('a missing icon module does not write and does not fail an otherwise compatible project check', async () => {
  const { lib, projectDir } = editor({ drop: 'deleteIcon' });
  const png = path.join(tmpdir('xs-png-'), 'icon.png');
  fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
  await assert.rejects(lib.iconSet({ png_path: png, expected_project_path: projectDir }), /INCOMPATIBLE_EDITOR/);
  assert.equal(fs.existsSync(path.join(projectDir, 'Icon')), false);
  assert.equal(lib.selfCheck().features.project, true);
});

test('icon_open calls the window once and does not claim it was seen', async () => {
  const { lib, projectDir, calls } = editor();
  assert.deepEqual(await lib.iconOpen({ expected_project_path: projectDir }), {
    project_path: projectDir,
    called: 'showIconCreationWindow',
    argument: 'tool_bar',
    window_readback: false,
    minimized: null,
    focus_policy: 'not_attempted',
  });
  assert.equal(calls.show, 1);
  assert.equal(calls.from, 'tool_bar');

  const boom = editor();
  const original = boom.lib.mod.bind(boom.lib);
  boom.lib.mod = (name) => {
    if (name === M.iconWindow) {
      return {
        showIconCreationWindow() {
          boom.calls.show += 1;
          throw Error('window failed');
        },
      };
    }
    return original(name);
  };
  assert.throws(() => boom.lib.iconOpen({ expected_project_path: boom.projectDir }), /window failed/);
  assert.equal(boom.calls.show, 1);
});

test('windows path identity ignores slash and case only on win32', () => {
  assert.equal(sameIconPath('E:/图标/A/', 'e:\\图标\\a', 'win32'), true);
  assert.equal(sameIconPath('/tmp/A', '/tmp/a', 'linux'), false);
});

test('icon methods do not submit, publish, or tick an agreement', () => {
  const source = fs.readFileSync(new URL('../editor-plugin/features/icon.cjs', import.meta.url), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.equal(/submit_confirm|submit_prepare|提交审核|uploadEffect|\bagreement\b/.test(source), false);
  assert.equal(MUTATING.has('icon_set'), true);
  assert.equal(MUTATING.has('icon_open'), true);
});
