import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { dispatchTool } from '../src/server.mjs';
import { tmpdir } from '../support/tmp.mjs';

function scene(paths) {
  const calls = [];
  const windows = new Map(paths);
  const d = {
    official: {
      callJson: async (name) => {
        calls.push(['official', name]);
        if (name !== 'list_instances') throw Error(`unexpected ${name}`);
        return {
          instances: [...windows].map(([pid, projectPath], index) => ({
            instance_id: String(index + 1),
            generation: `${pid}-abc`,
            project_path: projectPath,
          })),
        };
      },
    },
    allow: [os.tmpdir()],
    listInstances: () => [...windows].map(([pid]) => ({ pid })),
    callPlugin: async (method, params, opts) => {
      calls.push([method, params, opts.pid]);
      const projectPath = windows.get(opts.pid);
      if (method === 'status') return { projectPath };
      if (method === 'project_state') return { project_path: projectPath, changed: false, scene_ready: true };
      if (method === 'icon_set') {
        return { uploaded: true, project_path: projectPath, types: params.types, project_icons: params.types, readback: [] };
      }
      if (method === 'icon_open') {
        return { called: 'showIconCreationWindow', argument: 'tool_bar', window_readback: false, minimized: null, project_path: projectPath };
      }
      throw Error(`unexpected ${method}`);
    },
    sleep: async () => {},
    openTimeoutMs: 10,
    closeTimeoutMs: 10,
    launchRetryMs: 10,
    instanceTimeoutMs: 0,
    saveTimeoutMs: 10,
  };
  return { d, calls };
}

async function pngFile(name = '图标.png') {
  const file = path.join(tmpdir('xs-src-'), name);
  fs.writeFileSync(file, await sharp({ create: { width: 4, height: 2, channels: 3, background: { r: 0, g: 255, b: 0 } } }).png().toBuffer());
  return file;
}

const iconCalls = (calls) => calls.filter((call) => call[0] === 'icon_set' || call[0] === 'icon_open');

test('icon_set prepares a 360 png for the named window and removes it afterwards', async () => {
  const project = path.join(tmpdir('xs-proj-'), 'Probe');
  fs.mkdirSync(project);
  const { d, calls } = scene([[7, project]]);
  const image = await pngFile();
  const before = fs.readFileSync(image);
  const result = await dispatchTool(d, 'icon_set', { project_path: project, image_path: image });
  assert.equal(result.isError, undefined);
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.uploaded, true);
  assert.equal(body.pid, 7);
  assert.equal(body.calls, 1);
  assert.equal(body.prepared.width, 360);
  assert.equal(body.prepared.height, 360);
  assert.deepEqual(body.prepared.crop, { left: 1, top: 0, side: 2, source_width: 4, source_height: 2 });
  const sent = iconCalls(calls);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0][1].types, ['female', 'male']);
  assert.equal(sent[0][1].expected_project_path, project);
  assert.equal(fs.existsSync(sent[0][1].png_path), false);
  assert.deepEqual(fs.readFileSync(image), before);
});

test('two windows and an unconfirmed official instance do not prepare or upload', async () => {
  const root = tmpdir('xs-proj-');
  const first = path.join(root, 'One');
  const second = path.join(root, 'Two');
  const { d, calls } = scene([[7, first], [8, second]]);
  const image = await pngFile('a.png');
  const ambiguous = await dispatchTool(d, 'icon_set', { image_path: image });
  assert.equal(ambiguous.isError, true);
  assert.match(ambiguous.content[0].text, /AMBIGUOUS_INSTANCE/);
  assert.equal(iconCalls(calls).length, 0);

  d.official.callJson = async () => {
    throw Error('list down');
  };
  const unconfirmed = await dispatchTool(d, 'icon_open', { project_path: first });
  assert.equal(unconfirmed.isError, true);
  assert.match(unconfirmed.content[0].text, /OFFICIAL_INSTANCE_UNCONFIRMED/);
  assert.equal(iconCalls(calls).length, 0);
});

test('a dropped icon_set is not sent again and a false upload is not success', async () => {
  const project = path.join(tmpdir('xs-proj-'), 'Probe');
  fs.mkdirSync(project);
  const image = await pngFile('b.png');
  const dropped = scene([[4, project]]);
  dropped.d.callPlugin = async (method, params, opts) => {
    dropped.calls.push([method, params, opts.pid]);
    if (method === 'status') return { projectPath: project };
    if (method === 'project_state') return { project_path: project, changed: false, scene_ready: true };
    if (method === 'icon_set') throw Error('PLUGIN_RPC_FAILED(icon_set): fetch failed (UND_ERR_SOCKET)');
    throw Error(`unexpected ${method}`);
  };
  const failed = await dispatchTool(dropped.d, 'icon_set', { image_path: image, project_path: project, type: 'male' });
  assert.equal(failed.isError, true);
  assert.match(failed.content[0].text, /was not retried/);
  assert.equal(dropped.calls.filter((call) => call[0] === 'icon_set').length, 1);
  const pngPath = dropped.calls.find((call) => call[0] === 'icon_set')[1].png_path;
  assert.equal(fs.existsSync(pngPath), false);
  assert.deepEqual(dropped.calls.find((call) => call[0] === 'icon_set')[1].types, ['male']);

  const unclear = scene([[4, project]]);
  unclear.d.callPlugin = async (method, params, opts) => {
    unclear.calls.push([method, opts.pid]);
    if (method === 'status') return { projectPath: project };
    if (method === 'project_state') return { project_path: project, changed: false, scene_ready: true };
    if (method === 'icon_set') return { uploaded: false, project_path: project };
    throw Error(`unexpected ${method}`);
  };
  const denied = await dispatchTool(unclear.d, 'icon_set', { image_path: image, instance_id: '1' });
  assert.equal(denied.isError, true);
  assert.match(denied.content[0].text, /ICON_UPLOAD_UNCONFIRMED/);
  assert.equal(unclear.calls.filter((call) => call[0] === 'icon_set').length, 1);
});

test('icon_open targets one window and does not report the window as visible', async () => {
  const project = path.join(tmpdir('xs-proj-'), 'Probe');
  const { d, calls } = scene([[9, project]]);
  const result = await dispatchTool(d, 'icon_open', { instance_id: '1' });
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.pid, 9);
  assert.equal(body.window_readback, false);
  assert.equal(body.minimized, null);
  assert.equal(body.calls, 1);
  assert.equal(iconCalls(calls).length, 1);
  assert.equal(calls.some((call) => call[0] === 'submit_prepare' || call[0] === 'submit_confirm'), false);
});

test('a project outside the allowlist is not uploaded', async () => {
  const project = path.join(tmpdir('xs-proj-'), 'Probe');
  const { d, calls } = scene([[3, project]]);
  d.allow = [path.join(os.tmpdir(), 'somewhere-else')];
  const result = await dispatchTool(d, 'icon_set', { project_path: project, image_path: await pngFile('c.png') });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /PROJECT_NOT_ALLOWLISTED/);
  assert.equal(iconCalls(calls).length, 0);
});
