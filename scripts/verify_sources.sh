#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [--manifest-test-only MANIFEST] SOURCE_DIR" >&2
}

hash_file() {
  local path=$1
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -- "$path" | awk '{print toupper($1)}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 -- "$path" | awk '{print toupper($1)}'
  else
    echo "STOP: no SHA-256 utility is available" >&2
    return 1
  fi
}

MANIFEST_FILE=''
if [[ "${1:-}" == '--manifest-test-only' ]]; then
  if [[ "${VERIFY_SOURCES_TEST_MANIFEST:-}" != '1' ]]; then
    echo "STOP: manifest override is disabled outside the test harness" >&2
    exit 2
  fi
  MANIFEST_FILE=${2:-}
  shift 2
fi

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

SOURCE_DIR=$1
if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "STOP: source directory does not exist: $SOURCE_DIR" >&2
  exit 1
fi

DEFAULT_MANIFEST=$(cat <<'MANIFEST'
706B44C94313AAE751434E29EE3CFF6BE1351DAA76077933C5D6DBE5171C15D7|(中華電信) 命題文件 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.pdf
0BC38CA8B655308F0DB36E3CF02FAC1289E9509AD61C59C9673CF5A7505FF065|(中華電信) 命題解說 - 2026 雲湧智生：臺灣生成式 AI 應用黑客松競賽.docx
94B3B78FB7CE4C11D89A611BA613F263F562FACFFC861F1E94EAC058AF30173D|city_traffic_flow.csv
FDCEA7BE34CBD69536393D85E5DBFA2B230616CFBB40E072D1600D11AA6CACAD|signaling_crowd_density.csv
741D253538AAF2BB25C60DEC9D4A8E8DEFECC27112FA09C7A9F1512ADB286B18|road_network_geometry.json
0C84F2F6F30E2EC18F56E9675AA1C1C6062EBEFAF14920D8CCAC732D41BCAF1D|emergency_traffic_sop.txt
E90C8AE46AFD02A76C233F39CB0628254BE53555B9E48067C4EA3A48E41C0A63|live_incidents.json
MANIFEST
)

if [[ -n "$MANIFEST_FILE" ]]; then
  if [[ ! -f "$MANIFEST_FILE" ]]; then
    echo "STOP: test manifest is missing" >&2
    exit 1
  fi
  MANIFEST=$MANIFEST_FILE
else
  MANIFEST=$(mktemp)
  trap 'rm -f "$MANIFEST"' EXIT
  printf '%s\n' "$DEFAULT_MANIFEST" > "$MANIFEST"
fi

count=0
failed=0
while IFS='|' read -r expected filename; do
  [[ -z "$expected" && -z "$filename" ]] && continue
  count=$((count + 1))

  if [[ ! "$expected" =~ ^[0-9A-Fa-f]{64}$ ]] || [[ -z "$filename" ]] || [[ "$filename" == */* ]] || [[ "$filename" == '.' || "$filename" == '..' ]]; then
    echo "STOP: invalid manifest entry at line $count" >&2
    failed=1
    continue
  fi

  path="$SOURCE_DIR/$filename"
  if [[ ! -f "$path" ]]; then
    echo "STOP: missing source: $filename" >&2
    failed=1
    continue
  fi
  if [[ ! -r "$path" ]]; then
    echo "STOP: unreadable source: $filename" >&2
    failed=1
    continue
  fi

  actual=$(hash_file "$path") || {
    failed=1
    continue
  }
  if [[ "$actual" != "${expected^^}" ]]; then
    echo "STOP: SHA-256 mismatch: $filename" >&2
    failed=1
  else
    echo "PASS: $filename"
  fi
done < "$MANIFEST"

if [[ "$count" -ne 7 ]]; then
  echo "STOP: manifest must contain exactly 7 official sources (found $count)" >&2
  failed=1
fi

if [[ "$failed" -ne 0 ]]; then
  echo "SOURCE HASH GATE: STOP" >&2
  exit 1
fi

echo "SOURCE HASH GATE: PASS (7/7)"
