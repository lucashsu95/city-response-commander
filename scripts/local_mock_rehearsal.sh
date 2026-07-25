#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DRY_RUN=0

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
elif [[ $# -gt 0 ]]; then
  echo "Usage: $0 [--dry-run]" >&2
  exit 2
fi

export CITY_COMMANDER_ENV=LOCAL_MOCK
export NODE_ENV=local
export BEDROCK_ADAPTER=mock
export AWS_EC2_METADATA_DISABLED=true
export AWS_SDK_LOAD_CONFIG=0
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_PROFILE AWS_DEFAULT_PROFILE AWS_WEB_IDENTITY_TOKEN_FILE AWS_ROLE_ARN

COMMANDS=(
  "npm run typecheck"
  "npm run lint"
  "npm run format:check"
  "npm test"
  "npm run check:language-boundary"
  "npm run check:no-credentials"
  "npm run mock:bedrock-walkthrough"
)

printf 'LOCAL_MOCK rehearsal (offline, Mock Bedrock, no credentials)\n'
printf 'Working directory: %s\n' "$ROOT_DIR"

for command in "${COMMANDS[@]}"; do
  printf '%s\n' "+ $command"
  if [[ "$DRY_RUN" -eq 0 ]]; then
    (cd "$ROOT_DIR" && bash -c "$command")
  fi
done

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf 'Dry-run passed: command plan is valid; no suite or AWS command was executed.\n'
else
  printf 'LOCAL_MOCK rehearsal passed: deterministic suite and Mock-Bedrock walkthrough are green.\n'
fi
