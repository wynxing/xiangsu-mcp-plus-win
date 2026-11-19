import { claimTarget, releaseTarget } from '../src/target-lock.mjs';

const [stateRoot, target, holdMs] = process.argv.slice(2);
try {
  const claim = claimTarget(target, { stateRoot });
  process.stdout.write('claimed\n');
  await new Promise((resolve) => setTimeout(resolve, Number(holdMs) || 0));
  releaseTarget(claim);
  process.stdout.write('released\n');
} catch (e) {
  process.stdout.write(`error ${e.message}\n`);
  process.exitCode = 2;
}
