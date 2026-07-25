/**
 * Unit tests for the language-boundary CI check.
 *
 * Tests use temporary fixture directories to simulate packages that:
 * - Contain only TypeScript (should pass)
 * - Contain only Python (should pass)
 * - Mix TypeScript and Python (should fail)
 * - Are empty (should pass)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// We test the scanning logic directly by importing and adapting the core function
// Since the main script uses ROOT-relative paths, we replicate the scan logic here.

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git', 'cdk.out']);

interface ScanResult {
  hasTypeScript: boolean;
  hasPython: boolean;
  tsFiles: string[];
  pyFiles: string[];
}

function scanDirectory(dir: string): ScanResult {
  const result: ScanResult = {
    hasTypeScript: false,
    hasPython: false,
    tsFiles: [],
    pyFiles: [],
  };

  function walk(currentDir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.ts' || ext === '.tsx') {
          result.hasTypeScript = true;
          result.tsFiles.push(fullPath);
        } else if (ext === '.py') {
          result.hasPython = true;
          result.pyFiles.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return result;
}

function checkPackages(packageDirs: string[]): {
  passed: boolean;
  violations: { packageName: string; tsFiles: string[]; pyFiles: string[] }[];
} {
  const violations: {
    packageName: string;
    tsFiles: string[];
    pyFiles: string[];
  }[] = [];

  for (const dir of packageDirs) {
    const packageName = path.basename(dir);
    const result = scanDirectory(dir);

    if (result.hasTypeScript && result.hasPython) {
      violations.push({
        packageName,
        tsFiles: result.tsFiles,
        pyFiles: result.pyFiles,
      });
    }
  }

  return { passed: violations.length === 0, violations };
}

describe('check-language-boundary', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-boundary-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('passes for a TypeScript-only package', () => {
    const pkgDir = path.join(tmpDir, 'ts-only');
    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'src', 'index.ts'), 'export {};');
    fs.writeFileSync(path.join(pkgDir, 'src', 'utils.ts'), 'export const x = 1;');

    const result = checkPackages([pkgDir]);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('passes for a Python-only package', () => {
    const pkgDir = path.join(tmpDir, 'py-only');
    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'src', 'handler.py'), 'def main(): pass');

    const result = checkPackages([pkgDir]);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('FAILS for a package mixing TypeScript and Python', () => {
    const pkgDir = path.join(tmpDir, 'mixed');
    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'src', 'index.ts'), 'export {};');
    fs.writeFileSync(path.join(pkgDir, 'src', 'helper.py'), 'x = 1');

    const result = checkPackages([pkgDir]);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].packageName).toBe('mixed');
    expect(result.violations[0].tsFiles.length).toBeGreaterThan(0);
    expect(result.violations[0].pyFiles.length).toBeGreaterThan(0);
  });

  it('FAILS for mixed languages in nested subdirectories', () => {
    const pkgDir = path.join(tmpDir, 'nested-mixed');
    fs.mkdirSync(path.join(pkgDir, 'src', 'core'), { recursive: true });
    fs.mkdirSync(path.join(pkgDir, 'src', 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'src', 'core', 'engine.ts'), 'export {};');
    fs.writeFileSync(path.join(pkgDir, 'src', 'scripts', 'migrate.py'), 'pass');

    const result = checkPackages([pkgDir]);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
  });

  it('passes for an empty package', () => {
    const pkgDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(pkgDir, { recursive: true });

    const result = checkPackages([pkgDir]);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('ignores .py files inside node_modules', () => {
    const pkgDir = path.join(tmpDir, 'with-nodemodules');
    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(pkgDir, 'node_modules', 'some-dep'), {
      recursive: true,
    });
    fs.writeFileSync(path.join(pkgDir, 'src', 'index.ts'), 'export {};');
    fs.writeFileSync(path.join(pkgDir, 'node_modules', 'some-dep', 'script.py'), 'pass');

    const result = checkPackages([pkgDir]);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('ignores .py files inside dist', () => {
    const pkgDir = path.join(tmpDir, 'with-dist');
    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(pkgDir, 'dist'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'src', 'index.ts'), 'export {};');
    fs.writeFileSync(path.join(pkgDir, 'dist', 'generated.py'), 'pass');

    const result = checkPackages([pkgDir]);
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('detects .tsx files as TypeScript', () => {
    const pkgDir = path.join(tmpDir, 'tsx-mixed');
    fs.mkdirSync(path.join(pkgDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(pkgDir, 'src', 'App.tsx'), 'export default () => <div/>;');
    fs.writeFileSync(path.join(pkgDir, 'src', 'util.py'), 'pass');

    const result = checkPackages([pkgDir]);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
  });

  it('handles multiple packages with only one violation', () => {
    const pkg1 = path.join(tmpDir, 'clean-pkg');
    const pkg2 = path.join(tmpDir, 'dirty-pkg');

    fs.mkdirSync(path.join(pkg1, 'src'), { recursive: true });
    fs.writeFileSync(path.join(pkg1, 'src', 'index.ts'), 'export {};');

    fs.mkdirSync(path.join(pkg2, 'src'), { recursive: true });
    fs.writeFileSync(path.join(pkg2, 'src', 'index.ts'), 'export {};');
    fs.writeFileSync(path.join(pkg2, 'src', 'script.py'), 'pass');

    const result = checkPackages([pkg1, pkg2]);
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].packageName).toBe('dirty-pkg');
  });
});
