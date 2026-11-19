import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePath, pathInside, samePath } from '../src/paths.mjs';

const win = { platform: 'win32' };

test('windows paths ignore slash, case and a trailing separator', () => {
  const a = 'E:\\工作\\特效\\Probe\\';
  const b = 'e:/工作/特效/probe';
  assert.equal(samePath(a, b, win), true);
  assert.equal(normalizePath(a, win), 'E:\\工作\\特效\\Probe');
});

test('windows unicode paths compare in NFC', () => {
  const nfc = 'E:\\Café\\项目';
  const nfd = 'E:\\Cafe\u0301\\项目';
  assert.equal(samePath(nfc, nfd, win), true);
  assert.equal(normalizePath(nfd, win), 'E:\\Café\\项目');
});

test('relative paths and a different directory are not the same project', () => {
  assert.throws(() => normalizePath('工作\\项目', win), /INVALID_PATH/);
  assert.equal(samePath('E:\\工作\\甲', 'E:\\工作\\乙', win), false);
});

test('a child of a denied directory is inside it on windows', () => {
  assert.equal(pathInside('E:\\protected\\child', 'e:/protected', win), true);
  assert.equal(pathInside('E:\\protected-other', 'E:\\protected', win), false);
});

test('posix paths stay case-sensitive', () => {
  assert.equal(samePath('/tmp/Project', '/tmp/project', { platform: 'linux' }), false);
});
