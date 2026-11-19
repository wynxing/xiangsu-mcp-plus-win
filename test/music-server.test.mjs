import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { dispatchTool, listToolDefs } from '../src/server.mjs';

function absolute(name) {
  return path.join(os.tmpdir(), name);
}

function session(paths, extras = {}) {
  const windows = new Map(paths);
  const calls = [];
  let statusReads = 0;
  const tools = extras.officialTools ?? [];
  const d = {
    official: {
      tools,
      listTools: async () => tools,
      status: async () => ({ connected: true, tool_count: tools.length }),
      callJson: async (name) => {
        calls.push(['official', name]);
        if (name !== 'list_instances') throw Error(`unexpected official ${name}`);
        if (extras.officialError) throw Error(extras.officialError);
        return {
          instances: [...windows].map(([pid, projectPath], index) => ({
            instance_id: String(index + 1),
            generation: `${pid}-abc`,
            project_path: extras.officialPaths?.get(pid) ?? projectPath,
          })),
        };
      },
    },
    pluginInstall: { action: 'kept' },
    allow: extras.allow ?? [os.tmpdir()],
    deny: extras.deny ?? [],
    sleep: async () => {},
    openTimeoutMs: 20,
    closeTimeoutMs: 20,
    launchRetryMs: 20,
    instanceTimeoutMs: 0,
    saveTimeoutMs: 20,
    platform: process.platform,
    listInstances: () => [...windows.keys()].map((pid) => ({ pid })),
    callPlugin: async (method, params, opts) => {
      calls.push(['plugin', method, params, opts && opts.pid]);
      if (method === 'status') {
        statusReads += 1;
        const queued = extras.statusPaths?.get(opts.pid);
        const projectPath = queued ? queued[Math.min(statusReads - 1, queued.length - 1)] : windows.get(opts.pid) ?? null;
        return { projectPath };
      }
      if (method === 'music_apply' && extras.applyError) throw Error(extras.applyError);
      return extras.pluginResult ?? { method };
    },
  };
  return { d, calls };
}

test('music tools are registered once and a same-named official tool stays shadowed', async () => {
  const { d } = session([], {
    officialTools: [
      { name: 'music_search', description: 'official duplicate', inputSchema: { type: 'object' } },
      { name: 'get_scene', description: 'read scene', inputSchema: { type: 'object' } },
    ],
  });
  const listed = await listToolDefs(d);
  const names = listed.map((tool) => tool.name);
  for (const name of ['music_categories', 'music_list', 'music_search', 'music_apply', 'music_verify']) {
    assert.equal(names.filter((item) => item === name).length, 1);
  }
  assert.equal(names.includes('icon_set'), true);
  assert.equal(names.includes('get_scene'), true);
  const search = listed.find((tool) => tool.name === 'music_search');
  const apply = listed.find((tool) => tool.name === 'music_apply');
  assert.equal(search.annotations.readOnlyHint, true);
  assert.equal(apply.annotations.readOnlyHint, false);
  assert.match(search.description, /music_id/);
  assert.match(apply.description, /not retried/);
  const verify = listed.find((tool) => tool.name === 'music_verify');
  assert.equal(verify.annotations.readOnlyHint, true);
  assert.match(verify.description, /does not save/);
});

test('music_search uses the only open window and refuses an ambiguous choice', async () => {
  const only = session([[7, absolute('xs-music-only')]]);
  const found = await dispatchTool(only.d, 'music_search', { query: 'night' });
  assert.equal(found.isError, undefined);
  const search = only.calls.filter((call) => call[0] === 'plugin' && call[1] === 'music_search');
  assert.equal(search.length, 1);
  assert.equal(search[0][3], 7);
  assert.equal(search[0][2].query, 'night');

  const many = session([
    [7, absolute('xs-music-a')],
    [8, absolute('xs-music-b')],
  ]);
  const ambiguous = await dispatchTool(many.d, 'music_search', { query: 'night' });
  assert.equal(ambiguous.isError, true);
  assert.match(ambiguous.content[0].text, /AMBIGUOUS_INSTANCE/);
  assert.equal(many.calls.some((call) => call[1] === 'music_search'), false);

  const none = session([]);
  const cold = await dispatchTool(none.d, 'music_categories', {});
  assert.equal(cold.isError, true);
  assert.match(cold.content[0].text, /NO_EDITOR_WINDOW/);
  assert.match(cold.content[0].text, /WINDOWS_COLD_START_UNVERIFIED/);
  assert.equal(none.calls.some((call) => String(call[1]).startsWith('music_')), false);
});

test('music_apply binds only a confirmed window and does not retry a lost write', async () => {
  const project = absolute('xs-music-bind');
  const other = absolute('xs-music-other');
  const ok = session([[4, project]], {
    pluginResult: {
      imported: true,
      confirmed: false,
      bound: false,
      saved: false,
      binding: 'unconfirmed',
      local_import: false,
      music_id: 'm1',
      readback: { music_id: 'm1', binding: 'unconfirmed', scene_saved: false },
      apply_calls: 1,
    },
  });
  const bound = await dispatchTool(ok.d, 'music_apply', {
    project_path: project,
    music_id: 'm1',
    source: 'category',
    category_code: 'rec',
  });
  assert.equal(bound.isError, undefined);
  const body = JSON.parse(bound.content[0].text);
  assert.equal(body.imported, true);
  assert.equal(body.confirmed, false);
  assert.equal(body.bound, false);
  assert.equal(body.binding, 'unconfirmed');
  assert.equal(body.local_import, false);
  assert.equal(body.readback.music_id, 'm1');
  assert.equal(ok.calls.filter((call) => call[1] === 'music_apply').length, 1);

  const denied = session([[4, project]], { deny: [project] });
  const blocked = await dispatchTool(denied.d, 'music_apply', { music_id: 'm1', source: 'category', category_code: 'rec' });
  assert.equal(blocked.isError, true);
  assert.match(blocked.content[0].text, /PROTECTED_PROJECT/);
  assert.equal(denied.calls.some((call) => call[1] === 'music_apply'), false);

  const mismatch = session([[4, project]], { officialPaths: new Map([[4, other]]) });
  const unconfirmed = await dispatchTool(mismatch.d, 'music_apply', { music_id: 'm1', source: 'search', query: 'night' });
  assert.equal(unconfirmed.isError, true);
  assert.match(unconfirmed.content[0].text, /OFFICIAL_INSTANCE_UNCONFIRMED/);
  assert.equal(mismatch.calls.some((call) => call[1] === 'music_apply'), false);

  const moved = session([[4, project]], { statusPaths: new Map([[4, [project, other]]]) });
  const changed = await dispatchTool(moved.d, 'music_apply', { music_id: 'm1', source: 'category', category_code: 'rec' });
  assert.equal(changed.isError, true);
  assert.match(changed.content[0].text, /WINDOW_CHANGED/);
  assert.equal(moved.calls.some((call) => call[1] === 'music_apply'), false);

  const lost = session([[4, project]], { applyError: 'fetch failed' });
  const once = await dispatchTool(lost.d, 'music_apply', { music_id: 'm1', source: 'category', category_code: 'rec' });
  assert.equal(once.isError, true);
  assert.match(once.content[0].text, /not retried/);
  assert.equal(lost.calls.filter((call) => call[1] === 'music_apply').length, 1);

  const extra = session([[4, project]]);
  const rejected = await dispatchTool(extra.d, 'music_apply', { music_id: 'm1', source: 'category', category_code: 'rec', audio_path: project });
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /INVALID_ARGUMENTS/);
  assert.equal(extra.calls.some((call) => call[1] === 'music_apply'), false);
});
