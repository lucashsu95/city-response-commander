/**
 * CI check: ensures no package mixes TypeScript and Python source files.
 *
 * A package is any immediate subdirectory of `packages/` or the `infra/` directory.
 * If both .ts/.tsx files AND .py files are found within the same package (recursively,
 * excluding node_modules and dist), the check fails with exit code 1.
 *
 * Usage: npx tsx scripts/check-language-boundary.ts
 */

import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '..');
const PACKAGES_DIR = path.join(ROOT, 'packages');
const INFRA_DIR = path.join(ROOT, 'infra');

const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git', 'cdk.out']);

interface ScanResult {
  hasTypeScript: boolean;
  hasython: boolean;
  tsFiles: string[];
  pyFiles: string[];
}

function scanDirectory(dir: string): ScanResult {
  const result: ScanResult = {
    hasTypeScript: false,
    hasython: false,
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
          result.tsFiles.push(path.relative(ROOT, fullPath));
        } else if (ext === '.py') {
          result.hasython = true;
          result.pyFiles.push(path.relative(ROOT, fullPath));
        }
      }
    }
  }

  walk(dir);
  return result;
}

function getPackageDirs(): string[] {
  const dirs: string[] = [];

  // All immediate subdirectories of packages/
  if (fs.existsSync(PACKAGES_DIR)) {
    const entries = fs.readdirSync(PACKAGES_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && !EXCLUDED_DIRS.has(entry.name)) {
        dirs.push(path.join(PACKAGES_DIR, entry.name));
      }
    }
  }

  // infra/ as a single package
  if (fs.existsSync(INFRA_DIR)) {
    dirs.push(INFRA_DIR);
  }

  return dirs;
}

export function checkLanguageBoundary(): {
  passed: boolean;
  violations: { packageName: string; tsFiles: string[]; pyFiles: string[] }[];
} {
  const packageDirs = getPackageDirs();
  const violations: {
    packageName: string;
    tsFiles: string[];
    pyFiles: string[];
  }[] = [];

  for (const dir of packageDirs) {
    const packageName = path.relative(ROOT, dir);
    const result = scanDirectory(dir);

    if (result.hasTypeScript && result.hasython) {
      violations.push({
        packageName,
        tsFiles: result.tsFiles,
        pyFiles: result.pyFiles,
      });
    }
  }

  return { passed: violations.length === 0, violations };
}

// Run as CLI
if (require.main === module) {
  const { passed, violations } = checkLanguageBoundary();

  if (passed) {
    console.log('✓ Language boundary check passed: no package mixes TypeScript and Python.');
    process.exit(0);
  } else {
    console.error(
      '✗ Language boundary check FAILED: the following packages mix TypeScript and Python sources:',
    );
    for (const v of violations) {
      console.error(`\n  Package: ${v.packageName}`);
      console.error(
        `    TypeScript files (${v.tsFiles.length}): ${v.tsFiles.slice(0, 3).join(', ')}${v.tsFiles.length > 3 ? '...' : ''}`,
      );
      console.error(
        `    Python files (${v.pyFiles.length}): ${v.pyFiles.slice(0, 3).join(', ')}${v.pyFiles.length > 3 ? '...' : ''}`,
      );
    }
    console.error('\nA single package must not contain both .ts/.tsx and .py files.');
    console.error('See docs/language-boundary.md for the convention.');
    process.exit(1);
  }
}
