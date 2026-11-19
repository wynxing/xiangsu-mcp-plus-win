import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { claimTarget, releaseTarget } from '../src/target-lock.mjs';
import { tmpdir } from '../support/tmp.mjs';

const worker = fileURLToPath(new URL('../support/target-lock-worker.mjs', import.meta.url));

function startWorker(stateRoot, target, holdMs) {
  const child = spawn(process.execPath, [worker, stateRoot, target, String(holdMs)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (chunk) => {
    out += chunk;
  });
  child.stderr.on('data', (chunk) => {
    out += chunk;
  });
  return { child, output: () => out, done: once(child, 'exit').then(([code]) => ({ code, out })) };
}

test('two processes cannot reserve the same target, and a dead pid can be replaced without deleting the target', async () => {
  const stateRoot = tmpdir('xs-lock-');
  const target = path.join(tmpdir('xs-target-'), '空白');
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'keep.txt'), 'keep');
  const first = startWorker(stateRoot, target, 400);
  const claimed = Date.now() + 3000;
  while (!first.output().includes('claimed') && Date.now() < claimed) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.match(first.output(), /claimed/);
  const second = await startWorker(stateRoot, target, 0).done;
  assert.match(second.out, /TARGET_LOCKED/);
  const finished = await first.done;
  assert.match(finished.out, /released/);
  const third = await startWorker(stateRoot, target, 0).done;
  assert.match(third.out, /claimed/);
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'keep');

  const dead = spawn(process.execPath, ['-e', '']);
  await once(dead, 'exit');
  const claim = claimTarget(target, { stateRoot });
  const file = claim.file;
  releaseTarget(claim);
  fs.writeFileSync(file, JSON.stringify({ pid: dead.pid, target, createdAt: Date.now() }));
  const again = claimTarget(target, { stateRoot });
  assert.equal(fs.readFileSync(path.join(target, 'keep.txt'), 'utf8'), 'keep');
  releaseTarget(again);
});
