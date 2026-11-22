import assert from 'node:assert/strict';
import test from 'node:test';
import { bootstrapEditor } from '../src/editor.mjs';

test('bootstrapEditor throws BOOTSTRAP_FAILED if editor discovery returns nothing', () => {
  assert.throws(
    () => bootstrapEditor({ discover: () => null }),
    /BOOTSTRAP_FAILED: editor executable could not be discovered/,
  );
  assert.throws(
    () => bootstrapEditor({ discover: () => ({}) }),
    /BOOTSTRAP_FAILED: editor executable could not be discovered/,
  );
});

test('bootstrapEditor on win32 minimized uses powershell Start-Process -WindowStyle Minimized', () => {
  const calls = [];
  const res = bootstrapEditor({
    platform: 'win32',
    minimized: true,
    discover: () => ({ exe: 'C:\\Users\\test\\AppData\\Local\\Douyin AR\\electron\\Douyin AR.exe' }),
    windowsExe: (name) => `C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\${name}`,
    execFile: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return '';
    },
  });
  assert.equal(res.action, 'spawned');
  assert.equal(res.minimized, true);
  assert.equal(res.method, 'powershell-minimized');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.ok(calls[0].args.includes('-Command'));
  const script = calls[0].args[calls[0].args.indexOf('-Command') + 1];
  assert.ok(script.includes("Start-Process -FilePath 'C:\\Users\\test\\AppData\\Local\\Douyin AR\\electron\\Douyin AR.exe' -WindowStyle Minimized"));
});

test('bootstrapEditor under SSH uses schtasks session penetration on Windows', () => {
  const calls = [];
  const res = bootstrapEditor({
    platform: 'win32',
    minimized: true,
    env: { SSH_CONNECTION: '100.79.222.28 54321 100.71.36.14 22' },
    discover: () => ({ exe: 'C:\\Douyin AR\\electron\\Douyin AR.exe' }),
    windowsExe: (name) => `C:\\Windows\\System32\\${name}`,
    execFile: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      return '';
    },
  });
  assert.equal(res.action, 'spawned');
  assert.equal(res.minimized, true);
  assert.equal(res.method, 'schtasks-session-penetrate');
  assert.equal(calls.length, 2);
  assert.equal(calls[0].cmd, 'C:\\Windows\\System32\\schtasks.exe');
  assert.ok(calls[0].args.includes('/create'));
  assert.ok(calls[0].args.includes('XiangsuColdStart'));
  assert.equal(calls[1].cmd, 'C:\\Windows\\System32\\schtasks.exe');
  assert.ok(calls[1].args.includes('/run'));
});

test('bootstrapEditor falls back to direct spawn when powershell fails', () => {
  let unreferenced = false;
  const spawned = [];
  const res = bootstrapEditor({
    platform: 'win32',
    minimized: true,
    discover: () => ({ exe: 'C:\\Douyin AR\\Douyin AR.exe' }),
    windowsExe: () => { throw Error('powershell not found'); },
    spawn: (cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      return {
        pid: 1234,
        unref: () => { unreferenced = true; },
      };
    },
  });
  assert.equal(res.action, 'spawned');
  assert.equal(res.method, 'spawn-detached');
  assert.equal(res.pid, 1234);
  assert.equal(unreferenced, true);
  assert.equal(spawned.length, 1);
  assert.equal(spawned[0].cmd, 'C:\\Douyin AR\\Douyin AR.exe');
  assert.equal(spawned[0].opts.detached, true);
  assert.equal(spawned[0].opts.stdio, 'ignore');
});

test('bootstrapEditor with minimized: false uses detached spawn directly', () => {
  let unreferenced = false;
  const spawned = [];
  const res = bootstrapEditor({
    platform: 'win32',
    minimized: false,
    discover: () => ({ exe: 'C:\\Douyin AR\\Douyin AR.exe' }),
    spawn: (cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      return {
        pid: 5678,
        unref: () => { unreferenced = true; },
      };
    },
  });
  assert.equal(res.action, 'spawned');
  assert.equal(res.method, 'spawn-detached');
  assert.equal(res.pid, 5678);
  assert.equal(unreferenced, true);
  assert.equal(spawned[0].opts.windowsHide, false);
});
