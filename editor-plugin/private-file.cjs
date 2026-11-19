'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');

function restrictPrivate(target, platform = process.platform) {
  const stat = fs.statSync(target);
  if (platform !== 'win32') {
    fs.chmodSync(target, stat.isDirectory() ? 0o700 : 0o600);
    return;
  }
  const user = execFileSync('whoami', [], { encoding: 'utf8', windowsHide: true }).trim();
  if (!/^[^\r\n"]+$/.test(user) || user.includes('%')) throw Error('ACL_USER_UNSAFE');
  const grant = stat.isDirectory() ? `${user}:(OI)(CI)F` : `${user}:F`;
  execFileSync('icacls', [target, '/inheritance:r', '/grant:r', grant], { windowsHide: true, stdio: 'ignore' });
}

module.exports = { restrictPrivate };
