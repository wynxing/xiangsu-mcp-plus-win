#!/usr/bin/env node
import { rollbackPlugin } from '../src/plugininstall.mjs';

function value(argv, flag) {
  const i = argv.indexOf(flag);
  return i >= 0 ? argv[i + 1] : undefined;
}

const pluginRoot = value(process.argv, '--plugin-root') || process.env.XIANGSU_PLUGIN_ROOT;
const backupDir = value(process.argv, '--backup');
try {
  if (!backupDir) throw Error('ROLLBACK_UNSET: pass --backup <install-backups stamp directory>');
  const result = rollbackPlugin({ pluginRoot, backupDir });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (e) {
  process.stderr.write(`${e.message}\n`);
  process.exitCode = 1;
}
