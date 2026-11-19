// Process start time for pid-reuse checks.
// Linux reads /proc (starttime is field 22). Windows asks CIM for CreationDate.
// macOS `ps -o lstart` is not used.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { windowsExe } from './private-file.mjs';

function powershellExe(options) {
  try {
    return windowsExe('powershell.exe', options);
  } catch (e) {
    const detail = String((e && e.message) || e).replace(/^ACL_FAILED:\s*/, '');
    throw Error(`PROCESS_START_CHECK_FAILED: ${detail}`);
  }
}

const SKEW_MS = 5000;

export function recordMatchesProcess(processStartedAt, recordStartedAt, skewMs = SKEW_MS) {
  return Number.isFinite(processStartedAt) && Number.isFinite(recordStartedAt) && processStartedAt <= recordStartedAt + skewMs;
}

export function parseWindowsStartLines(text) {
  const times = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const match = /^(\d+)\t(\S+)/.exec(line.trim());
    if (!match) continue;
    const started = Date.parse(match[2]);
    if (Number.isNaN(started)) throw Error(`PROCESS_START_UNPARSED: ${line.trim()}`);
    times.set(Number(match[1]), started);
  }
  return times;
}

let clockTicks;
function linuxClockTicks() {
  if (clockTicks) return clockTicks;
  try {
    clockTicks = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8' }).trim());
  } catch {
    clockTicks = 100;
  }
  if (!Number.isFinite(clockTicks) || clockTicks <= 0) clockTicks = 100;
  return clockTicks;
}

export function linuxStartTimes(pids, { readFileSync = fs.readFileSync } = {}) {
  let stat;
  try {
    stat = readFileSync('/proc/stat', 'utf8');
  } catch (e) {
    throw Error(`PROCESS_START_CHECK_FAILED: ${e.message}`);
  }
  const boot = Number(/btime\s+(\d+)/.exec(stat)?.[1]);
  if (!Number.isFinite(boot)) throw Error('PROCESS_START_CHECK_FAILED: /proc/stat has no btime');
  const hz = linuxClockTicks();
  const times = new Map();
  for (const pid of pids) {
    let text;
    try {
      text = readFileSync(`/proc/${pid}/stat`, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') continue;
      throw Error(`PROCESS_START_CHECK_FAILED: ${e.message}`);
    }
    const after = text.slice(text.lastIndexOf(')') + 1).trim().split(/\s+/);
    const ticks = Number(after[19]);
    if (!Number.isFinite(ticks)) throw Error(`PROCESS_START_UNPARSED: pid ${pid}`);
    times.set(Number(pid), boot * 1000 + (ticks * 1000) / hz);
  }
  return times;
}

export function windowsStartTimes(pids, options = {}) {
  const { execFile = execFileSync } = options;
  const ids = [...new Set(pids.map((pid) => Number(pid)).filter((pid) => Number.isInteger(pid) && pid > 0))];
  if (!ids.length) return new Map();
  const script = `$ids = @(${ids.join(',')})
Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ProcessId } | ForEach-Object {
  '{0}\t{1}' -f $_.ProcessId, $_.CreationDate.ToUniversalTime().ToString('o')
}`;
  const exe = powershellExe(options);
  let stdout;
  try {
    stdout = execFile(exe, ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    });
  } catch (e) {
    throw Error(`PROCESS_START_CHECK_FAILED: ${e.message}`);
  }
  return parseWindowsStartLines(stdout);
}

export function processStartTimes(pids, { platform = process.platform, ...deps } = {}) {
  if (platform === 'win32') return windowsStartTimes(pids, deps);
  if (platform === 'linux') return linuxStartTimes(pids, deps);
  throw Error(`PROCESS_START_UNSUPPORTED: ${platform}`);
}
