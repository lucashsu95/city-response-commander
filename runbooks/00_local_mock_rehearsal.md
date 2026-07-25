# LOCAL_MOCK Offline Rehearsal

## Purpose and hard gate

Use this rehearsal before any AWS account is used. It runs the complete repository deterministic suite with the Mock Bedrock adapter and no credentials. A failed command, an attempt to select a non-mock adapter, or any AWS call is a release-blocking failure.

## Prerequisites

- Node.js 20 or another version satisfying `package.json`.
- Dependencies installed with `npm ci`.
- No AWS credentials are required. Do not source a credentials file for this rehearsal.

The script sets `CITY_COMMANDER_ENV=LOCAL_MOCK`, `NODE_ENV=local`, and `BEDROCK_ADAPTER=mock`; disables EC2 metadata and AWS shared-config loading; and removes AWS credential/profile variables from its child environment.

## Commands

Inspect the command plan without running tests:

```sh
./scripts/local_mock_rehearsal.sh --dry-run
```

Run the rehearsal:

```sh
./scripts/local_mock_rehearsal.sh 2>&1 | tee local-mock-rehearsal.log
```

The log is local evidence and is not committed. The script runs type checking, lint, formatting, the complete Vitest suite (unit, property, golden, policy-switch, and script tests), language-boundary validation, the credential scanner, and an offline Mock-Bedrock walkthrough.

## Exit criteria

Proceed only when all conditions are true:

1. The script exits with status 0.
2. Every deterministic test is green.
3. The final walkthrough says `Mock-Bedrock walkthrough passed with no AWS call.`
4. No credential is requested or loaded.
5. No AWS endpoint is called and no deployment command appears in the plan.

If any condition fails, STOP. Fix the local deterministic or adapter-selection problem and rerun the whole rehearsal. Do not compensate by enabling real Bedrock or supplying credentials.
