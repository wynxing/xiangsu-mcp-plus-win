import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { Projects, projectPolicy } from '../src/projects.mjs';
import { tmpdir } from '../support/tmp.mjs';

function world({ paths } = {}) {
  const windows = new Map(paths ?? [[100, path.join(tmpdir('xs-open-'), 'S16')]]);
  const calls = [];
  let readyAfter = 1;
  const ready = new Map();
  const official = {
    callJson: async (name, args) => {
      calls.push(['official', name, args]);
      if (name === 'list_instances') {
        return { instances: [...windows].map(([pid, projectPath], index) => ({ instance_id: String(index + 1), generation: `${pid}-abc`, project_path: projectPath })) };
      }
      if (name === 'save_project') {
        const pid = [...windows].find(([, projectPath], index) => String(index + 1) === String(args.instance_id))[0];
        windows.set(pid, args.path);
        return { save_status: 'succeeded' };
      }
      if (name === 'project_status') {
        const found = [...windows].find((entry, index) => String(index + 1) === String(args.instance_id));
        if (!found) throw Error('missing instance');
        const merged = { project_path: found[1], generation: `${found[0]}-abc`, is_changed: false, scene_dirty: false, ...d.projectStatus };
        if (merged.scene_dirty === null) delete merged.scene_dirty;
        return merged;
      }
      throw Error(`unexpected ${name}`);
    },
  };
  const d = {
    official,
    projectStatus: {},
    sleep: async () => {},
    openTimeoutMs: 50,
    closeTimeoutMs: 50,
    launchRetryMs: 50,
    instanceTimeoutMs: 0,
    saveTimeoutMs: 50,
    platform: process.platform,
    allow: [os.tmpdir()],
    stateRoot: tmpdir('xs-locks-'),
    listInstances: () => [...windows.keys()].map((pid) => ({ pid })),
    callPlugin: async (method, params, opts) => {
      calls.push(['plugin', method, params, opts.pid]);
      if (method === 'status') return { projectPath: windows.get(opts.pid) ?? null };
      if (method === 'project_state') {
        const n = (ready.get(opts.pid) ?? 0) + 1;
        ready.set(opts.pid, n);
        return { project_path: windows.get(opts.pid) ?? null, changed: false, scene_ready: n >= readyAfter };
      }
      if (method === 'project_launch' && params.operation === 'openLocal') windows.set(200, params.path);
      if (method === 'project_launch' && params.operation === 'createNew') windows.set(201, path.join(tmpdir('xs-tmp-'), 'ProjectCreatedTmp', '未命名'));
      if (method === 'project_close') {
        const projectPath = windows.get(opts.pid);
        windows.delete(opts.pid);
        return { closing: true, project_path: projectPath, discarded_changes: !!params.discard_changes };
      }
      return {};
    },
  };
  return { d, windows, calls, setReadyAfter: (n) => (readyAfter = n) };
}

function projectDir() {
  const dir = tmpdir('xs-proj-');
  fs.writeFileSync(path.join(dir, 'effect.dyehpj'), '{}');
  return dir;
}

test('open through an existing window returns the new pid and does not launch the editor', async () => {
  const { d, calls } = world();
  const dir = projectDir();
  const out = await new Projects(d).open({ path: dir });
  assert.equal(out.already_open, false);
  assert.equal(out.pid, 200);
  assert.equal(out.background.focus_policy, 'not_attempted');
  assert.deepEqual(calls.find((call) => call[1] === 'project_launch')[2], { operation: 'openLocal', path: dir });
  assert.equal(calls.some((call) => call[0] === 'spawn' || call[1] === 'open'), false);
});

test('an already open project is returned without launch', async () => {
  const dir = projectDir();
  const { d, calls } = world({ paths: [[150, dir]] });
  const out = await new Projects(d).open({ path: dir });
  assert.equal(out.already_open, true);
  assert.equal(out.pid, 150);
  assert.equal(calls.some((call) => call[1] === 'project_launch'), false);
});

test('no project window is an explicit unsupported cold start and spawns nothing', async () => {
  const { d, calls } = world();
  d.listInstances = () => [];
  const err = await new Projects(d).open({ path: projectDir() }).catch((e) => e);
  assert.match(err.message, /NO_EDITOR_WINDOW/);
  assert.match(err.message, /WINDOWS_COLD_START_UNVERIFIED/);
  assert.equal(calls.some((call) => call[1] === 'project_launch'), false);
});

test('duplicate new refuses a non-empty target before save_project', async () => {
  const { d, calls } = world();
  const busy = tmpdir('xs-busy-');
  fs.writeFileSync(path.join(busy, 'effect.dyehpj'), '{}');
  await assert.rejects(new Projects(d).create({ path: busy }), /TARGET_NOT_EMPTY/);
  assert.equal(calls.some((call) => call[1] === 'save_project'), false);
});

test('project_new saves once through the official tool and does not create the directory itself', async () => {
  const { d, calls, windows } = world();
  const parent = tmpdir('xs-new-');
  const target = path.join(parent, '空白');
  const out = await new Projects(d).create({ path: target });
  assert.equal(out.pid, 201);
  assert.equal(out.project_path, target);
  assert.equal(out.save_calls, 1);
  const saves = calls.filter((call) => call[1] === 'save_project');
  assert.equal(saves.length, 1);
  assert.equal(saves[0][2].path, target);
  assert.equal(windows.get(201), target);
  assert.equal(fs.existsSync(target), false);
});

test('a disconnected official save is not sent again', async () => {
  const { d } = world();
  let saves = 0;
  const original = d.official.callJson;
  d.official.callJson = async (name, args) => {
    if (name === 'save_project') {
      saves += 1;
      throw Object.assign(Error('socket closed'), { ambiguous: true });
    }
    return original(name, args);
  };
  await assert.rejects(new Projects(d).create({ path: path.join(tmpdir('xs-new-'), 'n') }), /not retried/);
  assert.equal(saves, 1);
});

test('close refuses a dirty or unknown project and does not call project_close', async () => {
  const { d, calls, windows } = world();
  const projectPath = windows.get(100);
  d.callPlugin = async (method, params, opts) => {
    calls.push(method);
    if (method === 'status') return { projectPath };
    if (method === 'project_state') return { project_path: projectPath, changed: true, scene_ready: true };
    throw Error(`unexpected ${method}`);
  };
  await assert.rejects(new Projects(d).close({ project_path: projectPath }), /PROJECT_HAS_UNSAVED_CHANGES/);
  d.callPlugin = async (method) => {
    calls.push(method);
    if (method === 'status') return { projectPath };
    if (method === 'project_state') throw Error('state exploded');
    throw Error(`unexpected ${method}`);
  };
  await assert.rejects(new Projects(d).close({ project_path: projectPath }), /UNKNOWN_DIRTY_STATE/);
  d.callPlugin = async (method) => {
    calls.push(method);
    if (method === 'status') return { projectPath };
    if (method === 'project_state') return { project_path: projectPath, changed: null, scene_ready: true };
    throw Error(`unexpected ${method}`);
  };
  await assert.rejects(new Projects(d).close({ project_path: projectPath }), /UNKNOWN_DIRTY_STATE/);
  assert.equal(calls.includes('project_close'), false);
});

test('close stays fail-closed unless the plugin and official project_status both stay clean', async () => {
  const { d, calls, windows } = world();
  const projectPath = windows.get(100);
  const base = d.callPlugin;
  d.projectStatus = { is_changed: false, scene_dirty: false };
  d.callPlugin = async (method, params, opts) => {
    if (method === 'project_state') return { project_path: projectPath, changed: true, scene_ready: true };
    return base(method, params, opts);
  };
  await assert.rejects(new Projects(d).close({ project_path: projectPath, discard_changes: true }), /PROJECT_HAS_UNSAVED_CHANGES/);
  assert.equal(calls.some((call) => call[1] === 'project_close'), false);

  d.projectStatus = { is_changed: true, scene_dirty: false };
  d.callPlugin = async (method, params, opts) => {
    if (method === 'project_state') return { project_path: projectPath, changed: false, scene_ready: true };
    return base(method, params, opts);
  };
  await assert.rejects(new Projects(d).close({ project_path: projectPath }), /official is_changed is true/);

  d.projectStatus = { is_changed: false, scene_dirty: true };
  await assert.rejects(new Projects(d).close({ project_path: projectPath }), /scene_dirty is true/);

  d.projectStatus = { is_changed: false, scene_dirty: null };
  await assert.rejects(new Projects(d).close({ project_path: projectPath }), /scene_dirty is not a boolean/);

  d.projectStatus = { is_changed: 'no', scene_dirty: false };
  await assert.rejects(new Projects(d).close({ project_path: projectPath }), /is_changed is not false/);

  d.projectStatus = { is_changed: false, scene_dirty: false, project_path: path.join(projectPath, 'other') };
  await assert.rejects(new Projects(d).close({ project_path: projectPath }), /OFFICIAL_INSTANCE_UNCONFIRMED/);

  const original = d.official.callJson;
  d.projectStatus = { is_changed: false, scene_dirty: false };
  d.official.callJson = async (name, args) => {
    if (name === 'project_status') throw Error('socket closed');
    return original(name, args);
  };
  await assert.rejects(new Projects(d).close({ project_path: projectPath }), /OFFICIAL_DIRTY_UNCONFIRMED/);
  d.official.callJson = original;

  let reads = 0;
  d.callPlugin = async (method, params, opts) => {
    if (method === 'project_state') {
      reads += 1;
      return { project_path: projectPath, changed: reads === 1 ? false : true, scene_ready: true };
    }
    return base(method, params, opts);
  };
  await assert.rejects(new Projects(d).close({ project_path: projectPath }), /PROJECT_HAS_UNSAVED_CHANGES/);
  assert.equal(calls.some((call) => call[1] === 'project_close'), false);
});

test('close with discard_changes targets one instance and waits until that pid is gone', async () => {
  const { d, windows } = world();
  const projectPath = windows.get(100);
  const out = await new Projects(d).close({ instance_id: '1', discard_changes: true });
  assert.equal(out.closed, true);
  assert.equal(out.pid, 100);
  assert.equal(windows.has(100), false);
  await assert.rejects(new Projects(d).close({ project_path: projectPath, instance_id: '1' }), /UNKNOWN_INSTANCE|NO_UNIQUE_WINDOW|AMBIGUOUS_INSTANCE/);
});

test('two windows require an explicit target and a denied path is refused', async () => {
  const left = projectDir();
  const right = projectDir();
  const { d, calls } = world({ paths: [[1, left], [2, right]] });
  await assert.rejects(new Projects(d).close({}), /AMBIGUOUS_INSTANCE/);
  d.deny = [left];
  await assert.rejects(new Projects(d).close({ project_path: left, discard_changes: true }), /PROTECTED_PROJECT/);
  assert.equal(calls.some((call) => call[1] === 'project_close'), false);
});

test('lifecycle calls for one window do not overlap, and two windows may', async () => {
  const a = projectDir();
  const b = projectDir();
  const { d } = world({ paths: [[1, a], [2, b]] });
  let current = 0;
  let max = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const original = d.callPlugin;
  d.callPlugin = async (method, params, opts) => {
    if (method === 'project_close') {
      current += 1;
      max = Math.max(max, current);
      await gate;
      current -= 1;
    }
    return original(method, params, opts);
  };
  const projects = new Projects(d);
  const first = projects.close({ project_path: a, discard_changes: true });
  const second = projects.close({ project_path: a, discard_changes: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(max, 1);
  release();
  await Promise.allSettled([first, second]);

  current = 0;
  max = 0;
  let release2;
  const gate2 = new Promise((resolve) => {
    release2 = resolve;
  });
  const { d: both } = world({ paths: [[1, a], [2, b]] });
  const inner = both.callPlugin;
  both.callPlugin = async (method, params, opts) => {
    if (method === 'project_close') {
      current += 1;
      max = Math.max(max, current);
      await gate2;
      current -= 1;
    }
    return inner(method, params, opts);
  };
  const again = new Projects(both);
  const left = again.close({ project_path: a, discard_changes: true });
  const right = again.close({ project_path: b, discard_changes: true });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(max, 2);
  release2();
  await Promise.allSettled([left, right]);
});

test('windows unicode paths with different slashes and case select the same window', async () => {
  const shown = 'e:/工作/特效/probe';
  const { d, calls } = world({ paths: [[7, shown]] });
  d.platform = 'win32';
  d.allow = ['E:\\工作'];
  d.existsSync = (file) => file.replace(/\//g, '\\').toLowerCase() === 'e:\\工作\\特效\\probe\\effect.dyehpj';
  const out = await new Projects(d).open({ path: 'E:\\工作\\特效\\Probe' });
  assert.equal(out.already_open, true);
  assert.equal(out.pid, 7);
  assert.equal(calls.some((call) => call[1] === 'project_launch'), false);
});

test('a temp window that was already registered is not the result of this project_new', async () => {
  const { d, calls, windows } = world();
  const oldTemp = path.join(tmpdir('xs-old-'), 'ProjectCreatedTmp', 'old');
  const freshTemp = path.join(tmpdir('xs-new-'), 'ProjectCreatedTmp', 'fresh');
  let oldVisible = false;
  const baseList = d.listInstances;
  d.listInstances = () => [...baseList(), { pid: 50 }];
  const baseCall = d.callPlugin;
  d.callPlugin = async (method, params, opts) => {
    if (opts.pid === 50) {
      if (!oldVisible) throw Error('status timeout');
      return { projectPath: oldTemp, project_path: oldTemp, changed: false, scene_ready: true };
    }
    if (method === 'project_launch' && params.operation === 'createNew') {
      oldVisible = true;
      windows.set(201, freshTemp);
      return {};
    }
    return baseCall(method, params, opts);
  };
  const probe = path.join(tmpdir('xs-probe-'), '空白');
  const out = await new Projects(d).create({ path: probe });
  const save = calls.find((call) => call[1] === 'save_project');
  assert.equal(out.pid, 201);
  assert.equal(save[2].instance_id, '2');
  assert.notEqual(save[2].instance_id, '50');
});

test('two new temporary windows at once are not saved', async () => {
  const { d, calls, windows } = world();
  const baseCall = d.callPlugin;
  d.callPlugin = async (method, params, opts) => {
    if (method === 'project_launch' && params.operation === 'createNew') {
      windows.set(201, path.join(tmpdir('xs-a-'), 'ProjectCreatedTmp', 'a'));
      windows.set(202, path.join(tmpdir('xs-b-'), 'ProjectCreatedTmp', 'b'));
      return {};
    }
    return baseCall(method, params, opts);
  };
  await assert.rejects(new Projects(d).create({ path: path.join(tmpdir('xs-probe-'), 'n') }), /AMBIGUOUS_NEW_WINDOW/);
  assert.equal(calls.some((call) => call[1] === 'save_project'), false);
});

test('close refuses when the official list has no matching instance', async () => {
  const { d, calls, windows } = world();
  const projectPath = windows.get(100);
  const original = d.official.callJson;
  d.official.callJson = async (name, args) => {
    if (name === 'list_instances') return { instances: [] };
    return original(name, args);
  };
  await assert.rejects(new Projects(d).close({ project_path: projectPath, discard_changes: true }), /OFFICIAL_INSTANCE_UNCONFIRMED/);
  assert.equal(calls.some((call) => call[1] === 'project_close'), false);
});

test('close refuses a window whose path cannot be read', async () => {
  const protectedDir = path.join(tmpdir('xs-keep-'), 'keep');
  const { d, calls } = world({ paths: [[5, null]] });
  d.deny = [protectedDir];
  await assert.rejects(new Projects(d).close({}), /PROJECT_PATH_UNREADABLE/);
  assert.equal(calls.some((call) => call[1] === 'project_close'), false);
});

test('project_new does not save when the official instance still points at another project', async () => {
  const { d, calls, windows } = world();
  const launcher = windows.get(100);
  const protectedDir = path.join(tmpdir('xs-keep-'), 'keep');
  const probe = path.join(tmpdir('xs-probe-'), '空白');
  d.allow = [path.dirname(launcher), path.dirname(probe)];
  d.deny = [protectedDir];
  const original = d.official.callJson;
  d.official.callJson = async (name, args) => {
    if (name === 'list_instances') {
      return {
        instances: [
          { instance_id: 'host', generation: '100-abc', project_path: launcher },
          { instance_id: 'keep', generation: '201-abc', project_path: protectedDir },
        ],
      };
    }
    return original(name, args);
  };
  await assert.rejects(new Projects(d).create({ path: probe }), /STALE_OFFICIAL_INSTANCE/);
  assert.equal(calls.some((call) => call[1] === 'save_project'), false);
});

test('a project outside the allowlist is not created or saved', async () => {
  const { d, calls, windows } = world();
  d.allow = [path.dirname(windows.get(100))];
  const probe = path.join(tmpdir('xs-out-'), 'n');
  await assert.rejects(new Projects(d).create({ path: probe }), /PROJECT_NOT_ALLOWLISTED/);
  assert.equal(calls.some((call) => call[1] === 'save_project'), false);
});

test('two project_new calls for one empty directory save only once', async () => {
  const { d, windows } = world();
  const parent = tmpdir('xs-race-');
  const target = path.join(parent, 'same');
  d.allow = [os.tmpdir()];
  let saves = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const original = d.official.callJson;
  d.official.callJson = async (name, args) => {
    if (name === 'save_project') {
      saves += 1;
      fs.mkdirSync(args.path, { recursive: true });
      fs.writeFileSync(path.join(args.path, 'effect.dyehpj'), '{}');
      if (saves === 1) await gate;
    }
    return original(name, args);
  };
  const projects = new Projects(d);
  const first = projects.create({ path: target });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const second = projects.create({ path: target });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(saves, 1);
  release();
  const results = await Promise.allSettled([first, second]);
  assert.equal(saves, 1);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.match(results.find((result) => result.status === 'rejected').reason.message, /TARGET_NOT_EMPTY/);
  assert.equal(windows.get(100), windows.get(100));
});

test('generation prefixes are pids and a second window is refused at the cap', async () => {
  const { d } = world({ paths: [[11, projectDir()], [12, projectDir()]] });
  const projects = new Projects(d);
  const instances = await projects.officialInstances();
  assert.deepEqual(instances.map((item) => item.pid), [11, 12]);
  await assert.rejects(projects.open({ path: projectDir() }), /WINDOW_LIMIT/);
});

function openPolicy() {
  const { d, calls, windows } = world();
  delete d.allow;
  d.env = {};
  d.localConfig = {};
  return { d, calls, windows };
}

test('an ordinary project is usable when no allowlist is configured', async () => {
  const { d, calls } = openPolicy();
  const dir = projectDir();
  const out = await new Projects(d).open({ path: dir });
  assert.equal(out.pid, 200);
  assert.equal(calls.some((call) => call[1] === 'project_launch'), true);
});

test('a deny list blocks a path that would otherwise be allowed', async () => {
  const { d, calls } = openPolicy();
  const dir = projectDir();
  d.localConfig = { denyProjects: [dir] };
  await assert.rejects(new Projects(d).open({ path: dir }), /PROTECTED_PROJECT/);
  assert.equal(calls.some((call) => call[1] === 'project_launch'), false);
  d.localConfig = { allowProjects: [path.dirname(dir)], denyProjects: [dir] };
  await assert.rejects(new Projects(d).open({ path: dir }), /PROTECTED_PROJECT/);
});

test('an existing allowProjects list still narrows, and a missing key does not', () => {
  const kept = projectPolicy({ env: {}, localConfig: { allowProjects: ['D:\\work'], denyProjects: ['D:\\work\\secret'] } });
  assert.deepEqual(kept.allow, ['D:\\work']);
  assert.deepEqual(kept.deny, ['D:\\work\\secret']);
  const onlyDeny = projectPolicy({ env: {}, localConfig: { denyProjects: ['D:\\keep'] } });
  assert.equal(onlyDeny.allow, null);
  assert.deepEqual(onlyDeny.deny, ['D:\\keep']);
  const unset = projectPolicy({ env: {}, localConfig: {} });
  assert.equal(unset.allow, null);
  assert.deepEqual(unset.deny, []);
  const explicitEmpty = projectPolicy({ env: { XIANGSU_ALLOW_PROJECTS: '' }, localConfig: {} });
  assert.deepEqual(explicitEmpty.allow, []);
  assert.throws(() => projectPolicy({ env: {}, localConfig: { allowProjects: 'D:\\work' } }), /CONFIG_INVALID/);
});

test('windows path matching still applies to the optional allowlist and the deny list', () => {
  const projects = new Projects({ platform: 'win32', env: {}, localConfig: { denyProjects: ['D:\\Keep'] }, realpathSync: (p) => p });
  assert.equal(projects.assertMutable('d:/other/project'), 'd:\\other\\project');
  assert.throws(() => projects.assertMutable('D:/keep/child'), /PROTECTED_PROJECT/);
  const narrowed = new Projects({
    platform: 'win32',
    env: {},
    localConfig: { allowProjects: ['D:\\Work'] },
    realpathSync: (p) => p,
  });
  assert.equal(narrowed.assertMutable('d:/work/project'), 'd:\\work\\project');
  assert.throws(() => narrowed.assertMutable('D:\\elsewhere'), /PROJECT_NOT_ALLOWLISTED/);
});
