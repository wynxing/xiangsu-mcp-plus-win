import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { Library } = require('../editor-plugin/library.cjs');
const { M } = require('../editor-plugin/features/common.cjs');
const { CLOSE_DELAY_MS } = require('../editor-plugin/features/project.cjs');

function editor(overrides = {}) {
  const calls = [];
  let reads = 0;
  function Project() {}
  Project.unload = async () => calls.push('unload');
  if (!overrides.omitChanged) Project.prototype.isProjectChanged = function () { return false; };
  const registry = {
    [M.ef]: {
      Project,
      ProjectManager: {
        getInstance: () => ({
          hasActiveProject: () => overrides.active !== false,
          getCurrentActiveProject: () => ({
            path: overrides.path === undefined ? 'E:\\工作\\probe' : overrides.path,
            isProjectChanged: () => {
              reads += 1;
              if (overrides.changedSequence) return overrides.changedSequence[Math.min(reads - 1, overrides.changedSequence.length - 1)];
              return overrides.changed ?? false;
            },
          }),
        }),
      },
    },
    [M.analytics]: {
      AnalyticsBusinessPlugin: {
        instance: {
          flush: async () => calls.push('flush'),
          safelyExitApplication: (reason) => calls.push(reason),
        },
      },
    },
    [M.ipc]: { OpenProjectFromEditCommand: function Command(...args) { this.args = args; } },
    [M.sender]: {
      EditSender: {
        getInstance: () => ({
          sendCmdWithResponse: async (command) => {
            calls.push(command.args);
            return overrides.launch ?? { status: 'succeeded' };
          },
        }),
      },
    },
    [M.scene]: { SceneModule: { getEditingSceneService: () => ({ sceneEditor: overrides.scene === false ? null : {} }) } },
    [M.orionui]: { Window: class Window {}, WindowState: {}, WindowStyle: {} },
  };
  if (overrides.drop) delete registry[overrides.drop.mod][overrides.drop.key];
  return { calls, lib: new Library((name) => {
    if (!Object.prototype.hasOwnProperty.call(registry, name)) throw Error(`MODULE_NOT_FOUND: ${name}`);
    return registry[name];
  }) };
}

test('missing project internals fail the self-check and are not reported as compatible', () => {
  const { lib } = editor({ drop: { mod: M.ipc, key: 'OpenProjectFromEditCommand' } });
  const check = lib.selfCheck();
  assert.equal(check.ok, false);
  assert.equal(check.features.project, false);
  assert.equal(check.diagnostics_ok, false);
  assert.ok(check.missing.some((item) => item.includes('OpenProjectFromEditCommand')));
  assert.throws(() => lib.ensureCompatible('project'), /INCOMPATIBLE_EDITOR/);
});

test('music and icon gaps are diagnostic and do not by themselves fail the project gate', () => {
  const { lib } = editor();
  const check = lib.selfCheck();
  assert.equal(check.features.project, true);
  assert.equal(check.ok, true);
  assert.equal(check.features.music, false);
  assert.equal(check.features.icon, false);
  assert.equal(check.features.quietWindows, false);
  assert.equal(check.diagnostics_ok, false);
  assert.deepEqual(check.not_enabled, ['music', 'icon']);
});

test('project_launch refuses a reuse answer and project_close refuses dirty or unknown state', async () => {
  const limit = editor({ launch: { status: 'reuseCurrent', processCount: 2 } });
  await assert.rejects(limit.lib.projectLaunch({ operation: 'createNew' }), /WINDOW_LIMIT/);
  const dirty = editor({ changed: true });
  const scheduled = [];
  dirty.lib.schedule = (fn, ms) => scheduled.push(ms);
  assert.throws(() => dirty.lib.projectClose({}), /PROJECT_HAS_UNSAVED_CHANGES/);
  assert.deepEqual(scheduled, []);
  const unknown = editor();
  const original = unknown.lib.mod;
  unknown.lib.mod = (name) => {
    if (name === M.scene) throw Error('scene gone');
    return original(name);
  };
  assert.throws(() => unknown.lib.projectState(), /UNKNOWN_DIRTY_STATE/);
});

test('a window that is not active, or becomes dirty before exit, is not closed', async () => {
  const inactive = editor({ active: false });
  const skipped = [];
  inactive.lib.schedule = (fn, ms) => skipped.push(ms);
  assert.throws(() => inactive.lib.projectClose({}), /UNKNOWN_DIRTY_STATE/);
  assert.deepEqual(skipped, []);

  const { lib, calls } = editor({ changedSequence: [false, true] });
  const scheduled = [];
  lib.schedule = (fn, ms) => scheduled.push({ ms, fn });
  const result = lib.projectClose({});
  assert.equal(result.discarded_changes, false);
  await scheduled[0].fn();
  assert.deepEqual(calls, []);
});

test('project compatibility requires isProjectChanged', () => {
  const { lib } = editor({ omitChanged: true });
  const check = lib.selfCheck('project');
  assert.equal(check.ok, false);
  assert.ok(check.missing.some((item) => item.includes('isProjectChanged')));
  assert.throws(() => lib.projectClose({}), /INCOMPATIBLE_EDITOR/);
});

test('a clean close schedules unload and does not exit immediately', () => {
  const { lib, calls } = editor({ changed: false });
  const scheduled = [];
  lib.schedule = (fn, ms) => scheduled.push({ ms, fn });
  const result = lib.projectClose({});
  assert.equal(result.closing, true);
  assert.equal(result.discarded_changes, false);
  assert.deepEqual(scheduled.map((item) => item.ms), [CLOSE_DELAY_MS]);
  assert.deepEqual(calls, []);
  return scheduled[0].fn().then(() => {
    assert.deepEqual(calls, ['unload', 'flush', 'no_save_exit']);
  });
});
