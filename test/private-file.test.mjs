import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { restrictPrivate, windowsAclScript } from '../src/private-file.mjs';
import { tmpdir } from '../support/tmp.mjs';

const require = createRequire(import.meta.url);
const pluginAcl = require('../editor-plugin/private-file.cjs');

function simulator() {
  const calls = [];
  const exec = (file, args) => {
    calls.push([path.basename(file).toLowerCase(), args.join(' ')]);
    const name = path.basename(file).toLowerCase();
    if (name.startsWith('whoami')) return 'TESTHOST\\onlyuser\n';
    if (name.startsWith('powershell')) {
      const script = args.at(-1);
      const replaced = script.includes('SetAccessRuleProtection($true, $false)') && /New-Object System\.Security\.AccessControl\.(File|Directory)Security/.test(script) && script.includes('SetAccessControl') && !script.includes('Get-Acl');
      if (!replaced) return 'Everyone\tAllow\tFalse\nTESTHOST\\onlyuser\tAllow\tFalse\n';
      return 'TESTHOST\\onlyuser\tAllow\tFalse\n';
    }
    if (name.startsWith('icacls')) return 'Everyone:(F)\nTESTHOST\\onlyuser:(F)\n';
    throw Error(`unexpected ${file}`);
  };
  return { exec, calls };
}

test('directory ACL script grants the user without using -bor inside New-Object', () => {
  const script = windowsAclScript('C:\\instances', 'HOST\\user', true);
  assert.match(script, /DirectorySecurity/);
  assert.match(script, /FileSystemAccessRule\(\$user, 2032127, 3, 0, 0\)/);
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
      if (path.basename(file).toLowerCase().startsWith('powershell')) {
        return 'Everyone\tAllow\tFalse\nTESTHOST\\onlyuser\tAllow\tFalse\n';
      }
      return real(file, args, opts);
    };
    assert.throws(() => apply(file, { platform: 'win32', execFile }), /ACL_NOT_PRIVATE: Everyone/);
    assert.equal(fs.existsSync(file), false);
    assert.equal(calls.some((call) => call[0].startsWith('icacls')), false);
  }
});

test('a replaced DACL that reads back as only the current user is kept', () => {
  const file = path.join(tmpdir('xs-acl-'), 'pid.json');
  fs.writeFileSync(file, '{}');
  const { exec, calls } = simulator();
  const result = restrictPrivate(file, { platform: 'win32', execFile: exec });
  assert.equal(result.method, 'dacl');
  assert.equal(fs.existsSync(file), true);
  const script = calls.find((call) => call[0].startsWith('powershell'))[1];
  assert.match(script, /SetAccessRuleProtection\(\$true, \$false\)/);
  assert.match(script, /New-Object System\.Security\.AccessControl\.FileSecurity/);
  assert.match(script, /FileSystemAccessRule\(\$user, 2032127, 0, 0, 0\)/);
  assert.match(script, /SetAccessControl/);
  assert.equal(script.includes('-bor'), false);
  assert.equal(script.includes('Get-Acl'), false);
  assert.equal(calls.some((call) => call[0].startsWith('icacls')), false);
  pluginAcl.restrictPrivate(file, { platform: 'win32', execFile: exec });
  assert.equal(fs.existsSync(file), true);
});
