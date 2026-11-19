// Replace a token file's DACL with one Allow entry for the current user, then read it back.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

export function windowsAclScript(target, user, isDirectory) {
  const kind = isDirectory ? 'Directory' : 'File';
  // FullControl = 2032127. Inheritance: None = 0, ContainerInherit|ObjectInherit = 3.
  // Propagation None = 0. AccessControlType Allow = 0.
  // Numeric flags avoid `-bor` inside New-Object, which Windows PowerShell treats as an argument.
  const inheritance = isDirectory ? 3 : 0;
  return `
$ErrorActionPreference = 'Stop'
$OutputEncoding = New-Object System.Text.ASCIIEncoding
[Console]::OutputEncoding = New-Object System.Text.ASCIIEncoding
$path = ${psQuote(target)}
$sid = New-Object System.Security.Principal.SecurityIdentifier(${psQuote(user)})
$sec = New-Object System.Security.AccessControl.${kind}Security
$sec.SetAccessRuleProtection($true, $false)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 2032127, ${inheritance}, 0, 0)
$sec.AddAccessRule($rule)
[System.IO.${kind}]::SetAccessControl($path, $sec)
$read = [System.IO.${kind}]::GetAccessControl($path)
$read.GetAccessRules($true, $true, [System.Security.Principal.SecurityIdentifier]) | ForEach-Object { '{0}\t{1}\t{2}' -f $_.IdentityReference.Value, $_.AccessControlType, $_.IsInherited }
`.trim();
}

export function decodeProcessOutput(output) {
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

export function assertPrivateAcl(stdout, sid) {
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
  const text = decodeProcessOutput(raw);
  const sid = text.match(/S-1-5-[0-9-]+/);
  if (!sid) throw Error('ACL_USER_UNSAFE');
  return sid[0];
}

export function restrictPrivate(target, { platform = process.platform, execFile = execFileSync } = {}) {
  const stat = fs.statSync(target);
  if (platform !== 'win32') {
    const mode = stat.isDirectory() ? 0o700 : 0o600;
    fs.chmodSync(target, mode);
    return { method: 'chmod', mode };
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
    return { method: 'dacl', sid };
  } catch (e) {
    if (!stat.isDirectory()) fs.rmSync(target, { force: true });
    if (String(e.message).startsWith('ACL_')) throw e;
    throw Error(`ACL_FAILED: ${e.message}`);
  }
}
