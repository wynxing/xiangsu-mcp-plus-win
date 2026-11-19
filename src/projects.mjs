// Open, create and close project windows through an already-open editor window.
// There is no verified Windows command that opens a .dyehpj without a project window,
// so that case is refused instead of launching Douyin AR.exe.
// Focus stealing, minimize, and keyboard/mouse input are not used.
//
// Lifecycle contracts adapted from Muqian-Sun/xiangsu-mcp-plus src/projects.mjs
// (MIT, Copyright (c) 2026 muqian): official save_project for the first save,
// generation pid prefix, WINDOW_LIMIT retry, unsaved-change refusal.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { KeyedMutex } from './mutex.mjs';
import { normalizePath, pathApi, pathInside, samePath } from './paths.mjs';
import { stateRootOf } from './plugininstall.mjs';
import { claimTarget, releaseTarget } from './target-lock.mjs';

export const MAX_WINDOWS = 2;
export const COLD_START = Object.freeze({
  supported: false,
  code: 'WINDOWS_COLD_START_UNVERIFIED',
  detail:
    'No verified Windows invocation opens a .dyehpj without an existing project window. This build does not start Douyin AR.exe. Open any project window (the plugin loads only in windows opened after install) and retry.',
});

const isTempProject = (projectPath) => typeof projectPath === 'string' && projectPath.replace(/\\/g, '/').includes('/ProjectCreatedTmp/');
const DIRTY_REREAD_MS = 300;

export function pidFromGeneration(generation) {
  const match = /^(\d+)-/.exec(String(generation ?? ''));
  return match ? Number(match[1]) : null;
}

export async function waitFor(fn, { timeoutMs, intervalMs = 1000, sleep }) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() >= end) return null;
    await sleep(intervalMs);
  }
}

function splitList(raw) {
  return String(raw ?? '').split('|').map((item) => item.trim()).filter(Boolean);
}

function loadLocalConfig(file = fileURLToPath(new URL('../config.local.json', import.meta.url))) {
  if (!fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw Error('not an object');
    return parsed;
  } catch (e) {
    throw Error(`CONFIG_INVALID: ${file} (${e.message})`);
  }
}

export function projectPolicy(d = {}) {
  if (d.allow || d.deny) return { allow: d.allow ?? [], deny: d.deny ?? [] };
  const env = d.env ?? process.env;
  const file = d.localConfig ?? loadLocalConfig();
  return {
    allow: [...splitList(env.XIANGSU_ALLOW_PROJECTS), ...(file.allowProjects ?? [])],
    deny: [...splitList(env.XIANGSU_DENY_PROJECTS), ...(file.denyProjects ?? [])],
  };
}

export class Projects {
  constructor(d) {
    this.d = d;
    this.locks = d.locks ?? new KeyedMutex();
    this.platform = d.platform ?? process.platform;
  }

  normalize(input) {
    return normalizePath(input, { platform: this.platform, realpathSync: this.d.realpathSync });
  }

  same(a, b) {
    return samePath(a, b, { platform: this.platform, realpathSync: this.d.realpathSync });
  }

  targetKey(abs) {
    return `target:${this.platform === 'win32' ? abs.toLowerCase() : abs}`;
  }

  assertMutable(target) {
    if (!target) throw Error('PROJECT_PATH_UNREADABLE: refusing a lifecycle change whose project path cannot be read');
    const abs = this.normalize(target);
    const { allow, deny } = projectPolicy(this.d);
    for (const denied of deny) {
      if (pathInside(abs, denied, { platform: this.platform, realpathSync: this.d.realpathSync })) throw Error(`PROTECTED_PROJECT: ${abs}`);
    }
    const listed = allow.some((root) => pathInside(abs, root, { platform: this.platform, realpathSync: this.d.realpathSync }));
    if (!listed) throw Error(`PROJECT_NOT_ALLOWLISTED: ${abs}`);
    return abs;
  }

  assertNotDenied(target) {
    if (!target) throw Error('PROJECT_PATH_UNREADABLE: refusing a lifecycle change whose project path cannot be read');
    const abs = this.normalize(target);
    const { deny } = projectPolicy(this.d);
    for (const denied of deny) {
      if (pathInside(abs, denied, { platform: this.platform, realpathSync: this.d.realpathSync })) throw Error(`PROTECTED_PROJECT: ${abs}`);
    }
    return abs;
  }

  assertTargetEmpty(abs) {
    const exists = this.d.existsSync ?? fs.existsSync;
    if (!exists(abs)) return;
    const stat = (this.d.statSync ?? fs.statSync)(abs);
    const entries = stat.isDirectory() ? (this.d.readdirSync ?? fs.readdirSync)(abs) : ['file'];
    if (!stat.isDirectory() || entries.length) throw Error(`TARGET_NOT_EMPTY: ${abs}`);
  }

  async windows() {
    let records;
    try {
      records = this.d.listInstances();
    } catch (e) {
      throw Error(`WINDOW_LIST_FAILED: ${e.message}`);
    }
    const rows = [];
    for (const record of records) {
      try {
        const st = await this.d.callPlugin('status', {}, { pid: record.pid, timeoutMs: 5000 });
        rows.push({ pid: record.pid, project_path: st.projectPath || null });
      } catch {
        // A hung window is omitted here; resolveInstance reports it when a path lookup needs it.
      }
    }
    return rows;
  }

  async officialInstances() {
    const { instances = [] } = await this.d.official.callJson('list_instances', {});
    return instances.map((instance) => ({ ...instance, pid: pidFromGeneration(instance.generation) }));
  }

  async launch(pid, params) {
    const end = Date.now() + this.d.launchRetryMs;
    for (;;) {
      try {
        return await this.d.callPlugin('project_launch', params, { pid });
      } catch (e) {
        if (!String(e.message).includes('WINDOW_LIMIT')) throw e;
        if (Date.now() >= end) throw e;
        await this.d.sleep(1000);
      }
    }
  }

  async instanceIdForPid(pid, timeoutMs = 0) {
    const hit = await waitFor(async () => (await this.officialInstances().catch(() => [])).find((i) => i.pid === pid), {
      timeoutMs,
      sleep: this.d.sleep,
    });
    return hit ? hit.instance_id : null;
  }

  async resolveProjectPath({ project_path, instance_id }) {
    if (instance_id === undefined || instance_id === null) return project_path ? this.normalize(project_path) : undefined;
    const hit = (await this.officialInstances()).find((i) => String(i.instance_id) === String(instance_id));
    if (!hit) throw Error(`UNKNOWN_INSTANCE: ${instance_id}`);
    if (project_path && !this.same(project_path, hit.project_path)) throw Error(`INSTANCE_PROJECT_MISMATCH: instance ${instance_id} has ${hit.project_path}`);
    return hit.project_path;
  }

  async waitReady(pid) {
    const ok = await waitFor(
      async () => {
        try {
          return (await this.d.callPlugin('project_state', {}, { pid, timeoutMs: 5000 })).scene_ready;
        } catch {
          return false;
        }
      },
      { timeoutMs: this.d.openTimeoutMs, sleep: this.d.sleep },
    );
    if (!ok) throw Error(`SCENE_NOT_READY: window ${pid} did not finish loading its scene`);
  }

  async open({ path: target }) {
    const abs = this.normalize(target);
    this.assertMutable(abs);
    const file = pathApi(this.platform).join(abs, 'effect.dyehpj');
    const exists = this.d.existsSync ?? fs.existsSync;
    if (!exists(file)) throw Error(`NOT_A_PROJECT: ${abs} has no effect.dyehpj`);
    const windows = await this.windows();
    const already = windows.find((w) => w.project_path && this.same(w.project_path, abs));
    if (already) {
      return {
        already_open: true,
        pid: already.pid,
        project_path: already.project_path,
        instance_id: await this.instanceIdForPid(already.pid, this.d.instanceTimeoutMs),
      };
    }
    if (!windows.length) throw Error(`NO_EDITOR_WINDOW: ${COLD_START.detail} (${COLD_START.code})`);
    if (windows.length >= MAX_WINDOWS) {
      throw Error(`WINDOW_LIMIT: all ${MAX_WINDOWS} project windows are in use; project_close one before opening another`);
    }
    if (!windows[0].project_path) throw Error('LAUNCHER_PATH_UNREADABLE: refusing to open from a window whose project path cannot be read');
    this.assertMutable(windows[0].project_path);
    return this.locks.run(windows[0].pid, () => this.openLocked(abs, windows[0].pid));
  }

  async openLocked(abs, pid) {
    const windows = await this.windows();
    const already = windows.find((w) => w.project_path && this.same(w.project_path, abs));
    if (already) {
      return {
        already_open: true,
        pid: already.pid,
        project_path: already.project_path,
        instance_id: await this.instanceIdForPid(already.pid, this.d.instanceTimeoutMs),
      };
    }
    if (windows.length >= MAX_WINDOWS) throw Error(`WINDOW_LIMIT: all ${MAX_WINDOWS} project windows are in use; project_close one before opening another`);
    await this.launch(pid, { operation: 'openLocal', path: abs });
    const found = await waitFor(async () => (await this.windows()).find((w) => w.project_path && this.same(w.project_path, abs)), {
      timeoutMs: this.d.openTimeoutMs,
      sleep: this.d.sleep,
    });
    if (!found) throw Error(`OPEN_TIMEOUT: ${abs} did not finish opening; the editor may be showing a dialog that needs a click`);
    await this.waitReady(found.pid);
    return {
      already_open: false,
      pid: found.pid,
      project_path: found.project_path,
      instance_id: await this.instanceIdForPid(found.pid, this.d.instanceTimeoutMs),
      background: { minimized: null, focus_policy: 'not_attempted', cold_start: false },
    };
  }

  async create({ path: target }) {
    const abs = this.normalize(target);
    this.assertMutable(abs);
    const claim = claimTarget(abs, { stateRoot: this.d.stateRoot || stateRootOf(this.d.env), isPidAlive: this.d.isPidAlive });
    try {
      return await this.locks.run(this.targetKey(abs), () => this.createHoldingTarget(abs));
    } finally {
      releaseTarget(claim);
    }
  }

  async createHoldingTarget(abs) {
    this.assertTargetEmpty(abs);
    const windows = await this.windows();
    if (!windows.length) throw Error(`NO_EDITOR_WINDOW: ${COLD_START.detail} (${COLD_START.code})`);
    if (windows.length >= MAX_WINDOWS) throw Error(`WINDOW_LIMIT: all ${MAX_WINDOWS} project windows are in use; project_close one first`);
    const launcher = windows[0];
    if (!launcher.project_path) throw Error('LAUNCHER_PATH_UNREADABLE: refusing to create from a window whose project path cannot be read');
    this.assertMutable(launcher.project_path);
    return this.locks.run(launcher.pid, () => this.createLocked(abs, launcher.pid, launcher.project_path));
  }

  async createLocked(abs, pid, launcherPath) {
    const windows = await this.windows();
    if (windows.length >= MAX_WINDOWS) throw Error(`WINDOW_LIMIT: all ${MAX_WINDOWS} project windows are in use; project_close one first`);
    const beforePids = new Set(this.d.listInstances().map((record) => record.pid));
    const launched = await this.launch(pid, { operation: 'createNew' });
    const wantedPid = Number(launched?.created_pid);
    const created = await waitFor(
      async () => {
        const fresh = (await this.windows()).filter((w) => isTempProject(w.project_path) && !beforePids.has(w.pid));
        if (Number.isInteger(wantedPid) && wantedPid > 0) {
          if (beforePids.has(wantedPid)) return { ambiguous: true };
          const hit = fresh.filter((w) => w.pid === wantedPid);
          if (hit.length === 1) return hit[0];
          if (fresh.length > 1) return { ambiguous: true };
          return null;
        }
        if (fresh.length > 1) return { ambiguous: true };
        return fresh.length === 1 ? fresh[0] : null;
      },
      { timeoutMs: this.d.openTimeoutMs, sleep: this.d.sleep },
    );
    if (!created) throw Error('NEW_PROJECT_TIMEOUT: no new project window appeared; save_project was not called');
    if (created.ambiguous) throw Error('AMBIGUOUS_NEW_WINDOW: more than one new temporary project appeared; save_project was not called');
    await this.waitReady(created.pid);
    const official = (await this.officialInstances()).find((instance) => instance.pid === created.pid);
    if (!official?.project_path || !this.same(official.project_path, created.project_path)) {
      throw Error(`STALE_OFFICIAL_INSTANCE: official path ${official?.project_path ?? 'missing'} does not match plugin path ${created.project_path}; save_project was not called`);
    }
    this.assertNotDenied(official.project_path);
    this.assertNotDenied(created.project_path);
    const launcherNow = (await this.windows()).find((w) => w.pid === pid);
    if (!launcherNow?.project_path || !this.same(launcherNow.project_path, launcherPath)) {
      throw Error('LAUNCHER_PROJECT_CHANGED: the window used to create the project no longer shows its original project; save_project was not called');
    }
    this.assertMutable(abs);
    this.assertTargetEmpty(abs);
    const instance_id = official.instance_id;
    let saved;
    try {
      saved = await this.d.official.callJson('save_project', { instance_id, path: abs, intention: '新建工程首次保存' });
    } catch (e) {
      throw Error(`SAVE_FAILED: ${e.message}; save_project was not retried because a mutating official call may already have completed`);
    }
    if (saved.save_status !== 'succeeded') throw Error(`SAVE_FAILED: ${JSON.stringify(saved)}; save_project was not retried`);
    const moved = await waitFor(async () => (await this.windows()).find((w) => w.pid === created.pid && this.same(w.project_path, abs)), {
      timeoutMs: this.d.saveTimeoutMs,
      sleep: this.d.sleep,
    });
    if (!moved) throw Error(`SAVE_NOT_APPLIED: window ${created.pid} still shows ${created.project_path}`);
    return {
      pid: created.pid,
      instance_id,
      project_path: abs,
      save_calls: 1,
      background: { minimized: null, focus_policy: 'not_attempted', cold_start: false },
    };
  }

  async close(args) {
    const projectPath = await this.resolveProjectPath(args);
    const windows = await this.windows();
    const hits = projectPath ? windows.filter((w) => w.project_path && this.same(w.project_path, projectPath)) : windows;
    if (hits.length !== 1) {
      throw Error(projectPath ? `NO_UNIQUE_WINDOW for ${projectPath}: ${hits.length} matches` : `AMBIGUOUS_INSTANCE: ${windows.length} windows; pass project_path or instance_id`);
    }
    const hit = hits[0];
    let instances;
    try {
      instances = await this.officialInstances();
    } catch (e) {
      throw Error(`OFFICIAL_PATH_UNCONFIRMED: ${e.message}; refusing to close`);
    }
    const official = instances.find((instance) => instance.pid === hit.pid);
    if (!hit.project_path) {
      throw Error(`PROJECT_PATH_UNREADABLE: refusing to close pid ${hit.pid}; plugin path is missing`);
    }
    if (!official?.project_path || !this.same(hit.project_path, official.project_path)) {
      throw Error(`OFFICIAL_INSTANCE_UNCONFIRMED: refusing to close pid ${hit.pid}; plugin path ${hit.project_path}, official path ${official?.project_path ?? 'missing'}`);
    }
    if (official?.project_path) this.assertMutable(official.project_path);
    this.assertMutable(hit.project_path);
    return this.locks.run(hit.pid, () => this.closeLocked(hit, args));
  }

  async pluginDirtyState(hit) {
    let state;
    try {
      state = await this.d.callPlugin('project_state', {}, { pid: hit.pid, timeoutMs: 5000 });
    } catch (e) {
      throw Error(`UNKNOWN_DIRTY_STATE: cannot read unsaved state for pid ${hit.pid} (${e.message}); refusing to close`);
    }
    if (!state?.project_path || !this.same(state.project_path, hit.project_path)) {
      throw Error(`PROJECT_PATH_UNREADABLE: project_state path ${state?.project_path ?? 'missing'} does not match ${hit.project_path}; refusing to close`);
    }
    if (state.changed !== false) {
      if (state.changed === true) throw Error(`PROJECT_HAS_UNSAVED_CHANGES: ${state.project_path}; refusing to close`);
      throw Error(`UNKNOWN_DIRTY_STATE: unsaved state for pid ${hit.pid} is not true or false; refusing to close`);
    }
    return state;
  }

  async officialDirtyState(hit) {
    let instances;
    try {
      instances = await this.officialInstances();
    } catch (e) {
      throw Error(`OFFICIAL_DIRTY_UNCONFIRMED: ${e.message}; refusing to close`);
    }
    const official = instances.find((instance) => instance.pid === hit.pid);
    if (!official?.project_path || !this.same(official.project_path, hit.project_path) || official.instance_id == null) {
      throw Error(`OFFICIAL_INSTANCE_UNCONFIRMED: refusing to close pid ${hit.pid}; plugin path ${hit.project_path}, official path ${official?.project_path ?? 'missing'}`);
    }
    let status;
    try {
      status = await this.d.official.callJson('project_status', { instance_id: official.instance_id });
    } catch (e) {
      throw Error(`OFFICIAL_DIRTY_UNCONFIRMED: ${e.message}; refusing to close`);
    }
    if (!status || typeof status !== 'object') throw Error('OFFICIAL_DIRTY_UNCONFIRMED: project_status was not an object; refusing to close');
    const reported = status.project_path ?? status.path;
    if (!reported || !this.same(reported, hit.project_path)) {
      throw Error(`OFFICIAL_INSTANCE_UNCONFIRMED: project_status path ${reported ?? 'missing'} does not match ${hit.project_path}; refusing to close`);
    }
    if (status.generation != null && pidFromGeneration(status.generation) !== hit.pid) {
      throw Error(`OFFICIAL_INSTANCE_UNCONFIRMED: project_status generation does not match pid ${hit.pid}; refusing to close`);
    }
    if (status.pid != null && Number(status.pid) !== hit.pid) {
      throw Error(`OFFICIAL_INSTANCE_UNCONFIRMED: project_status pid does not match ${hit.pid}; refusing to close`);
    }
    if (status.is_changed !== false) {
      if (status.is_changed === true) throw Error(`PROJECT_HAS_UNSAVED_CHANGES: official is_changed is true for ${hit.project_path}; refusing to close`);
      throw Error(`OFFICIAL_DIRTY_UNCONFIRMED: official is_changed is not false; refusing to close`);
    }
    if (status.scene_dirty === true) throw Error(`PROJECT_HAS_UNSAVED_CHANGES: official scene_dirty is true for ${hit.project_path}; refusing to close`);
    if (status.scene_dirty !== false) throw Error(`OFFICIAL_DIRTY_UNCONFIRMED: official scene_dirty is not a boolean; refusing to close`);
    return status;
  }

  async closeLocked(hit, args) {
    const state = await this.pluginDirtyState(hit);
    await this.officialDirtyState(hit);
    await this.d.sleep(DIRTY_REREAD_MS);
    const again = await this.pluginDirtyState(hit);
    if (!this.same(again.project_path, state.project_path)) {
      throw Error(`PROJECT_PATH_UNREADABLE: project path changed from ${state.project_path} to ${again.project_path}; refusing to close`);
    }
    await this.officialDirtyState(hit);
    const res = await this.d.callPlugin('project_close', { discard_changes: !!args.discard_changes }, { pid: hit.pid });
    const gone = await waitFor(() => !this.d.listInstances().some((s) => s.pid === hit.pid), {
      timeoutMs: this.d.closeTimeoutMs,
      sleep: this.d.sleep,
    });
    if (!gone) throw Error(`CLOSE_TIMEOUT: window ${hit.pid} is still running`);
    return { closed: true, pid: hit.pid, project_path: res.project_path, discarded_changes: res.discarded_changes };
  }
}
