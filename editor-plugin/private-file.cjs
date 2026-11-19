'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function windowsAclScript(target, sid, isDirectory) {
  const kind = isDirectory ? 'Directory' : 'File';
  const inheritance = isDirectory ? 3 : 0;
  return `
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.ASCIIEncoding
[Console]::OutputEncoding = New-Object System.Text.ASCIIEncoding
$path = ${psQuote(target)}
$sid = New-Object System.Security.Principal.SecurityIdentifier(${psQuote(sid)})
$sec = New-Object System.Security.AccessControl.${kind}Security
$sec.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 2032127, ${inheritance}, 0, 0)
$sec.AddAccessRule($rule)
[System.IO.${kind}]::SetAccessControl($path, $sec)
$read = [System.IO.${kind}]::GetAccessControl($path)
$read.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { '{0}\t{1}\t{2}' -f $_.IdentityReference.Value, $_.AccessControlType, $_.IsInherited }
`.trim();
}

function decodeProcessOutput(output) {
  const buf = Buffer.isBuffer(output) ? output : Buffer.from(String(output), 'utf8');
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return buf.subarray(2).swap16().toString('utf16le');
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  const sample = buf.subarray(0, Math.min(buf.length, 64));
  let nulOdd = 0;
  for (let i = 1; i < sample.length; i += 2) if (sample[i] === 0) nulOdd += 1;
  if (sample.length >= 8 && nulOdd >= 3) return buf.toString('utf16le');
  return buf.toString('utf8');
}

function assertPrivateAcl(stdout, sid) {
  const rows = String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!rows.length) throw Error('ACL_NOT_PRIVATE: empty DACL');
  const expected = String(sid).toUpperCase();
  for (const row of rows) {
    const [id, type, inherited] = row.split('\t');
    if (!id || String(type).toLowerCase() !== 'allow' || String(inherited).toLowerCase() !== 'false' || id.toUpperCase() !== expected) {
      throw Error(`ACL_NOT_PRIVATE: ${row}`);
    }
  }
}

function currentUserSid(execFile) {
  const raw = execFile('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'buffer', windowsHide: true });
  const sid = decodeProcessOutput(raw).match(/S-1-5-[0-9-]+/);
  if (!sid) throw Error('ACL_USER_UNSAFE');
  return sid[0];
}

function restrictPrivate(target, options = {}) {
  const platform = options.platform || process.platform;
  const execFile = options.execFile || execFileSync;
  const stat = fs.statSync(target);
  if (platform !== 'win32') {
    fs.chmodSync(target, stat.isDirectory() ? 0o700 : 0o600);
    return;
  }
  let sid;
  try {
    sid = currentUserSid(execFile);
  } catch (e) {
    throw Error(String(e.message).startsWith('ACL_') ? e.message : `ACL_FAILED: ${e.message}`);
  }
  try {
    const stdout = execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windowsAclScript(target, sid, stat.isDirectory())], {
      encoding: 'buffer',
      windowsHide: true,
    });
    assertPrivateAcl(decodeProcessOutput(stdout), sid);
  } catch (e) {
    if (!stat.isDirectory()) fs.rmSync(target, { force: true });
    if (String(e.message).startsWith('ACL_')) throw e;
    throw Error(`ACL_FAILED: ${e.message}`);
  }
}

module.exports = { restrictPrivate, windowsAclScript, assertPrivateAcl, decodeProcessOutput };
