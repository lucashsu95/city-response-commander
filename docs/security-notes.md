# Security Notes: No-Credentials-In-Repo Policy

## Rule

No AWS account IDs, region literals, access keys, secret keys, or any other
credentials shall be hard-coded in source files. All such values MUST come from
the `ConfigProvider` interface (§23 of the design document).

## What MUST come from ConfigProvider

| Value              | Config Key                                                    | Source                         |
| ------------------ | ------------------------------------------------------------- | ------------------------------ |
| AWS Region         | `bedrock.region`                                              | SSM / config.local.yaml        |
| Bedrock Model ID   | `bedrock.model_id`                                            | SSM / config.local.yaml        |
| Embedding Model ID | `bedrock.embedding_model_id`                                  | SSM / config.local.yaml        |
| Knowledge Base ID  | `kb.knowledge_base_id`                                        | SSM / config.local.yaml        |
| S3 Bucket Names    | `s3.raw_bucket`, `s3.sop_source_bucket`, `s3.artifact_bucket` | SSM / config.local.yaml        |
| API Endpoint       | `api.endpoint`                                                | SSM / config.local.yaml        |
| WebSocket Endpoint | `ws.endpoint`                                                 | SSM / config.local.yaml        |
| Cognito User Pool  | `auth.user_pool_id`                                           | SSM / config.local.yaml        |
| Account ID         | Never in code                                                 | CDK context / deploy-time only |

## What is NEVER committed

- `.env` files (gitignored)
- `*.pem`, `*.key` files (gitignored)
- `credentials*` files (gitignored)
- `.aws/` directory (gitignored)
- Any string matching `AKIA[0-9A-Z]{16}` (AWS access key pattern)
- Any plaintext password or secret value

## Enforcement Mechanisms

1. **`.gitignore`**: Blocks common credential files from being tracked.
2. **`scripts/check-no-credentials.sh`**: Scans source for credential patterns.
   - Run manually: `./scripts/check-no-credentials.sh`
   - Run on staged files: `./scripts/check-no-credentials.sh --staged`
3. **Tracked pre-commit hook** (`.githooks/pre-commit`): Runs the staged-file scan.
   Activate it once per clone with `git config core.hooksPath .githooks`.
4. **CI secret scan** (`.github/workflows/ci.yml`): Runs the same scanner so the
   guard remains mandatory even when a local hook is not configured.
5. **Scanner regression test** (`scripts/test/check-no-credentials.test.ts`): Proves a
   generated key-like fixture is rejected and a clean fixture passes.

## Secrets Management

- Runtime secrets go to **AWS Secrets Manager** (never Parameter Store).
- Non-secret config goes to **SSM Parameter Store** (AWS) or `config.local.yaml` (LOCAL_MOCK).
- Logs MUST NOT contain credential values; reference secrets by key name only.
- On retrieval failure: fail-closed (no plaintext fallback).

## Environment Profiles

| Profile          | Config Source              | Credentials                   |
| ---------------- | -------------------------- | ----------------------------- |
| LOCAL_MOCK       | `config/config.local.yaml` | None required                 |
| PERSONAL_AWS_DEV | SSM Parameter Store        | IAM role / env vars at deploy |
| COMPETITION_AWS  | SSM Parameter Store        | IAM role / env vars at deploy |

All three profiles share the same config schema via `ConfigProvider`; only the
provider implementation differs. Switching profiles requires zero code changes.
