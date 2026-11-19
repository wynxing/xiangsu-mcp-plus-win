import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { tmpdir } from '../support/tmp.mjs';

const require = createRequire(import.meta.url);

test('loopback token RPC redacts secrets and rejects a bad token', async () => {
  const state = tmpdir('xs-rt-');
  process.env.XIANGSU_MCP_PLUS_STATE = state;
  const { Runtime, isLoopback } = require('../editor-plugin/runtime.cjs');
  assert.equal(isLoopback('127.0.0.1'), true);
  assert.equal(isLoopback('::ffff:127.0.0.1'), true);
  assert.equal(isLoopback('::1'), true);
  assert.equal(isLoopback('10.0.0.8'), false);
  const rt = new Runtime();
  const port = await rt.start();
  assert.equal(rt.server.address().address, '127.0.0.1');
  const stateFile = path.join(state, 'instances', `${process.pid}.json`);
  const record = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.equal(record.token, rt.token);
  if (process.platform !== 'win32') assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
  const bad = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { authorization: `Bearer ${rt.token}nope`, 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'status' }),
  });
  const badBody = await bad.text();
  assert.equal(bad.status, 401);
  assert.equal(badBody.includes(rt.token), false);
  const ok = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { authorization: `Bearer ${rt.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'self_check' }),
  });
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.equal(body.value.ok, false);
  assert.equal(body.value.features.project, false);
  assert.equal(JSON.stringify(body).includes(rt.token), false);
  rt.library.projectLaunch = async () => ({ requested: 'createNew' });
  const launched = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { authorization: `Bearer ${rt.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'project_launch', params: { operation: 'createNew' } }),
  });
  assert.equal((await launched.json()).ok, true);
  rt.library.projectClose = async () => {
    throw Error(`failed with ${rt.token} and Bearer ${rt.token}`);
  };
  const leaked = await fetch(`http://127.0.0.1:${port}/rpc`, {
    method: 'POST',
    headers: { authorization: `Bearer ${rt.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'project_close' }),
  });
  const leakedText = await leaked.text();
  assert.equal(leakedText.includes(rt.token), false);
  const log = fs.readFileSync(path.join(state, 'logs', 'plugin.log'), 'utf8');
  assert.equal(log.includes(rt.token), false);
  assert.match(log, /rpc start project_launch/);
  assert.match(log, /rpc done project_launch/);
  assert.match(log, /rpc start project_close/);
  rt.stop();
});

test('mutating calls on one window run one at a time', async () => {
  process.env.XIANGSU_MCP_PLUS_STATE = tmpdir('xs-rt-');
  const { Runtime } = require('../editor-plugin/runtime.cjs');
  const rt = new Runtime();
  const port = await rt.start();
  let current = 0;
  let max = 0;
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  rt.library.projectClose = async () => {
    current += 1;
    max = Math.max(max, current);
    await gate;
    current -= 1;
    return { closing: true };
  };
  const call = () =>
    fetch(`http://127.0.0.1:${port}/rpc`, {
      method: 'POST',
      headers: { authorization: `Bearer ${rt.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'project_close' }),
    });
  const first = call();
  const second = call();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(max, 1);
  release();
  await Promise.all([first, second]);
  rt.stop();
});
