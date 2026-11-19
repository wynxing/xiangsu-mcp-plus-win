// Restrict a token file or its directory to the current user.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

export function restrictPrivate(target, { platform = process.platform, execFile = execFileSync } = {}) {
  const stat = fs.statSync(target);
  if (platform !== 'win32') {
    const mode = stat.isDirectory() ? 0o700 : 0o600;
    fs.chmodSync(target, mode);
    return { method: 'chmod', mode };
  }
  let user;
  try {
    user = execFile('whoami', [], { encoding: 'utf8', windowsHide: true }).trim();
  } catch (e) {
    throw Error(`ACL_FAILED: ${e.message}`);
  }
  if (!/^[^\r\n"]+$/.test(user) || user.includes('%')) throw Error('ACL_USER_UNSAFE');
  const grant = stat.isDirectory() ? `${user}:(OI)(CI)F` : `${user}:F`;
  try {
    execFile('icacls', [target, '/inheritance:r', '/grant:r', grant], { windowsHide: true, stdio: 'ignore' });
  } catch (e) {
    throw Error(`ACL_FAILED: ${e.message}`);
  }
  return { method: 'icacls' };
}
