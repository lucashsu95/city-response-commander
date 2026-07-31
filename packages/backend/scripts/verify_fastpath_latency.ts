/**
 * `tsx` entry point for the Fast Path latency SLA gate (TASK-105).
 *
 * Intentionally trivial. All logic, and all of its tests, live in
 * `src/observability/verify_fastpath_latency.ts`, which `tsc --build` and
 * `eslint` cover — this directory is outside both.
 *
 * ```bash
 * tsx packages/backend/scripts/verify_fastpath_latency.ts --input latency.json
 * ```
 */

import { readFile } from 'node:fs/promises';
import { main } from '../src/observability/verify_fastpath_latency.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

// No top-level await: `packages/backend` is not `"type": "module"`, so tsx
// transforms this file to CJS, where top-level await is a hard error.
async function run(): Promise<void> {
  const result = await main(process.argv.slice(2), process.env, {
    readFile: (path: string) => readFile(path, 'utf8'),
    readStdin,
  });

  if (result.stdout.length > 0) process.stdout.write(`${result.stdout}\n`);
  if (result.stderr.length > 0) process.stderr.write(`${result.stderr}\n`);
  process.exitCode = result.exitCode;
}

void run();
