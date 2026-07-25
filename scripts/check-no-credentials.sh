#!/usr/bin/env bash
# check-no-credentials.sh
#
# Pre-commit / CI guard: ensures no hard-coded credentials, account IDs,
# region literals, or key-like strings exist in tracked source files.
#
# Usage:
#   ./scripts/check-no-credentials.sh          # scan working tree
#   ./scripts/check-no-credentials.sh --staged  # scan only staged files (pre-commit hook)
#
# Exit codes:
#   0 = clean
#   1 = potential credentials or hard-coded values found

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m' # No Color

SCAN_MODE="all"
if [[ "${1:-}" == "--staged" ]]; then
  SCAN_MODE="staged"
fi

FOUND=0

# File extensions to scan
INCLUDE_EXTS="ts|js|json|yaml|yml|env|cfg|toml|sh|py|md|txt|cjs|mjs"

# Directories to exclude
EXCLUDE_DIRS="node_modules|.git|dist|build|cdk.out|coverage|.pnpm-store"

# Files to exclude from scanning (this script itself, test fixtures, etc.)
EXCLUDE_FILES="check-no-credentials\.sh|security-notes\.md"

# Patterns that indicate potential credentials or hard-coded secrets
CREDENTIAL_PATTERNS=(
  # AWS Access Keys
  'AKIA[0-9A-Z]{16}'
  # AWS Secret Keys in assignment
  'aws_secret_access_key\s*=\s*[A-Za-z0-9/+=]{20,}'
  'AWS_SECRET_ACCESS_KEY=[A-Za-z0-9/+=]{20,}'
  'aws_access_key_id\s*=\s*AKIA'
  'AWS_ACCESS_KEY_ID=AKIA'
  # Private keys
  'BEGIN (RSA|DSA|EC|OPENSSH) PRIVATE KEY'
  # Generic password assignments (8+ chars)
  'password\s*[:=]\s*["\x27][^"\x27]{8,}'
  # AWS Account IDs (12-digit numbers in suspicious contexts)
  '(account_id|accountId|ACCOUNT_ID)\s*[:=]\s*["\x27]?[0-9]{12}'
)

# Patterns for hard-coded AWS regions (should come from ConfigProvider)
HARDCODED_REGION_PATTERNS=(
  # Direct region string assignments in source code (not in docs/config examples)
  '(region|REGION)\s*[:=]\s*["\x27](us-east-1|us-west-2|ap-northeast-1|ap-southeast-1|eu-west-1|eu-central-1)["\x27]'
)

get_files() {
  if [[ "$SCAN_MODE" == "staged" ]]; then
    git diff --cached --name-only --diff-filter=ACM | grep -E "\.(${INCLUDE_EXTS})$" | grep -Ev "(${EXCLUDE_FILES})" || true
  else
    find . -type f | grep -Ev "(${EXCLUDE_DIRS})" | grep -E "\.(${INCLUDE_EXTS})$" | grep -Ev "(${EXCLUDE_FILES})" || true
  fi
}

echo "=== No-Credentials-In-Repo Check ==="
echo "Mode: ${SCAN_MODE}"
echo ""

# Check credential patterns
echo "Checking for credential-like patterns..."
FILES=$(get_files)
if [[ -z "$FILES" ]]; then
  echo "No files to scan."
  exit 0
fi

for PATTERN in "${CREDENTIAL_PATTERNS[@]}"; do
  MATCHES=$(echo "$FILES" | xargs grep -lEn "$PATTERN" 2>/dev/null || true)
  if [[ -n "$MATCHES" ]]; then
    echo -e "${RED}FAIL${NC}: Potential credential found matching pattern:"
    echo "  Pattern: $PATTERN"
    echo "  Files:"
    echo "$MATCHES" | sed 's/^/    /'
    FOUND=1
  fi
done

# Check hard-coded region patterns (only in source, not docs/config examples/config package)
echo "Checking for hard-coded region literals in source..."
SOURCE_FILES=$(echo "$FILES" | grep -E "\.(ts|js|cjs|mjs|py)$" | grep -v "\.test\." | grep -v "\.spec\." | grep -v "packages/config/" | grep -v "config/" || true)
if [[ -n "$SOURCE_FILES" ]]; then
  for PATTERN in "${HARDCODED_REGION_PATTERNS[@]}"; do
    MATCHES=$(echo "$SOURCE_FILES" | xargs grep -lEn "$PATTERN" 2>/dev/null || true)
    if [[ -n "$MATCHES" ]]; then
      echo -e "${RED}WARNING${NC}: Possible hard-coded region found (should use ConfigProvider):"
      echo "  Pattern: $PATTERN"
      echo "  Files:"
      echo "$MATCHES" | sed 's/^/    /'
      echo "  Note: Regions must come from ConfigProvider, not hard-coded."
      FOUND=1
    fi
  done
fi

echo ""
if [[ "$FOUND" -eq 1 ]]; then
  echo -e "${RED}=== CHECK FAILED ===${NC}"
  echo ""
  echo "Remediation:"
  echo "  - AWS credentials: use IAM roles or environment variables at deploy time"
  echo "  - Account/Region: use ConfigProvider (SSM Parameter Store or config.local.yaml)"
  echo "  - Model IDs: parameterize via ConfigProvider (bedrock.model_id)"
  echo "  - Secrets: use AWS Secrets Manager, never commit to repo"
  echo ""
  echo "See docs/security-notes.md for the no-credentials-in-repo policy."
  exit 1
else
  echo -e "${GREEN}=== CHECK PASSED ===${NC}"
  echo "No credentials or hard-coded account/region/key values detected."
  exit 0
fi
