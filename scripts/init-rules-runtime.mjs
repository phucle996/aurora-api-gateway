// Explicit local bootstrap workflow. Never replaces a token or active snapshot.
import { randomBytes } from 'node:crypto';
import { openSync, writeFileSync, readFileSync, fsyncSync, closeSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const [relative, payload] of [
  ['control-plane/data/admin.token', randomBytes(32).toString('hex') + '\n'],
  ['build/runtime/active-policy.json', readFileSync(path.join(root, 'examples/runtime-policy.json'))],
]) {
  const target = path.join(root, relative);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  let fd;
  try { fd = openSync(target, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') continue; throw error; }
  try { writeFileSync(fd, payload); fsyncSync(fd); } finally { closeSync(fd); }
  const directory = openSync(path.dirname(target), 'r');
  try { fsyncSync(directory); } finally { closeSync(directory); }
  console.log(`Initialized ${relative} (contents not logged)`);
}
