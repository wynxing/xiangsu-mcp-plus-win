import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { once } from 'node:events';
import { listInstances } from '../src/bridge.mjs';
import { parseWindowsStartLines, processStartTimes, recordMatchesProcess } from '../src/procinfo.mjs';
import { tmpdir } from '../support/tmp.mjs';

test('windows CIM lines become start times and a dead pid is absent', () => {
  const times = parseWindowsStartLines('11632\t2026-11-19T02:28:32.000Z\n\nnot a row\n');
  assert.equal(times.get(11632), Date.parse('2026-11-19T02:28:32.000Z'));
  assert.equal(recordMatchesProcess(times.get(11632), Date.parse('2026-11-19T02:28:33.000Z')), true);
  assert.equal(recordMatchesProcess(times.get(11632), Date.parse('2026-11-19T02:00:00.000Z')), false);
  assert.throws(() => parseWindowsStartLines('5\tnot-a-date'), /PROCESS_START_UNPARSED/);
});

test('a record written after the process started is live, and an older record for the same pid is stale', () => {
  const dir = path.join(tmpdir('xs-inst-'), 'instances');
  fs.mkdirSync(dir);
  const write = (startedAt) => fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, port: 1, token: 'secret-token', startedAt }));
  write(Date.now() + 5000);
  assert.deepEqual(listInstances({ dir }).map((row) => row.pid), [process.pid]);
  write(0);
  assert.deepEqual(listInstances({ dir }), []);
});

test('a record whose process has exited is not a window', async () => {
  const child = spawn(process.execPath, ['-e', '']);
  await once(child, 'exit');
  const dir = path.join(tmpdir('xs-dead-'), 'instances');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, `${child.pid}.json`), JSON.stringify({ pid: child.pid, port: 1, token: 't', startedAt: Date.now() }));
  assert.deepEqual(listInstances({ dir }), []);
});

test('failure to read process start times is an error, not an empty window list', () => {
  const dir = path.join(tmpdir('xs-fail-'), 'instances');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, '9.json'), JSON.stringify({ pid: 9, port: 1, token: 't', startedAt: Date.now() }));
  assert.throws(() => listInstances({ dir, startTimes: () => { throw Error('cim down'); } }), /cim down/);
});

test('a plugin record in the default home directory is visible when stdio uses another state root', () => {
  const home = tmpdir('xs-home-');
  const custom = tmpdir('xs-custom-');
  const dir = path.join(home, '.xiangsu-mcp-plus-win', 'instances');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, port: 9, token: 'home-token', startedAt: Date.now() }));
  const found = listInstances({ env: { XIANGSU_MCP_PLUS_STATE: custom }, homedir: () => home });
  assert.deepEqual(found.map((row) => row.pid), [process.pid]);
  assert.equal(found[0].port, 9);
});

test('conflicting live records for one pid are refused without revealing the token', () => {
  const home = tmpdir('xs-home-');
  const custom = tmpdir('xs-custom-');
  const write = (root, port, token) => {
    const dir = path.join(root, 'instances');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, port, token, startedAt: Date.now() }));
  };
  write(custom, 1, 'token-alpha');
  write(path.join(home, '.xiangsu-mcp-plus-win'), 2, 'token-beta');
  assert.throws(
    () => listInstances({ env: { XIANGSU_MCP_PLUS_STATE: custom }, homedir: () => home }),
    (err) => {
      assert.match(err.message, /AMBIGUOUS_INSTANCE_STATE/);
      assert.equal(err.message.includes('token-alpha'), false);
      assert.equal(err.message.includes('token-beta'), false);
      return true;
    },
  );
});

test('a stale record does not hide the live record in the other state directory', () => {
  const home = tmpdir('xs-home-');
  const custom = tmpdir('xs-custom-');
  const write = (root, port, token, startedAt) => {
    const dir = path.join(root, 'instances');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${process.pid}.json`), JSON.stringify({ pid: process.pid, port, token, startedAt }));
  };
  write(custom, 1, 'token-old', 0);
  write(path.join(home, '.xiangsu-mcp-plus-win'), 2, 'token-live', Date.now());
  const found = listInstances({ env: { XIANGSU_MCP_PLUS_STATE: custom }, homedir: () => home });
  assert.equal(found.length, 1);
  assert.equal(found[0].port, 2);
});

test('the host can read this process start time', () => {
  const times = processStartTimes([process.pid]);
  assert.equal(recordMatchesProcess(times.get(process.pid), Date.now() + 1000), true);
});
