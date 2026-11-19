'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function windowsAclScript(target, user, isDirectory) {
  const kind = isDirectory ? 'Directory' : 'File';
  const inheritance = isDirectory
    ? '[System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit'
    : '[System.Security.AccessControl.InheritanceFlags]::None';
  return `
$ErrorActionPreference = 'Stop'
$path = ${psQuote(target)}
$user = ${psQuote(user)}
$sec = New-Object System.Security.AccessControl.${kind}Security
$sec.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($user, 'FullControl', ${inheritance}, [System.Security.AccessControl.PropagationFlags]::None, 'Allow')
$sec.AddAccessRule($rule)
[System.IO.${kind}]::SetAccessControl($path, $sec)
$read = [System.IO.${kind}]::GetAccessControl($path)
$read.GetAccessRules($true, $true, [System.Security.Principal.NTAccount]) | ForEach-Object { '{0}\t{1}\t{2}' -f $_.IdentityReference.Value, $_.AccessControlType, $_.IsInherited }
`.trim();
}

function assertPrivateAcl(stdout, user) {
  const rows = String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!rows.length) throw Error('ACL_NOT_PRIVATE: empty DACL');
  for (const row of rows) {
    const [id, type, inherited] = row.split('\t');
    if (!id || String(type).toLowerCase() !== 'allow' || String(inherited).toLowerCase() !== 'false' || id.toLowerCase() !== user.toLowerCase()) {
      throw Error(`ACL_NOT_PRIVATE: ${row}`);
    }
  }
}

function restrictPrivate(target, options = {}) {
  const platform = options.platform || process.platform;
  const execFile = options.execFile || execFileSync;
  const stat = fs.statSync(target);
  if (platform !== 'win32') {
    fs.chmodSync(target, stat.isDirectory() ? 0o700 : 0o600);
    return;
  }
  const user = String(execFile('whoami', [], { encoding: 'utf8', windowsHide: true })).trim();
  if (!/^[^\r\n"]+$/.test(user) || user.includes('%')) throw Error('ACL_USER_UNSAFE');
  try {
    const stdout = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsAclScript(target, user, stat.isDirectory())], {
      encoding: 'utf8',
      windowsHide: true,
    });
    assertPrivateAcl(stdout, user);
  } catch (e) {
    if (!stat.isDirectory()) fs.rmSync(target, { force: true });
    if (String(e.message).startsWith('ACL_')) throw e;
    throw Error(`ACL_FAILED: ${e.message}`);
  }
}

module.exports = { restrictPrivate, windowsAclScript, assertPrivateAcl };
