// Project path identity. Windows comparisons are case-insensitive and separator-insensitive.
import fs from 'node:fs';
import path from 'node:path';

export function pathApi(platform = process.platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

export function normalizePath(input, { platform = process.platform, realpathSync = fs.realpathSync } = {}) {
  if (typeof input !== 'string') throw Error('INVALID_PATH');
  const trimmed = input.trim().normalize('NFC');
  if (!trimmed) throw Error('INVALID_PATH');
  const api = pathApi(platform);
  let resolved = platform === 'win32' ? trimmed.replace(/\//g, '\\') : trimmed;
  if (!api.isAbsolute(resolved)) throw Error(`INVALID_PATH: not absolute: ${input}`);
  resolved = api.normalize(resolved);
  if (platform === 'win32') {
    if (!/^[A-Za-z]:\\$/.test(resolved) && resolved.endsWith('\\')) resolved = resolved.slice(0, -1);
  } else if (resolved.length > 1 && resolved.endsWith('/')) {
    resolved = resolved.slice(0, -1);
  }
  if (platform === process.platform) {
    try {
      resolved = realpathSync(resolved);
    } catch {
      // Missing and not-yet-saved projects still need a stable identity.
    }
  }
  return resolved.normalize('NFC');
}

export function samePath(a, b, opts) {
  const platform = opts?.platform ?? process.platform;
  const left = normalizePath(a, opts);
  const right = normalizePath(b, opts);
  return platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

// `child` is the same folder as `parent` or a descendant. Used by the optional deny list.
export function pathInside(child, parent, opts) {
  const platform = opts?.platform ?? process.platform;
  const api = pathApi(platform);
  const c = normalizePath(child, opts);
  const p = normalizePath(parent, opts);
  const cl = platform === 'win32' ? c.toLowerCase() : c;
  const pl = platform === 'win32' ? p.toLowerCase() : p;
  if (cl === pl) return true;
  const prefix = pl.endsWith(api.sep) ? pl : pl + api.sep;
  return cl.startsWith(prefix);
}
