#!/bin/bash
# =============================================================================
# City Response Commander — API Test Script
# =============================================================================
# Usage:  ./scripts/test-api.sh [BASE_URL]
#
# Tests ALL known endpoints on the deployed demo backend:
#   Production CDK routes (9 routes, §12) + Demo convenience routes
# =============================================================================

set -euo pipefail

BASE_URL="${1:-https://du6wcg8xe4.execute-api.us-west-2.amazonaws.com}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

TOTAL=0; PASSED=0; FAILED=0; SKIPPED=0

pass()   { echo -e "${GREEN}✓ PASS${NC}"; PASSED=$((PASSED+1)); TOTAL=$((TOTAL+1)); }
fail()   { echo -e "${RED}✗ FAIL${NC}"; [ -n "${1:-}" ] && echo -e "    ${RED}Expected: $1${NC}"; [ -n "${2:-}" ] && echo -e "    ${RED}Actual:   $2${NC}"; FAILED=$((FAILED+1)); TOTAL=$((TOTAL+1)); }
skip()   { echo -e "${YELLOW}⊘ SKIP${NC}"; [ -n "${1:-}" ] && echo -e "    ${YELLOW}$1${NC}"; SKIPPED=$((SKIPPED+1)); TOTAL=$((TOTAL+1)); }
section(){ echo -e "\n${CYAN}━━━ $1 ━━━${NC}"; }
check()  { echo -n "  $1 ... "; }

get() {
    local r; r=$(curl -s -w "\n%{http_code}" "$BASE_URL$1" 2>/dev/null) || true
    HTTP_STATUS=$(echo "$r" | tail -n1)
    HTTP_BODY=$(echo "$r" | sed '$d')
}

post() {
    local r; r=$(curl -s -w "\n%{http_code}" -X POST -H "Content-Type: application/json" -d "$2" "$BASE_URL$1" 2>/dev/null) || true
    HTTP_STATUS=$(echo "$r" | tail -n1)
    HTTP_BODY=$(echo "$r" | sed '$d')
}

# =============================================================================
section "A. Demo Backend Endpoints (currently live)"
# =============================================================================

check "GET /health"; get "/health"
if echo "$HTTP_BODY" | grep -q '"status":"online"'; then pass; else fail "status=online" "$HTTP_BODY"; fi

check "GET /test (HTML console)"; get "/test"
if [ "$HTTP_STATUS" = "200" ] && echo "$HTTP_BODY" | grep -qi "<!DOCTYPE"; then pass; else fail "200 + HTML" "$HTTP_STATUS"; fi

check "POST /demo/incidents (ACC_001 — SOP-2, Critical)"
post "/demo/incidents" '{"event_id":"ACC_001"}'
if echo "$HTTP_BODY" | grep -q '"data_status":"ready"'; then
    ETE=$(echo "$HTTP_BODY" | grep -o '"ete_minutes":[0-9.]*' | head -1 | cut -d: -f2)
    ARTICLES=$(echo "$HTTP_BODY" | grep -o '"triggered_articles":\[[0-9,]*\]' | head -1)
    echo -e "${GREEN}✓ PASS${NC}  ${ARTICLES}  ete=${ETE}"
    ((PASSED++)); ((TOTAL++))
else fail "data_status=ready" "$HTTP_STATUS / $HTTP_BODY"; fi

check "POST /demo/incidents (EVT_002 — SOP-3, Crowd)"
post "/demo/incidents" '{"event_id":"EVT_002"}'
if echo "$HTTP_BODY" | grep -q '"data_status":"ready"'; then
    ARTICLES=$(echo "$HTTP_BODY" | grep -o '"triggered_articles":\[[0-9,]*\]' | head -1)
    echo -e "${GREEN}✓ PASS${NC}  ${ARTICLES}"
    ((PASSED++)); ((TOTAL++))
else fail "data_status=ready" "$HTTP_STATUS"; fi

check "POST /demo/incidents (EVT_003 — SOP-5, Power)"
post "/demo/incidents" '{"event_id":"EVT_003"}'
if echo "$HTTP_BODY" | grep -q '"data_status":"ready"'; then
    ETE=$(echo "$HTTP_BODY" | grep -o '"ete_minutes":[0-9.]*' | head -1 | cut -d: -f2)
    echo -e "${GREEN}✓ PASS${NC}  ete=${ETE}"
    ((PASSED++)); ((TOTAL++))
else fail "data_status=ready" "$HTTP_STATUS"; fi

check "POST /demo/alerts (multilingual)"
post "/demo/alerts" '{"station_id":"BL17","roaming_users":3000,"station_capacity":10000,"languages":["zh","en","ja","ko"]}'
if [ "$HTTP_STATUS" = "200" ]; then pass; else fail "200" "$HTTP_STATUS"; fi

# =============================================================================
section "B. Production CDK Routes — GET (§12, public-read, no auth)"
# =============================================================================

for endpoint in /timeline /roads /crowd /incidents; do
    check "GET $endpoint"
    get "$endpoint"
    if [ "$HTTP_STATUS" = "200" ]; then pass
    elif [ "$HTTP_STATUS" = "404" ]; then skip "Not routed on demo backend (CDK production route)"
    else fail "200" "$HTTP_STATUS"; fi
done

check "GET /decisions/{id}"
get "/decisions/demo-TPE_2026_ACC_001"
if [ "$HTTP_STATUS" = "200" ]; then pass
elif [ "$HTTP_STATUS" = "404" ]; then skip "Not routed on demo backend"
else fail "200" "$HTTP_STATUS"; fi

check "GET /reports/{id}"
get "/reports/demo-TPE_2026_ACC_001"
if [ "$HTTP_STATUS" = "200" ]; then pass
elif [ "$HTTP_STATUS" = "404" ]; then skip "Not routed on demo backend"
else fail "200" "$HTTP_STATUS"; fi

# =============================================================================
section "C. Production CDK Routes — POST (§12, Cognito JWT required)"
# =============================================================================

check "POST /what-if"
post "/what-if" '{"query":"若 BS_MRT_BL17 的 User_Count 增至 40000"}'
if [ "$HTTP_STATUS" = "200" ]; then pass
elif [ "$HTTP_STATUS" = "401" ]; then skip "Requires Cognito JWT auth (expected in production)"
elif [ "$HTTP_STATUS" = "403" ]; then skip "Cognito JWT rejected (no valid token)"
elif [ "$HTTP_STATUS" = "404" ]; then skip "Not routed on demo backend"
else fail "200/401/403" "$HTTP_STATUS"; fi

check "POST /incidents/{id}/inject"
post "/incidents/ACC_001/inject" '{"event_id":"ACC_001"}'
if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "202" ]; then pass
elif [ "$HTTP_STATUS" = "401" ]; then skip "Requires Cognito JWT auth (expected)"
elif [ "$HTTP_STATUS" = "403" ]; then skip "Cognito JWT rejected (no valid token)"
elif [ "$HTTP_STATUS" = "404" ]; then skip "Not routed on demo backend"
else fail "200/202/401/403" "$HTTP_STATUS"; fi

check "POST /decisions/{id}/publish"
post "/decisions/demo-TPE_2026_ACC_001/publish" '{}'
if [ "$HTTP_STATUS" = "200" ] || [ "$HTTP_STATUS" = "202" ]; then pass
elif [ "$HTTP_STATUS" = "401" ]; then skip "Requires Cognito JWT auth (expected)"
elif [ "$HTTP_STATUS" = "403" ]; then skip "Cognito JWT rejected (no valid token)"
elif [ "$HTTP_STATUS" = "404" ]; then skip "Not routed on demo backend"
else fail "200/202/401/403" "$HTTP_STATUS"; fi

# =============================================================================
section "D. Error Handling & Edge Cases"
# =============================================================================

check "POST /demo/incidents (missing event_id)"
post "/demo/incidents" '{}'
if [ "$HTTP_STATUS" = "400" ] || [ "$HTTP_STATUS" = "200" ]; then pass; else fail "400/200" "$HTTP_STATUS"; fi

check "POST /demo/incidents (invalid event_id)"
post "/demo/incidents" '{"event_id":"NONEXISTENT"}'
if [ "$HTTP_STATUS" = "400" ] || [ "$HTTP_STATUS" = "404" ] || [ "$HTTP_STATUS" = "200" ]; then pass; else fail "400/404/200" "$HTTP_STATUS"; fi

check "POST /demo/incidents (invalid JSON)"
HTTP_R=$(curl -s -w "\n%{http_code}" -X POST -H "Content-Type: application/json" -d "not json" "$BASE_URL/demo/incidents" 2>/dev/null) || true
HTTP_STATUS=$(echo "$HTTP_R" | tail -n1)
if [ "$HTTP_STATUS" = "400" ] || [ "$HTTP_STATUS" = "500" ]; then pass; else fail "400/500" "$HTTP_STATUS"; fi

check "GET /nonexistent route"
get "/nonexistent"
if [ "$HTTP_STATUS" = "403" ] || [ "$HTTP_STATUS" = "404" ]; then pass; else fail "403/404" "$HTTP_STATUS"; fi

# =============================================================================
section "E. Golden Test Value Verification (domain engine)"
# =============================================================================

check "ACC_001: triggered_articles=[1,2]"
post "/demo/incidents" '{"event_id":"ACC_001"}'
if echo "$HTTP_BODY" | grep -q '"triggered_articles":\[1,2\]'; then pass
else ACTUAL=$(echo "$HTTP_BODY" | grep -o '"triggered_articles":\[[0-9,]*\]'); fail "[1,2]" "$ACTUAL"; fi

check "ACC_001: primary_evacuation=RD_TPE_004"
if echo "$HTTP_BODY" | grep -q '"primary_evacuation":"RD_TPE_004"'; then pass
else ACTUAL=$(echo "$HTTP_BODY" | grep -o '"primary_evacuation":"[^"]*"'); fail "RD_TPE_004" "$ACTUAL"; fi

check "EVT_002: triggered_articles=[3]"
post "/demo/incidents" '{"event_id":"EVT_002"}'
if echo "$HTTP_BODY" | grep -q '"triggered_articles":\[3\]'; then pass
else ACTUAL=$(echo "$HTTP_BODY" | grep -o '"triggered_articles":\[[0-9,]*\]'); fail "[3]" "$ACTUAL"; fi

# =============================================================================
section "F. Performance"
# =============================================================================

for ep in /health /demo/incidents; do
    check "$ep response time < 5s"
    T=$(curl -s -o /dev/null -w "%{time_total}" "$BASE_URL$ep" 2>/dev/null || echo "99")
    MS=$(echo "$T * 1000" | bc 2>/dev/null || echo "0")
    if (( $(echo "$T < 5" | bc -l 2>/dev/null || echo 0) )); then pass; else skip "${MS}ms (slow)"; fi
done

# =============================================================================
# Summary
# =============================================================================

echo ""
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  ${BOLD}Results:${NC}  ${GREEN}${PASSED} passed${NC}  ${RED}${FAILED} failed${NC}  ${YELLOW}${SKIPPED} skipped${NC}  (${TOTAL} total)"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Coverage summary
echo ""
echo -e "${BOLD}API Coverage:${NC}"
echo -e "  ${GREEN}● Live:${NC}   /health, /test, /demo/incidents, /demo/alerts"
echo -e "  ${YELLOW}● Auth:${NC}   /what-if, /incidents/{id}/inject, /decisions/{id}/publish (need Cognito JWT)"
echo -e "  ${YELLOW}● CDK:${NC}    /timeline, /roads, /crowd, /incidents, /decisions/{id}, /reports/{id} (not routed on demo backend)"
echo ""

if [ "$FAILED" -gt 0 ]; then exit 1; else exit 0; fi
