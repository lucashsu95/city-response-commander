---
name: git-workflow
description: Git workflow conventions for city-response-commander. Use when committing code, creating branches, pushing to GitHub, or creating pull requests. Enforces Conventional Commits, branch naming, and PR-based workflow.
---

# Git Workflow — City Response Commander

## Branch Strategy

### Protected Branch

- `main` is protected — **NO direct pushes allowed**
- All changes must go through Pull Request (PR)
- PR requires **1 approval** before merge

### Branch Naming Convention

```
feat/<short-description>      # New feature
fix/<short-description>       # Bug fix
docs/<short-description>      # Documentation
refactor/<short-description>  # Code refactoring
test/<short-description>      # Test additions/changes
chore/<short-description>     # Maintenance tasks
```

### Examples

```bash
git checkout -b feat/sop3-mrt-shuttle
git checkout -b fix/ete-formula-precision
git checkout -b docs/update-demo-scenario
```

## Commit Message Format

Use [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

| Type       | When to Use                                             |
| ---------- | ------------------------------------------------------- |
| `feat`     | New feature or capability                               |
| `fix`      | Bug fix                                                 |
| `docs`     | Documentation only                                      |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test`     | Adding or updating tests                                |
| `chore`    | Build process, dependencies, configs                    |
| `style`    | Formatting, missing semicolons, etc.                    |
| `perf`     | Performance improvements                                |

### Scope (optional)

Use package name for changes within a specific package:

- `shared-schemas`
- `config`
- `domain`
- `ai-generator`
- `backend`
- `frontend`
- `infra`
- `docs`

### Language Rule

The Conventional Commits **type prefix and scope** (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `style`, `perf`, and the `(scope)` part) **stay in English exactly as documented above**. The **description** — and any body/footer prose — must be written in **Traditional Chinese (繁體中文)**.

```
<type>(<scope>): <繁體中文描述>
```

### Description Rules

- Use imperative mood (in Chinese, phrase it as a direct action, e.g. "新增" not "新增了")
- The "don't capitalize first letter" rule only applies to the English type/scope prefix — Chinese has no capitalization concept
- No period at end — this also applies to Chinese descriptions (no trailing `。`)
- Max 72 characters for subject line — this is a technical character-count limit; Chinese characters are visually wider, so a shorter character count is fine, but the same 72-character limit still applies
- The description itself must be in Traditional Chinese (繁體中文)

### Examples

```bash
git commit -m "feat(domain): 實作 SOP-3 捷運接駁疏散邏輯"
git commit -m "fix(domain): 修正 ETE 公式小數精度"
git commit -m "docs: 更新 demo 情境加入 EVT_003"
git commit -m "refactor(ai-generator): 抽取多語系模板邏輯"
git commit -m "test(domain): 新增 article2 觸發條件的 property tests"
git commit -m "chore: 更新 TypeScript 至 5.5"
```

### Multi-line Commits

For complex changes, add body and footer:

```bash
git commit -m "feat(domain): 實作受影響道路策略（Strategy B）

- 新增 AffectedRoadStrategy 類別
- 實作下游路段選取邏輯
- 處理壅塞道路排除規則

Closes #42"
```

## Workflow Steps

### 1. Start New Work

```bash
# Ensure you're on latest main
git checkout main
git pull origin main

# Create feature branch
git checkout -b feat/your-feature-name
```

### 2. During Development

```bash
# Stage changes
# Stage only the reviewed files for the current change
# Example: git add package.json package-lock.json src/changed-file.ts

git add <explicit-file-list>

# Commit with conventional format
git commit -m "feat(scope): clear description"

# Push to GitHub
git push -u origin feat/your-feature-name
```

### 3. Create Pull Request

```bash
# After pushing, GitHub will show a "Compare & pull request" button
# Or create manually:
gh pr create --title "feat: Your Feature" --body "Description of changes"
```

### 4. After PR Approved

```bash
# Merge via GitHub UI or CLI
gh pr merge <pr-number> --merge

# Clean up local branch
git checkout main
git pull origin main
git branch -d feat/your-feature-name
```

## File Organization

### What Goes Where

| File Type          | Location                       |
| ------------------ | ------------------------------ |
| Shared types/enums | `packages/shared-schemas/src/` |
| Config providers   | `packages/config/src/`         |
| Rule engine logic  | `packages/domain/src/`         |
| AI text generation | `packages/ai-generator/src/`   |
| Lambda handlers    | `packages/backend/src/`        |
| React components   | `packages/frontend/src/`       |
| CDK infrastructure | `infra/`                       |
| Documentation      | `docs/`                        |

### Test Files

- Unit tests: `packages/<name>/test/unit/`
- Property tests: `packages/<name>/test/property/`
- Integration tests: `packages/<name>/test/integration/`
- Golden tests: `packages/<name>/test/golden/`

## Pre-commit Checklist

Before committing, verify:

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] Tests pass: `npm test`
- [ ] No secrets or credentials in code
- [ ] Commit message follows Conventional Commits format

## Common Mistakes to Avoid

### DON'T

```bash
# Wrong: Direct push to main
git push origin main  # ❌ BLOCKED

# Wrong: Non-conventional commit message
git commit -m "update code"  # ❌ Missing type

# Wrong: Vague description
git commit -m "feat: fix stuff"  # ❌ Not descriptive
```

### DO

```bash
# Correct: PR-based workflow
git checkout -b feat/my-feature
git push -u origin feat/my-feature
# Then create PR on GitHub

# Correct: Conventional commit (English type/scope, Chinese description)
git commit -m "feat(domain): 實作 SOP-3 接駁路線選取邏輯"

# Correct: Descriptive scope
git commit -m "test(domain): 新增 SOP-3 OR 觸發條件的 property test P16"
```

## Integration with Kiro

When using Kiro to implement tasks:

1. **Before starting a task**: Create a feature branch
2. **After completing a task**: Commit with conventional format
3. **When task is done**: Push to GitHub
4. **Create PR**: Use `pr-creation` skill for PR workflow

See `.kiro/skills/pr-creation/SKILL.md` for detailed PR creation workflow.
