/**
 * Lint-rule unit test: no-llm-prohibited-field-write
 *
 * Positive fixture: renderer/rag module writing to a core field → error.
 * Negative fixture: renderer/rag module writing to an allowed field → no error.
 * Negative fixture: non-renderer module writing to a core field → no error (rule doesn't apply).
 */
import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

describe('ESLint local-rules/no-llm-prohibited-field-write', () => {
  const fixtureDir = join(ROOT, 'packages', 'ai-generator', 'src', '__lint_fixtures__');

  // Set up and tear down fixture files
  function lintFixture(code: string, filename: string): string {
    mkdirSync(fixtureDir, { recursive: true });
    const filePath = join(fixtureDir, filename);
    writeFileSync(filePath, code, 'utf-8');
    try {
      const result = execSync(
        `npx eslint --no-eslintrc -c .eslintrc.cjs "${filePath}" --format json`,
        { cwd: ROOT, encoding: 'utf-8', timeout: 30000 },
      );
      return result;
    } catch (err: unknown) {
      // ESLint exits with non-zero when there are errors
      return (err as { stdout?: string }).stdout || '';
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  }

  it('should error when a renderer module writes to core_hash (positive fixture)', () => {
    const code = `
const result: any = {};
result.core_hash = 'injected';
`;
    const output = lintFixture(code, 'bad-core-write.ts');
    const parsed = JSON.parse(output);
    const messages = parsed[0]?.messages || [];
    const prohibited = messages.filter(
      (m: { ruleId: string }) => m.ruleId === 'local-rules/no-llm-prohibited-field-write',
    );
    expect(prohibited.length).toBeGreaterThan(0);
    expect(prohibited[0].message).toContain('core_hash');
  });

  it('should error when a renderer module writes to triggered_articles (positive fixture)', () => {
    const code = `
const decision: any = {};
decision.triggered_articles = [1, 2];
`;
    const output = lintFixture(code, 'bad-triggered-write.ts');
    const parsed = JSON.parse(output);
    const messages = parsed[0]?.messages || [];
    const prohibited = messages.filter(
      (m: { ruleId: string }) => m.ruleId === 'local-rules/no-llm-prohibited-field-write',
    );
    expect(prohibited.length).toBeGreaterThan(0);
    expect(prohibited[0].message).toContain('triggered_articles');
  });

  it('should error on computed and update writes to prohibited fields', () => {
    const code = `
const decision: any = { version: 1 };
decision['ete'] = { ete_minutes: 10 };
decision.schema_version++;
`;
    const output = lintFixture(code, 'bad-computed-write.ts');
    const parsed = JSON.parse(output);
    const prohibited = (parsed[0]?.messages || []).filter(
      (m: { ruleId: string }) => m.ruleId === 'local-rules/no-llm-prohibited-field-write',
    );
    expect(prohibited).toHaveLength(2);
  });

  it('should NOT error when a renderer module writes to an allowed text field (negative fixture)', () => {
    const code = `
const narrative: any = {};
narrative.report_text = 'This is fine';
narrative.explanation_text = 'Also fine';
`;
    const output = lintFixture(code, 'good-text-write.ts');
    const parsed = JSON.parse(output);
    const messages = parsed[0]?.messages || [];
    const prohibited = messages.filter(
      (m: { ruleId: string }) => m.ruleId === 'local-rules/no-llm-prohibited-field-write',
    );
    expect(prohibited.length).toBe(0);
  });

  it('should NOT error when a domain module writes to core fields (rule only applies to rag/ai-generator)', () => {
    // We lint a file that's NOT in ai-generator or rag
    const domainFixtureDir = join(ROOT, 'packages', 'domain', 'src', '__lint_fixtures__');
    mkdirSync(domainFixtureDir, { recursive: true });
    const filePath = join(domainFixtureDir, 'domain-core-write.ts');
    const code = `
const core: any = {};
core.core_hash = 'computed-hash';
core.triggered_articles = [1, 2];
`;
    writeFileSync(filePath, code, 'utf-8');
    try {
      let output: string;
      try {
        output = execSync(`npx eslint --no-eslintrc -c .eslintrc.cjs "${filePath}" --format json`, {
          cwd: ROOT,
          encoding: 'utf-8',
          timeout: 30000,
        });
      } catch (err: unknown) {
        output = (err as { stdout?: string }).stdout || '';
      }
      const parsed = JSON.parse(output);
      const messages = parsed[0]?.messages || [];
      const prohibited = messages.filter(
        (m: { ruleId: string }) => m.ruleId === 'local-rules/no-llm-prohibited-field-write',
      );
      expect(prohibited.length).toBe(0);
    } finally {
      rmSync(domainFixtureDir, { recursive: true, force: true });
    }
  });
});
