# Language Boundary Convention

## Primary Language: TypeScript

TypeScript is the **primary and default language** for all packages in this repository:

- **Domain logic** (`packages/domain/`) — deterministic rule engine, SOP evaluation
- **Backend Lambda handlers** (`packages/backend/`) — all runtime Lambda functions
- **Infrastructure as Code** (`infra/`) — AWS CDK in TypeScript
- **Frontend** (`packages/frontend/`) — React/TS SPA
- **Shared schemas** (`packages/shared-schemas/`) — types, enums, contracts
- **RAG/AI integration** (`packages/rag/`) — Bedrock adapter, composers
- **Configuration** (`packages/config/`) — ConfigProvider implementations

## Property-Based Testing Library

- **TypeScript packages**: `fast-check` is the PBT library (minimum 100 iterations per property)
- Each property test is labeled: `Feature: city-response-commander, Property {n}: {text}`

## Allowed Python Boundary

A package MAY contain Python source **only** under the following narrow conditions:

1. The package is an **explicitly designated Python Lambda** — a Lambda function handler authored in Python because a specific AWS SDK feature or library is only available in Python.
2. The Python code resides in a **dedicated directory** (e.g., `tooling/python/` or a separate package like `packages/python-lambda-xyz/`).
3. The Python boundary **must mirror** all property-based tests with **Hypothesis** (Python PBT library), ensuring equivalent correctness coverage.
4. A `pyproject.toml` must exist at the Python boundary root declaring `hypothesis` as a dev dependency.

## Prohibited: Mixed-Language Packages

A single package (any directory under `packages/` or `infra/`) **MUST NOT** mix TypeScript (`.ts`/`.tsx`) and Python (`.py`) source files in the same package.

This is enforced by a CI check (`scripts/check-language-boundary.ts`) that:
- Scans each package directory
- Detects the presence of both `.ts`/`.tsx` files AND `.py` files
- Fails the build if any package contains both languages

## Rationale

- Keeps the toolchain unambiguous: one `tsconfig.json` per package, one test runner per package
- Prevents confusion about which PBT library (`fast-check` vs `Hypothesis`) applies
- Ensures the deterministic/Bedrock boundary (design section 9) is enforced in a single-language rule engine
- Simplifies CI: TypeScript packages use `vitest` + `fast-check`; Python boundaries use `pytest` + `hypothesis`

## Current Status

As of this commit, **no Python boundary exists**. All packages are TypeScript-only. If a Python boundary is introduced in the future, it must follow the conditions above and include `tooling/python/pyproject.toml`.
