// Cross-process reservation for project_new. The lock file lives in the state
// directory. It is never a file inside the user's project, and releasing or
// replacing a stale lock does not delete the target directory.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function pidIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    if (e.code === 'EPERM') return true;
    return false;
  }
}

function lockPath(stateRoot, abs) {
  const id = crypto.createHash('sha256').update(String(abs).toLowerCase()).digest('hex');
  return path.join(stateRoot, 'target-locks', `${id}.lock`);
}

export function claimTarget(abs, { stateRoot, isPidAlive = pidIsAlive } = {}) {
  if (!stateRoot) throw Error('TARGET_LOCK_UNSET');
  const dir = path.dirname(lockPath(stateRoot, abs));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = lockPath(stateRoot, abs);
  const body = JSON.stringify({ pid: process.pid, target: abs, createdAt: Date.now() });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      fs.writeFileSync(fd, body);
      fs.closeSync(fd);
      return { file, pid: process.pid, target: abs };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let existing = null;
      try {
        existing = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        existing = null;
      }
      const pid = Number(existing?.pid);
      let alive = false;
      if (Number.isInteger(pid) && pid > 0) {
        try {
          alive = isPidAlive(pid);
        } catch (err) {
          throw Error(`TARGET_LOCK_UNCONFIRMED: ${abs} (${err.message})`);
        }
      }
      if (alive && pid === process.pid) return { file, pid, target: abs, reentrant: true };
      if (alive) throw Error(`TARGET_LOCKED: ${abs} is reserved by pid ${pid}`);
      fs.rmSync(file, { force: true });
    }
  }
  throw Error(`TARGET_LOCKED: ${abs}`);
}

export function releaseTarget(claim) {
  if (!claim?.file || claim.reentrant) return;
  try {
    const existing = JSON.parse(fs.readFileSync(claim.file, 'utf8'));
    if (Number(existing.pid) !== process.pid) return;
  } catch {
    return;
  }
  fs.rmSync(claim.file, { force: true });
}
