import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..');
const verifier = join(root, 'scripts', 'verify_sources.sh');
const temporaryDirectories: string[] = [];

function fixture(): { directory: string; manifest: string; filenames: string[] } {
  const directory = mkdtempSync(join(tmpdir(), 'source-hash-gate-'));
  temporaryDirectories.push(directory);
  const filenames = Array.from({ length: 7 }, (_, index) => `official-${index + 1}.dat`);
  const lines = filenames.map((filename, index) => {
    const content = `known-good-${index + 1}\n`;
    writeFileSync(join(directory, filename), content, 'utf8');
    return `${createHash('sha256').update(content).digest('hex').toUpperCase()}|${filename}`;
  });
  const manifest = join(directory, 'manifest.txt');
  writeFileSync(manifest, `${lines.join('\n')}\n`, 'utf8');
  return { directory, manifest, filenames };
}

function bashCompatiblePath(path: string): string {
  return process.platform === 'win32' ? path.replace(/\\/g, '/') : path;
}

function verify(directory: string, manifest: string): string {
  return execFileSync(
    'bash',
    [verifier, '--manifest-test-only', bashCompatiblePath(manifest), bashCompatiblePath(directory)],
    {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, VERIFY_SOURCES_TEST_MANIFEST: '1' },
    },
  );
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('source hash gate', () => {
  it('passes a known-good seven-file fixture', () => {
    const { directory, manifest } = fixture();

    expect(verify(directory, manifest)).toContain('SOURCE HASH GATE: PASS (7/7)');
  });

  it('STOPs and names an altered source', () => {
    const { directory, manifest, filenames } = fixture();
    writeFileSync(join(directory, filenames[3]), 'altered\n', 'utf8');

    expect(() => verify(directory, manifest)).toThrow(/SHA-256 mismatch: official-4\.dat/);
  });

  it('rejects a manifest override unless the test-only gate is explicit', () => {
    const { directory, manifest } = fixture();

    expect(() =>
      execFileSync('bash', [verifier, '--manifest-test-only', manifest, directory], {
        cwd: root,
        encoding: 'utf8',
        env: { ...process.env, VERIFY_SOURCES_TEST_MANIFEST: '' },
      }),
    ).toThrow(/manifest override is disabled/);
  });
});
