import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { decodeProcessOutput, restrictPrivate } from '../src/private-file.mjs';

const require = createRequire(import.meta.url);
const pluginAcl = require('../editor-plugin/private-file.cjs');
const windows = process.platform === 'win32';
const evidenceDir = path.join(process.cwd(), 'test-results');

function hex(buf, n = 24) {
  return Buffer.from(buf).subarray(0, n).toString('hex');
}

function psQuote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function runProbe(args) {
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', args], { encoding: 'buffer', windowsHide: true });
}

test('record stock powershell.exe stdout bytes', { skip: !windows }, () => {
  const command = "Write-Output 'ENCODING-PROBE'";
  const buf = runProbe(command);
  const decoded = decodeProcessOutput(buf);
  const evidence = {
    node: process.version,
    command: `powershell.exe -NoProfile -NonInteractive -Command ${command}`,
    byteLength: buf.length,
    prefixHex: hex(buf),
    bom: buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe ? 'utf16le' : buf.length >= 3 && buf[0] === 0xef ? 'utf8' : 'none',
    decoded: decoded.trim(),
    nulOddInSample: (() => {
      let n = 0;
      const sample = buf.subarray(0, Math.min(buf.length, 64));
      for (let i = 1; i < sample.length; i += 2) if (sample[i] === 0) n += 1;
      return n;
    })(),
  };
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(path.join(evidenceDir, 'windows-acl-evidence.json'), JSON.stringify(evidence, null, 2));
  console.log(`ACL_ENCODING_EVIDENCE ${JSON.stringify(evidence)}`);
  assert.match(evidence.decoded, /ENCODING-PROBE/);
});

test('real NTFS ACL replaces a foreign ACE on a non-ASCII path and the plugin can start', { skip: !windows }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'xs-acl-探针-'));
  const dir = path.join(root, '状态');
  const file = path.join(dir, '令牌.json');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, '{"token":"probe"}');
  const foreign = `
$ErrorActionPreference = 'Stop'
$path = ${psQuote(file)}
$sid = New-Object System.Security.Principal.SecurityIdentifier('S-1-1-0')
$sec = [System.IO.File]::GetAccessControl($path)
$rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 2032127, 0, 0, 0)
$sec.AddAccessRule($rule)
[System.IO.File]::SetAccessControl($path, $sec)
`.trim();
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', foreign], { windowsHide: true });
  restrictPrivate(file);
  pluginAcl.restrictPrivate(dir);
  const readback = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `$read = [System.IO.File]::GetAccessControl(${psQuote(file)}); $read.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object { $_.IdentityReference.Value }`],
    { encoding: 'buffer', windowsHide: true },
  );
  const sids = decodeProcessOutput(readback).split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith('S-1-'));
  const who = decodeProcessOutput(execFileSync('whoami', ['/user', '/fo', 'csv', '/nh'], { encoding: 'buffer', windowsHide: true }));
  const mine = who.match(/S-1-5-[0-9-]+/)[0];
  assert.deepEqual([...new Set(sids)], [mine]);
  assert.equal(fs.readFileSync(file, 'utf8'), '{"token":"probe"}');
  fs.writeFileSync(file, '{"token":"rewritten"}');
  assert.match(fs.readFileSync(file, 'utf8'), /rewritten/);
  process.env.XIANGSU_MCP_PLUS_STATE = root;
  const { Runtime } = require('../editor-plugin/runtime.cjs');
  const rt = new Runtime();
  const port = await rt.start();
  assert.equal(rt.server.address().address, '127.0.0.1');
  const stateFile = path.join(root, 'instances', `${process.pid}.json`);
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).port, port);
  rt.stop();
  const doomed = path.join(dir, 'cleanup.json');
  fs.writeFileSync(doomed, '{}');
  const real = execFileSync;
  assert.throws(
    () =>
      restrictPrivate(doomed, {
        execFile(cmd, args, opts) {
          const out = real(cmd, args, { ...opts, encoding: 'buffer' });
          if (path.basename(cmd).toLowerCase().startsWith('powershell')) {
            return Buffer.concat([Buffer.from(decodeProcessOutput(out), 'utf8'), Buffer.from('S-1-1-0\tAllow\tFalse\n', 'utf8')]);
          }
          return out;
        },
      }),
    /ACL_NOT_PRIVATE/,
  );
  assert.equal(fs.existsSync(doomed), false);
});
