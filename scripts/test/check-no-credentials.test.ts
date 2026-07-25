import { execFileSync } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const scanner = join(root, 'scripts', 'check-no-credentials.sh');

describe.sequential('no-credentials repository scanner', () => {
  it('passes for the repository without a credential fixture', () => {
    expect(() => execFileSync('bash', [scanner], { cwd: root, stdio: 'pipe' })).not.toThrow();
  });

  it('rejects a generated AWS access-key fixture', () => {
    const fixture = join(root, '.credential-scan-positive-fixture.ts');
    const keyLikeValue = `AKIA${'A'.repeat(16)}`;
    writeFileSync(fixture, `export const leaked = '${keyLikeValue}';\n`, 'utf8');

    try {
      expect(() => execFileSync('bash', [scanner], { cwd: root, stdio: 'pipe' })).toThrow();
    } finally {
      rmSync(fixture, { force: true });
    }
  });
});
