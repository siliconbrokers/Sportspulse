#!/usr/bin/env bash
# check-provider-bypass.sh — CI guard for API Usage Governance.
# Fails if any file in server/ or tools/ makes a direct fetch() to a governed
# provider URL outside the InstrumentedProviderClient.
#
# Escape hatch: add a comment "// api-usage-bypass: <reason>" on the same line
# to suppress the check for that specific line.
#
# Spec: SPEC-SPORTPULSE-OPS-API-USAGE-GOVERNANCE §16

set -euo pipefail

GOVERNED_DOMAINS=(
  "v3.football.api-sports.io"
  "api.football-data.org"
  "www.thesportsdb.com/api"
  "www.googleapis.com/youtube"
  "api.the-odds-api.com"
)

ALLOWED_FILE="packages/canonical/src/api-usage/provider-client.ts"

SEARCH_DIRS=("server" "tools")
EXCLUDE_PATTERNS=("__tests__" ".test.ts" ".spec.ts")

found_violations=0
bypass_count=0

for domain in "${GOVERNED_DOMAINS[@]}"; do
  while IFS= read -r match; do
    # Skip the allowed file (the governed path itself)
    if echo "$match" | grep -qF "$ALLOWED_FILE"; then
      continue
    fi

    # Skip test files
    skip=false
    for excl in "${EXCLUDE_PATTERNS[@]}"; do
      if echo "$match" | grep -qF "$excl"; then
        skip=true
        break
      fi
    done
    $skip && continue

    # Check for escape hatch comment
    if echo "$match" | grep -q "api-usage-bypass:"; then
      bypass_count=$((bypass_count + 1))
      echo "  [BYPASS] $match"
      continue
    fi

    echo "  [VIOLATION] $match"
    found_violations=$((found_violations + 1))
  done < <(grep -rn "$domain" "${SEARCH_DIRS[@]}" --include="*.ts" 2>/dev/null || true)
done

if [ "$bypass_count" -gt 0 ]; then
  echo ""
  echo "⚠️  $bypass_count api-usage-bypass exception(s) in use — review periodically."
fi

if [ "$found_violations" -gt 0 ]; then
  echo ""
  echo "❌ $found_violations untracked direct provider call(s) found."
  echo "   All provider calls must go through InstrumentedProviderClient"
  echo "   (packages/canonical/src/api-usage/provider-client.ts)."
  echo "   If this is intentional, add '// api-usage-bypass: <reason>' on the line."
  exit 1
fi

echo "✅ Provider call governance check passed."
exit 0
