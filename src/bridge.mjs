// Client side of the editor plugin RPC. Instance files live under the state directory.
// A record is live only when that pid still belongs to a process that started no later
// than the plugin wrote the record (plus a small clock skew).
// Adapted from Muqian-Sun/xiangsu-mcp-plus src/bridge.mjs (MIT, Copyright (c) 2026 muqian).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { longFetch } from './longfetch.mjs';
import { normalizePath, samePath } from './paths.mjs';
import { processStartTimes, recordMatchesProcess } from './procinfo.mjs';
import { redact } from './redact.mjs';
import { defaultStateRoot, stateRootOf } from './plugininstall.mjs';

export function instanceDir(env = process.env) {
  return path.join(stateRootOf(env), 'instances');
}

// The editor process does not inherit XIANGSU_MCP_PLUS_STATE, so the plugin writes
// the default home directory. A stdio process with a different state root still
// has to see that directory. Two live records for one pid are not merged.
export function instanceDirs(env = process.env, homedir = os.homedir) {
  const configured = path.join(stateRootOf(env), 'instances');
  const fallback = path.join(defaultStateRoot(homedir), 'instances');
  if (path.resolve(configured) === path.resolve(fallback)) return [configured];
  return [configured, fallback];
}

export const bridgeTiming = { statusMs: 5000 };
const lastSeen = new Map();

function readInstanceDir(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  return names.filter((n) => /^\d+\.json$/.test(n)).map((n) => JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8')));
}

function sameIdentity(a, b) {
  return a.port === b.port && a.token === b.token;
}

export function listInstances({ dir, dirs, env = process.env, homedir = os.homedir, startTimes = processStartTimes, platform = process.platform } = {}) {
  const roots = dirs ?? (dir ? [dir] : instanceDirs(env, homedir));
  const grouped = new Map();
  for (const root of roots) {
    for (const record of readInstanceDir(root)) {
      const pid = Number(record.pid);
      if (!grouped.has(pid)) grouped.set(pid, []);
      grouped.get(pid).push(record);
    }
  }
  if (!grouped.size) return [];
  const started = startTimes([...grouped.keys()], { platform });
  const live = [];
  for (const [pid, records] of grouped) {
    const matched = records.filter((record) => recordMatchesProcess(started.get(pid), record.startedAt));
    if (!matched.length) continue;
    const identity = matched[0];
    if (matched.some((record) => !sameIdentity(record, identity))) {
      throw Error(`AMBIGUOUS_INSTANCE_STATE: pid ${pid} has conflicting live records; refusing to choose a token`);
    }
    live.push(matched[0]);
  }
  return live;
}

async function post(instance, method, params, timeoutMs) {
  const res = await longFetch(`http://127.0.0.1:${instance.port}/rpc`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${instance.token}` },
    body: JSON.stringify({ method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await res.json();
  if (!body.ok) throw Error(redact(`PLUGIN_ERROR(${method}): ${body.error}`));
  return body.value;
}

async function projectOf(instance) {
  const st = await post(instance, 'status', {}, bridgeTiming.statusMs);
  return st.projectPath || null;
}

export async function resolveInstance({ pid, projectPath, platform = process.platform, ...listOpts } = {}) {
  const live = listInstances({ platform, ...listOpts });
  if (pid) {
    const hit = live.find((s) => s.pid === pid);
    if (!hit) throw Error(`NO_PLUGIN_INSTANCE: pid ${pid}`);
    return hit;
  }
  if (!projectPath) {
    if (live.length === 1) return live[0];
    throw Error(`AMBIGUOUS_INSTANCE: ${live.length} plugin instances; pass project_path`);
  }
  const known = live.find((s) => s.pid === lastSeen.get(normalizeKey(projectPath, platform)));
  if (known) {
    const shown = await projectOf(known).catch(() => null);
    if (shown && samePath(shown, projectPath, { platform })) return known;
  }
  const answers = await Promise.allSettled(live.map((s) => projectOf(s)));
  const matches = live.filter((s, i) => answers[i].status === 'fulfilled' && answers[i].value && samePath(answers[i].value, projectPath, { platform }));
  if (matches.length === 1) {
    lastSeen.set(normalizeKey(projectPath, platform), matches[0].pid);
    return matches[0];
  }
  const silent = live.flatMap((s, i) => (answers[i].status === 'rejected' ? [`${s.pid} (${redact(answers[i].reason.message)})`] : []));
  throw Error(`NO_UNIQUE_PLUGIN_INSTANCE for ${projectPath}: ${matches.length} matches${silent.length ? `; windows that did not answer: ${silent.join(', ')}` : ''}`);
}

function normalizeKey(projectPath, platform) {
  try {
    const normalized = normalizePath(projectPath, { platform });
    return platform === 'win32' ? normalized.toLowerCase() : normalized;
  } catch {
    return projectPath;
  }
}

export async function callPlugin(method, params = {}, { pid, projectPath, timeoutMs = 120000, platform = process.platform, ...listOpts } = {}) {
  const instance = await resolveInstance({ pid, projectPath, platform, ...listOpts });
  return post(instance, method, params, timeoutMs);
}
