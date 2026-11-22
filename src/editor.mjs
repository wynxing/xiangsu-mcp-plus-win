// Locate a Douyin AR / 像塑 install and the versioned user plugin directory.
// Product root contains Resources. The executable is either
// <root>\Douyin AR.exe or <root>\electron\Douyin AR.exe.
// electron\version is Electron's version and is never the editor version.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { readFileVersion, shortEditorVersion } from './peversion.mjs';
import { windowsExe } from './private-file.mjs';

export const EXE_NAME = 'Douyin AR.exe';

function api(platform) {
  return platform === 'win32' ? path.win32 : path;
}

export function defaultCandidates({ env = process.env, platform = process.platform } = {}) {
  const join = api(platform).join;
  const local = env.XIANGSU_LOCALAPPDATA || env.LOCALAPPDATA;
  const roots = [
    local && join(local, 'Douyin AR'),
    env.ProgramFiles && join(env.ProgramFiles, 'Douyin AR'),
    env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Douyin AR'),
  ];
  return roots.filter(Boolean);
}

export function layoutFromRoot(root, { platform = process.platform, exists = fs.existsSync } = {}) {
  const join = api(platform).join;
  const resources = join(root, 'Resources');
  const electronExe = join(root, 'electron', EXE_NAME);
  const topExe = join(root, EXE_NAME);
  if (exists(electronExe) && exists(resources)) {
    return { productRoot: root, exe: electronExe, resources, layout: 'electron-subdir' };
  }
  // electron\Resources belongs to Electron. The editor's Resources directory is the parent.
  if (api(platform).basename(root).toLowerCase() === 'electron' && exists(topExe)) {
    const parent = layoutFromRoot(api(platform).dirname(root), { platform, exists });
    if (parent) return parent;
  }
  if (exists(topExe) && exists(resources)) {
    return { productRoot: root, exe: topExe, resources, layout: 'product-root' };
  }
  return null;
}

export function userPluginRoot(localAppData, shortVersion, platform = process.platform) {
  if (!localAppData) throw Error('LOCALAPPDATA_UNSET: set LOCALAPPDATA or XIANGSU_LOCALAPPDATA');
  if (!/^\d+\.\d+\.\d+$/.test(shortVersion)) throw Error(`EDITOR_VERSION_UNKNOWN: ${shortVersion}`);
  return api(platform).join(localAppData, 'DouyinAR', 'Plugins', `v${shortVersion}`, 'Local');
}

function localAppDataOf(env, platform) {
  if (env.XIANGSU_LOCALAPPDATA) return env.XIANGSU_LOCALAPPDATA;
  if (env.LOCALAPPDATA) return env.LOCALAPPDATA;
  if (platform === 'win32' && env.USERPROFILE) return api(platform).join(env.USERPROFILE, 'AppData', 'Local');
  return null;
}

function rootFromExe(exe, platform) {
  const parent = api(platform).dirname(exe);
  if (api(platform).basename(parent).toLowerCase() === 'electron') return api(platform).dirname(parent);
  return parent;
}

export function discoverEditor({
  env = process.env,
  platform = process.platform,
  exists = fs.existsSync,
  readVersion = readFileVersion,
  runningExes = null,
  candidates = null,
} = {}) {
  const checked = [];
  const consider = (root, source) => {
    checked.push(`${source}: ${root}`);
    const layout = layoutFromRoot(root, { platform, exists });
    if (!layout) return null;
    const fileVersion = readVersion(layout.exe);
    const { short, file } = shortEditorVersion(fileVersion);
    const localAppData = localAppDataOf(env, platform);
    return {
      ...layout,
      fileVersion: file,
      version: short,
      pluginRoot: userPluginRoot(localAppData, short, platform),
      source,
      ignoredElectronVersion: true,
    };
  };

  if (env.XIANGSU_EDITOR_EXE) {
    const found = consider(rootFromExe(env.XIANGSU_EDITOR_EXE, platform), 'XIANGSU_EDITOR_EXE');
    if (!found) {
      throw Error(`EDITOR_NOT_FOUND: XIANGSU_EDITOR_EXE=${env.XIANGSU_EDITOR_EXE} is not a product root with Resources (electron\\version is not the editor version)`);
    }
    return { ...found, checked };
  }
  if (env.XIANGSU_EDITOR_ROOT) {
    const found = consider(env.XIANGSU_EDITOR_ROOT, 'XIANGSU_EDITOR_ROOT');
    if (!found) {
      throw Error(
        `EDITOR_LAYOUT_UNKNOWN: ${env.XIANGSU_EDITOR_ROOT} needs ${EXE_NAME} and a sibling Resources directory (electron subfolder is accepted). electron\\version is not the editor version.`,
      );
    }
    return { ...found, checked };
  }

  const running = runningExes ?? (platform === 'win32' ? runningEditorExes() : []);
  for (const exe of running) {
    const found = consider(rootFromExe(exe, platform), 'running-process');
    if (found) return { ...found, checked };
  }
  for (const root of candidates ?? defaultCandidates({ env, platform })) {
    const found = consider(root, 'candidate');
    if (found) return { ...found, checked };
  }
  throw Error(`EDITOR_NOT_FOUND: ${checked.join('; ') || 'no candidates'}. Set XIANGSU_EDITOR_ROOT to the product root that contains Resources.`);
}

export function runningEditorExes({ execFile = execFileSync, platform = process.platform, env, existsSync, systemRoot } = {}) {
  if (platform !== 'win32') return [];
  let exe;
  try {
    exe = windowsExe('powershell.exe', { env, existsSync, systemRoot });
  } catch {
    return [];
  }
  const script = `Get-CimInstance Win32_Process | Where-Object { $_.Name -in @('Douyin AR.exe','orionkit.exe') -and $_.ExecutablePath } | ForEach-Object { $_.ExecutablePath }`;
  try {
    const stdout = execFile(exe, ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return [...new Set(String(stdout).split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
  } catch {
    return [];
  }
}

export function bootstrapEditor({
  env = process.env,
  platform = process.platform,
  discover = discoverEditor,
  spawn: childSpawn = spawn,
  execFile = execFileSync,
  windowsExe: getWindowsExe = windowsExe,
  minimized = true,
  existsSync,
  systemRoot,
} = {}) {
  const editor = discover({ env, platform });
  if (!editor || !editor.exe) {
    throw Error('BOOTSTRAP_FAILED: editor executable could not be discovered');
  }
  const exe = editor.exe;
  if (platform === 'win32' && minimized) {
    if (env?.SSH_CONNECTION || env?.SSH_CLIENT) {
      try {
        const schtasks = getWindowsExe('schtasks.exe', { env, existsSync, systemRoot });
        const taskName = 'XiangsuColdStart';
        execFile(schtasks, ['/create', '/tn', taskName, '/tr', `"${exe}"`, '/sc', 'ONCE', '/st', '23:59', '/f'], {
          windowsHide: true,
          timeout: 5000,
        });
        execFile(schtasks, ['/run', '/tn', taskName], {
          windowsHide: true,
          timeout: 5000,
        });
        return { action: 'spawned', exe, minimized: true, method: 'schtasks-session-penetrate' };
      } catch {
        // Fall back to PowerShell
      }
    }
    let psExe;
    try {
      psExe = getWindowsExe('powershell.exe', { env, existsSync, systemRoot });
    } catch {
      psExe = null;
    }
    if (psExe) {
      try {
        const escaped = exe.replace(/'/g, "''");
        const script = `Start-Process -FilePath '${escaped}' -WindowStyle Minimized`;
        execFile(psExe, ['-NoProfile', '-NonInteractive', '-Command', script], {
          encoding: 'utf8',
          windowsHide: true,
          timeout: 10000,
        });
        return { action: 'spawned', exe, minimized: true, method: 'powershell-minimized' };
      } catch {
        // Fall back to direct detached spawn if powershell invocation fails
      }
    }
  }
  const child = childSpawn(exe, [], {
    detached: true,
    stdio: 'ignore',
    windowsHide: minimized,
  });
  if (child && typeof child.unref === 'function') {
    child.unref();
  }
  return { action: 'spawned', exe, pid: child?.pid, minimized: false, method: 'spawn-detached' };
}
