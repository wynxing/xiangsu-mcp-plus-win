#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dest = path.join(root, 'release');
fs.mkdirSync(dest, { recursive: true });
for (const name of fs.readdirSync(dest)) {
  if (name.endsWith('.tgz') || name.endsWith('.sha256')) fs.rmSync(path.join(dest, name));
}
const npmCli = process.env.npm_execpath;
if (npmCli) execFileSync(process.execPath, [npmCli, 'pack', '--pack-destination', dest], { cwd: root, stdio: 'inherit' });
else execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['pack', '--pack-destination', dest], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
for (const name of fs.readdirSync(dest).filter((file) => file.endsWith('.tgz'))) {
  const body = fs.readFileSync(path.join(dest, name));
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  fs.writeFileSync(path.join(dest, `${name}.sha256`), `${digest}  ${name}\n`);
  process.stdout.write(`${digest}  ${name}\n`);
}
