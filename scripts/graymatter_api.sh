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
BUY_CREDITS_URL="${VALKYR_BUY_CREDITS_URL:-https://valkyrlabs.com/buy-credits}"
HUMAN_SIGNUP_URL="${VALKYR_HUMAN_SIGNUP_URL:-https://valkyrlabs.com/funnel/white-paper}"

if [[ -z "$TOKEN" ]] && command -v security >/dev/null 2>&1; then
  TOKEN="$(security find-generic-password -a default -s openclaw-valkyrai-admin-jwtSession -w 2>/dev/null || true)"
fi

if [[ -z "$TOKEN" ]] && command -v security >/dev/null 2>&1; then
  TOKEN="$(security find-generic-password -a default -s VALKYR_AUTH -w 2>/dev/null || true)"
fi

if [[ -z "$TOKEN" ]]; then
  echo "VALKYR_AUTH token is required. Checked VALKYR_AUTH_TOKEN, VALKYR_JWT_SESSION, keychain openclaw-valkyrai-admin-jwtSession, and keychain VALKYR_AUTH." >&2
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

show_insufficient_funds_guidance() {
  echo "Insufficient credits. Buy credits: ${BUY_CREDITS_URL}" >&2
  echo "Need an account? Sign up here: ${HUMAN_SIGNUP_URL}" >&2

  if command -v osascript >/dev/null 2>&1; then
    if osascript >/dev/null 2>&1 <<EOF
set buyUrl to "${BUY_CREDITS_URL}"
set signupUrl to "${HUMAN_SIGNUP_URL}"
set dialogText to "Your GrayMatter account has insufficient credits." & return & return & "Buy credits:" & return & buyUrl & return & return & "Human signup form:" & return & signupUrl
set resultButton to button returned of (display dialog dialogText buttons {"Not now", "Sign up", "Buy credits"} default button "Buy credits" with title "GrayMatter Credits")
if resultButton is "Buy credits" then
  do shell script "open " & quoted form of buyUrl
else if resultButton is "Sign up" then
  do shell script "open " & quoted form of signupUrl
end if
EOF
    then
      return
    fi
  fi

  if command -v powershell.exe >/dev/null 2>&1; then
    if VALKYR_BUY_URL="$BUY_CREDITS_URL" VALKYR_SIGNUP_URL="$HUMAN_SIGNUP_URL" powershell.exe -NoProfile -Command '
Add-Type -AssemblyName PresentationFramework
$buyUrl = $env:VALKYR_BUY_URL
$signupUrl = $env:VALKYR_SIGNUP_URL
$message = "Your GrayMatter account has insufficient credits.`n`nYes: Buy credits`nNo: Open human signup form`n`nBuy credits:`n$buyUrl`n`nSignup:`n$signupUrl"
$result = [System.Windows.MessageBox]::Show($message, "GrayMatter Credits", "YesNoCancel", "Warning")
if ($result -eq "Yes") { Start-Process $buyUrl }
elseif ($result -eq "No") { Start-Process $signupUrl }
' >/dev/null 2>&1; then
      return
    fi
  fi

  if command -v open >/dev/null 2>&1; then
    open "$BUY_CREDITS_URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$BUY_CREDITS_URL" >/dev/null 2>&1 || true
  elif command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /C start "" "$BUY_CREDITS_URL" >/dev/null 2>&1 || true
  fi
}

RESPONSE_FILE="$(mktemp)"
cleanup() {
  rm -f "$RESPONSE_FILE"
}
trap cleanup EXIT

CURL_ARGS=(
  -sS
  -o "$RESPONSE_FILE"
  -w "%{http_code}"
  -X "$METHOD_UPPER"
  "$URL"
  "${COMMON_HEADERS[@]}"
)

if [[ -n "$BODY" ]]; then
  CURL_ARGS+=(
    -H "content-type: application/json"
    --data "$BODY"
  )
fi

set +e
HTTP_STATUS="$(curl "${CURL_ARGS[@]}")"
CURL_STATUS=$?
set -e

if (( CURL_STATUS != 0 )); then
  if [[ -s "$RESPONSE_FILE" ]]; then
    cat "$RESPONSE_FILE"
    echo >&2
  fi
  exit "$CURL_STATUS"
fi

if [[ "$HTTP_STATUS" =~ ^[0-9]{3}$ ]] && (( HTTP_STATUS >= 400 )); then
  cat "$RESPONSE_FILE"
  echo >&2

  if command -v jq >/dev/null 2>&1; then
    if jq -e '.error == "INSUFFICIENT_FUNDS" or .insufficientFunds == true' "$RESPONSE_FILE" >/dev/null 2>&1; then
      show_insufficient_funds_guidance
    fi
  elif grep -q "INSUFFICIENT_FUNDS" "$RESPONSE_FILE" 2>/dev/null; then
    show_insufficient_funds_guidance
  fi

  exit 22
fi

cat "$RESPONSE_FILE"
