'use strict';
const fs = require('fs');
const path = require('path');
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

function systemRootOf(env, systemRoot) {
  const raw = systemRoot || env.SystemRoot || env.WINDIR;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\//g, '\\').replace(/\\+$/, '');
  if (!/^[A-Za-z]:\\[^:*?"<>|\r\n]*$/.test(trimmed)) return null;
  if (trimmed.split('\\').includes('..')) return null;
  return trimmed;
}

function windowsExe(name, options = {}) {
  const env = options.env || process.env;
  const root = systemRootOf(env, options.systemRoot);
  if (!root) throw Error(`ACL_FAILED: SystemRoot is unset or unusable; ${name} is not searched on PATH`);
  const relative = name === 'powershell.exe'
    ? [
        ['System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'],
        ['Sysnative', 'WindowsPowerShell', 'v1.0', 'powershell.exe'],
        ['SysWOW64', 'WindowsPowerShell', 'v1.0', 'powershell.exe'],
      ]
    : [
        ['System32', name],
        ['Sysnative', name],
      ];
  const existsSync = options.existsSync || fs.existsSync;
  for (const parts of relative) {
    const candidate = path.win32.join(root, ...parts);
    try {
      if (existsSync(candidate)) return candidate;
    } catch {
      // A bad probe is not a PATH fallback.
    }
  }
  throw Error(`ACL_FAILED: ${name} not found under SystemRoot; PATH is not searched`);
}

function currentUserSid(execFile, options) {
  const raw = execFile(windowsExe('whoami.exe', options), ['/user', '/fo', 'csv', '/nh'], { encoding: 'buffer', windowsHide: true });
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
  try {
    const sid = currentUserSid(execFile, options);
    const stdout = execFile(
      windowsExe('powershell.exe', options),
      ['-NoProfile', '-NonInteractive', '-Command', windowsAclScript(target, sid, stat.isDirectory())],
      { encoding: 'buffer', windowsHide: true },
    );
    assertPrivateAcl(decodeProcessOutput(stdout), sid);
  } catch (e) {
    if (!stat.isDirectory()) fs.rmSync(target, { force: true });
    const message = e && e.message ? e.message : String(e);
    if (message.startsWith('ACL_')) throw e instanceof Error ? e : Error(message);
    throw Error(`ACL_FAILED: ${message}`);
  }
}

module.exports = { restrictPrivate, windowsAclScript, assertPrivateAcl, decodeProcessOutput, windowsExe };
