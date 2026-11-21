import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { restrictPrivate, windowsAclScript, windowsExe } from '../src/private-file.mjs';
import { tmpdir } from '../support/tmp.mjs';

const require = createRequire(import.meta.url);
const pluginAcl = require('../editor-plugin/private-file.cjs');

const SYSTEM32_WHOAMI = 'C:\\Windows\\System32\\whoami.exe';
const SYSTEM32_POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const SYSNATIVE_POWERSHELL = 'C:\\Windows\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe';

function baseName(file) {
  return path.win32.basename(String(file)).toLowerCase();
}

function presentOnSlimPath(candidate) {
  const norm = String(candidate).replaceAll('/', '\\');
  return norm === SYSTEM32_WHOAMI || norm === SYSTEM32_POWERSHELL;
}

function simulator() {
  const calls = [];
  const exec = (file, args) => {
    calls.push([String(file), args.join(' ')]);
    if (!path.win32.isAbsolute(file)) {
      const error = Error(`spawnSync ${file} ENOENT`);
      error.code = 'ENOENT';
      throw error;
    }
    const name = baseName(file);
    if (name.startsWith('whoami')) return '"TESTHOST\\onlyuser","S-1-5-21-1"\n';
    if (name.startsWith('powershell')) {
      const script = args.at(-1);
      const replaced = script.includes('SetAccessRuleProtection($true, $false)') && /New-Object System\.Security\.AccessControl\.(File|Directory)Security/.test(script) && script.includes('SetAccessControl') && !script.includes('Get-Acl');
      if (!replaced) return 'S-1-1-0\tAllow\tFalse\nS-1-5-21-1\tAllow\tFalse\n';
      return 'S-1-5-21-1\tAllow\tFalse\n';
    }
    if (name.startsWith('icacls')) return 'Everyone:(F)\nTESTHOST\\onlyuser:(F)\n';
    throw Error(`unexpected ${file}`);
  };
  return { exec, calls };
}

function winOptions(exec, existsSync = presentOnSlimPath) {
  return {
    platform: 'win32',
    execFile: exec,
    env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Windows\\System32' },
    existsSync,
  };
}

test('directory ACL script grants the user without using -bor inside New-Object', () => {
  const script = windowsAclScript('C:\\instances', 'HOST\\user', true);
  assert.match(script, /DirectorySecurity/);
  assert.match(script, /FileSystemAccessRule\(\$sid, 2032127, 3, 0, 0\)/);
  assert.equal(script.includes('-bor'), false);
  assert.equal(pluginAcl.windowsAclScript('C:\\instances', 'HOST\\user', true), script);
});

test('a DACL that still grants Everyone is rejected and the token file is removed', () => {
  for (const apply of [restrictPrivate, pluginAcl.restrictPrivate]) {
    const file = path.join(tmpdir('xs-acl-'), 'pid.json');
    fs.writeFileSync(file, '{"token":"secret"}');
    const { exec, calls } = simulator();
    const real = exec;
    const execFile = (file, args, opts) => {
      if (baseName(file).startsWith('powershell')) {
        return 'S-1-1-0\tAllow\tFalse\nS-1-5-21-1\tAllow\tFalse\n';
      }
      return real(file, args, opts);
    };
    assert.throws(() => apply(file, winOptions(execFile)), /ACL_NOT_PRIVATE: S-1-1-0/);
    assert.equal(fs.existsSync(file), false);
    assert.equal(calls.some((call) => baseName(call[0]).startsWith('icacls')), false);
  }
});

test('a replaced DACL that reads back as only the current user is kept', () => {
  const file = path.join(tmpdir('xs-acl-'), 'pid.json');
  fs.writeFileSync(file, '{}');
  const { exec, calls } = simulator();
  const result = restrictPrivate(file, winOptions(exec));
  assert.equal(result.method, 'dacl');
  assert.equal(fs.existsSync(file), true);
  const script = calls.find((call) => baseName(call[0]).startsWith('powershell'))[1];
  assert.match(script, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(script, /New-Object System\.Security\.AccessControl\.FileSecurity/);
  assert.match(script, /FileSystemAccessRule\(\$sid, 2032127, 0, 0, 0\)/);
  assert.match(script, /SetAccessControl/);
  assert.equal(script.includes('-bor'), false);
  assert.equal(script.includes('Get-Acl'), false);
  assert.equal(calls.some((call) => baseName(call[0]).startsWith('icacls')), false);
  assert.deepEqual(calls.map((call) => call[0]), [SYSTEM32_WHOAMI, SYSTEM32_POWERSHELL]);
  pluginAcl.restrictPrivate(file, winOptions(exec));
  assert.equal(fs.existsSync(file), true);
});

test('a PATH that only contains System32 still uses the SystemRoot powershell and whoami', () => {
  for (const apply of [restrictPrivate, pluginAcl.restrictPrivate]) {
    const file = path.join(tmpdir('xs-acl-'), 'pid.json');
    fs.writeFileSync(file, '{}');
    const { exec, calls } = simulator();
    apply(file, winOptions(exec));
    assert.deepEqual(calls.map((call) => call[0]), [SYSTEM32_WHOAMI, SYSTEM32_POWERSHELL]);
    assert.equal(calls.some((call) => !path.win32.isAbsolute(call[0])), false);
    assert.equal(fs.existsSync(file), true);
  }
  assert.equal(windowsExe('powershell.exe', winOptions(() => {})), SYSTEM32_POWERSHELL);
  assert.equal(pluginAcl.windowsExe('whoami.exe', winOptions(() => {})), SYSTEM32_WHOAMI);
});

test('a 32-bit view uses Sysnative powershell when System32 does not have it', () => {
  const file = path.join(tmpdir('xs-acl-'), 'pid.json');
  fs.writeFileSync(file, '{}');
  const { exec, calls } = simulator();
  const existsSync = (candidate) => {
    const norm = String(candidate).replaceAll('/', '\\');
    return norm === SYSTEM32_WHOAMI || norm === SYSNATIVE_POWERSHELL;
  };
  restrictPrivate(file, winOptions(exec, existsSync));
  pluginAcl.restrictPrivate(file, winOptions(exec, existsSync));
  assert.deepEqual(calls.map((call) => call[0]), [SYSTEM32_WHOAMI, SYSNATIVE_POWERSHELL, SYSTEM32_WHOAMI, SYSNATIVE_POWERSHELL]);
});

test('missing system binaries fail closed, delete the token, and do not search PATH', () => {
  const file = path.join(tmpdir('xs-acl-'), 'pid.json');
  fs.writeFileSync(file, '{"token":"secret"}');
  const { exec, calls } = simulator();
  assert.throws(() => restrictPrivate(file, winOptions(exec, () => false)), /ACL_FAILED: whoami.exe not found under SystemRoot; PATH is not searched/);
  assert.equal(fs.existsSync(file), false);
  assert.equal(calls.length, 0);
  const dir = path.join(tmpdir('xs-acl-'), 'instances');
  fs.mkdirSync(dir);
  fs.writeFileSync(file, '{}');
  const powershellMissing = (candidate) => String(candidate).replaceAll('/', '\\') === SYSTEM32_WHOAMI;
  assert.throws(() => pluginAcl.restrictPrivate(file, winOptions(exec, powershellMissing)), /ACL_FAILED: powershell.exe not found under SystemRoot/);
  assert.equal(fs.existsSync(file), false);
  assert.equal(calls.length, 1);
  assert.throws(() => pluginAcl.restrictPrivate(dir, winOptions(exec, () => false)), /ACL_FAILED: whoami.exe not found/);
  assert.equal(fs.existsSync(dir), true);
  const stillThere = path.join(tmpdir('xs-acl-'), 'pid.json');
  fs.writeFileSync(stillThere, '{}');
  assert.throws(
    () => restrictPrivate(stillThere, { platform: 'win32', execFile: exec, env: { PATH: 'C:\\Windows\\System32' }, existsSync: presentOnSlimPath }),
    /ACL_FAILED: SystemRoot is unset or unusable/,
  );
  assert.equal(fs.existsSync(stillThere), false);
  assert.equal(calls.every((call) => path.win32.isAbsolute(call[0])), true);
});
