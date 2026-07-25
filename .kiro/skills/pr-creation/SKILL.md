---
name: pr-creation
description: Automated PR creation workflow for city-response-commander. Use when creating pull requests after completing tasks. Enforces PR template, task linking, and branch conventions.
---

# PR Creation Workflow — City Response Commander

## When to Use

- After completing a Kiro spec task
- After implementing a feature or fix
- When ready to merge changes to main

## Workflow Steps

### 1. Pre-PR Checklist

Before creating PR, verify:

```bash
# Run all checks
npm run typecheck
npm run lint
npm run format:check
npm test
```

### 2. Commit Changes

Use Conventional Commits format:

```bash
git add <changed-files>
git commit -m "feat(scope): description"

# Examples:
git commit -m "feat(domain): implement SOP-3 MRT shuttle trigger"
git commit -m "fix(frontend): correct ETE display precision"
git commit -m "test(backend): add unit tests for inject handler"
```

### 3. Push to GitHub

```bash
git push -u origin <branch-name>
```

### 4. Create PR

Use GitHub CLI or web interface:

```bash
# Using GitHub CLI
gh pr create --title "feat: Your Title" --body-file .github/pull_request_template.md
```

## PR Description Template

Kiro MUST use this format when creating PRs:

```markdown
# Summary

<one-line description of what this PR does>

## Changes

- <change 1>
- <change 2>

## Task Reference

Closes TASK-XXX

## Testing

- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] `npm run format:check` passes
- [ ] `npm test` passes
- [ ] Manual testing completed

## Evidence

<test results, screenshots, or logs if needed>

## Notes

<anything reviewers should know>
```

## Branch Naming Convention

| Prefix | Use Case |
|--------|----------|
| `feat/` | New feature |
| `fix/` | Bug fix |
| `docs/` | Documentation |
| `refactor/` | Code refactoring |
| `test/` | Test additions |
| `chore/` | Maintenance |

## Task Reference Format

Always link PR to task:

```
Closes TASK-XXX
```

Or reference multiple tasks:

```
Closes TASK-001, TASK-002
```

## Example PR Creation

```bash
# 1. Ensure on latest main
git checkout main
git pull origin main

# 2. Create feature branch
git checkout -b feat/sop3-mrt-shuttle

# 3. Make changes and commit
git add packages/domain/src/sop3-mrt.ts
git commit -m "feat(domain): implement SOP-3 MRT shuttle trigger"

# 4. Push
git push -u origin feat/sop3-mrt-shuttle

# 5. Create PR
gh pr create \
  --title "feat(domain): implement SOP-3 MRT shuttle trigger" \
  --body "# Summary
Implement SOP-3 MRT shuttle evacuation trigger logic

## Changes
- Added sop3-mrt.ts with trigger logic
- Added unit tests for condition evaluation

## Task Reference
Closes TASK-027

## Testing
- [x] npm run typecheck passes
- [x] npm run lint passes
- [x] npm test passes

## Evidence
All 8 unit tests pass.

## Notes
None"
```

## Code Review Requirements

Before PR can be merged:

- [ ] At least 1 reviewer approval
- [ ] All CI checks pass
- [ ] No merge conflicts

## Code Ownership

Based on `docs/team-roles.md`:

| Path | Owner | Required Reviewer |
|------|-------|-------------------|
| `packages/shared-schemas/` | Member 1 | Member 1 |
| `packages/domain/src/` | Member 1 | Member 1 |
| `packages/backend/src/` | Member 2 | Member 2 |
| `packages/rag/` | Member 4 | Member 4 |
| `packages/frontend/` | Member 5 | Member 5 |
| `infra/` | Member 3 | Member 3 |

## Common Mistakes

### DON'T

```bash
# Wrong: Push directly to main
git push origin main  # ❌ BLOCKED

# Wrong: Non-conventional commit
git commit -m "update code"  # ❌ Missing type

# Wrong: PR without task reference
gh pr create --title "fix stuff"  # ❌ No task link
```

### DO

```bash
# Correct: Feature branch with conventional commit
git checkout -b feat/my-feature
git commit -m "feat(domain): implement SOP-3 shuttle route"
git push -u origin feat/my-feature
gh pr create --title "feat: implement SOP-3" --body "Closes TASK-027"
```

## Integration with Hooks

The following hooks support this workflow:

- `pre-commit-check`: Runs typecheck/lint before commit
- `validate-pr-branch`: Ensures branch naming convention
- `post-task-pr-reminder`: Reminds to create PR after task

## Troubleshooting

### CI Fails

1. Check GitHub Actions logs
2. Run checks locally:
   ```bash
   npm run typecheck
   npm run lint
   npm run format:check
   npm test
   ```
3. Fix issues and push again

### Branch Protected

- Cannot push directly to main
- Must create PR
- Need reviewer approval

### Task Not Linked

- Add `Closes TASK-XXX` to PR description
- Reference all related tasks
