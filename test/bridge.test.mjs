import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import { bridgeTiming, callPlugin, resolveInstance } from '../src/bridge.mjs';
import { tmpdir } from '../support/tmp.mjs';

const children = [];
test.after(() => children.forEach((child) => child.kill()));

function writeRecords(dir, records) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const record of records) {
    fs.writeFileSync(path.join(dir, `${record.pid}.json`), JSON.stringify({ port: 1, token: 'super-secret-token', ...record }));
  }
}

async function window(answer) {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 1e6)']);
  children.push(child);
  const calls = [];
  const server = http.createServer((req, res) => {
    calls.push(req.url);
    if (answer === 'hang') return;
    if (answer === 'echo-auth') {
      res.end(JSON.stringify({ ok: false, error: `leaked ${req.headers.authorization}` }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, value: { projectPath: answer } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  if (answer === 'closed') await new Promise((resolve) => server.close(resolve));
  else test.after(() => server.close());
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { pid: child.pid, port, startedAt: Date.now(), calls, server };
}

test('a hung window does not hide the window that has the project, and the token stays out of errors', async () => {
  bridgeTiming.statusMs = 300;
  const dir = path.join(tmpdir('xs-bridge-'), 'instances');
  const target = tmpdir('xs-proj-');
  const [hung, echoing, good] = [await window('hang'), await window('echo-auth'), await window(target)];
  writeRecords(dir, [hung, echoing, good]);
  assert.equal((await resolveInstance({ projectPath: target, dir })).pid, good.pid);
  const err = await resolveInstance({ projectPath: path.join(target, 'missing'), dir }).catch((e) => e);
  assert.match(err.message, /NO_UNIQUE_PLUGIN_INSTANCE/);
  assert.equal(err.message.includes('super-secret-token'), false);
  assert.match(err.message, /Bearer \[redacted\]/);
});

test('plugin calls do not go through the built-in fetch', async () => {
  const dir = path.join(tmpdir('xs-bridge-'), 'instances');
  const target = tmpdir('xs-proj-');
  writeRecords(dir, [await window(target)]);
  const builtin = globalThis.fetch;
  globalThis.fetch = () => Promise.reject(Error('built-in fetch used'));
  try {
    assert.deepEqual(await callPlugin('status', {}, { projectPath: target, dir }), { projectPath: target });
  } finally {
    globalThis.fetch = builtin;
  }
});
