#!/usr/bin/env bash
set -euo pipefail

METHOD="${1:-}"
PATH_PART="${2:-}"
BODY="${3:-}"

if [[ -z "$METHOD" || -z "$PATH_PART" ]]; then
  echo "Usage: $0 <GET|POST|PUT|PATCH|DELETE> <path> [json-body]" >&2
  exit 1
fi

BASE="${VALKYR_API_BASE:-https://api-0.valkyrlabs.com/v1}"
TOKEN="${VALKYR_AUTH_TOKEN:-${VALKYR_JWT_SESSION:-}}"
KEYCHAIN_SERVICE="${VALKYR_KEYCHAIN_SERVICE:-VALKYR_AUTH}"

if [[ -z "$TOKEN" ]] && command -v security >/dev/null 2>&1; then
  TOKEN="$(security find-generic-password -a default -s "$KEYCHAIN_SERVICE" -w 2>/dev/null || true)"
fi

if [[ -z "$TOKEN" ]]; then
  echo "VALKYR_AUTH token is required. Checked VALKYR_AUTH_TOKEN, VALKYR_JWT_SESSION, and keychain ${KEYCHAIN_SERVICE}." >&2
  exit 2
fi

URL="${BASE%/}/${PATH_PART#/}"
METHOD_UPPER="$(echo "$METHOD" | tr '[:lower:]' '[:upper:]')"

COMMON_HEADERS=(
  -H "accept: application/json"
  -H "Authorization: Bearer ${TOKEN}"
  -H "VALKYR_AUTH: ${TOKEN}"
  -H "Cookie: VALKYR_AUTH=${TOKEN}"
)

if [[ -n "$BODY" ]]; then
  curl --fail-with-body -sS -X "$METHOD_UPPER" "$URL" \
    "${COMMON_HEADERS[@]}" \
    -H "content-type: application/json" \
    --data "$BODY"
else
  curl --fail-with-body -sS -X "$METHOD_UPPER" "$URL" \
    "${COMMON_HEADERS[@]}"
fi
