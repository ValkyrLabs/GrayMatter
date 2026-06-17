#!/usr/bin/env bash
set -euo pipefail

METHOD="${1:-}"
PATH_PART="${2:-}"
BODY="${3:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${GRAYMATTER_SKIP_SELF_UPDATE:-false}" != "true" && -x "${SCRIPT_DIR}/gm-self-update" ]]; then
  GRAYMATTER_SELF_UPDATE_QUIET="${GRAYMATTER_SELF_UPDATE_QUIET:-true}" "${SCRIPT_DIR}/gm-self-update" maybe || true
fi

if [[ -z "$METHOD" || -z "$PATH_PART" ]]; then
  echo "Usage: $0 <GET|POST|PUT|PATCH|DELETE> <path> [json-body]" >&2
  exit 1
fi

BASE="${VALKYR_API_BASE:-https://api-0.valkyrlabs.com/v1}"
TOKEN=${VALKYR_AUTH_TOKEN:-${VALKYR_JWT_SESSION:-}}
LIGHT_MODE="${GRAYMATTER_LIGHT_MODE:-false}"
KEYCHAIN_SERVICE="${VALKYR_KEYCHAIN_SERVICE:-VALKYR_AUTH}"
USERNAME_SERVICE="${VALKYR_USERNAME_KEYCHAIN_SERVICE:-${KEYCHAIN_SERVICE}_USERNAME}"
PASSWORD_SERVICE="${VALKYR_PASSWORD_KEYCHAIN_SERVICE:-${KEYCHAIN_SERVICE}_PASSWORD}"
USERNAME=${GRAYMATTER_USERNAME:-${VALKYR_USERNAME:-}}
PASSWORD=${GRAYMATTER_PASSWORD:-${VALKYR_PASSWORD:-}}
BUY_CREDITS_URL_BASE="${VALKYR_BUY_CREDITS_URL:-https://valkyrlabs.com/graymatter/credits}"
HUMAN_SIGNUP_URL_BASE="${VALKYR_HUMAN_SIGNUP_URL:-https://valkyrlabs.com/graymatter/activate}"
LOGIN_PATH="${GRAYMATTER_LOGIN_PATH:-/auth/login}"
FALLBACK_TMPDIR="${GRAYMATTER_TMPDIR:-${SCRIPT_DIR}/../tmp}"
CURL_CONNECT_TIMEOUT="${GRAYMATTER_CURL_CONNECT_TIMEOUT:-5}"
CURL_MAX_TIME="${GRAYMATTER_CURL_MAX_TIME:-60}"
TOKEN_REFRESH_SKEW_SECONDS="${GRAYMATTER_TOKEN_REFRESH_SKEW_SECONDS:-60}"
GRAYMATTER_INSTALL_ID="${GRAYMATTER_INSTALL_ID:-${OPENCLAW_INSTANCE_ID:-${HOSTNAME:-graymatter-install}}}"
GRAYMATTER_ACTIVATION_SOURCE="${GRAYMATTER_ACTIVATION_SOURCE:-graymatter}"
GRAYMATTER_ACTIVATION_RETURN_TO="${GRAYMATTER_ACTIVATION_RETURN_TO:-graymatter://activation/return}"
GRAYMATTER_DEFERRED_DIR="${GRAYMATTER_DEFERRED_DIR:-${SCRIPT_DIR}/../memory/deferred-ops}"
GRAYMATTER_SKIP_DEFERRED="${GRAYMATTER_SKIP_DEFERRED:-false}"
GRAYMATTER_CREDIT_EVENTS_PATH="${GRAYMATTER_CREDIT_EVENTS_PATH:-${SCRIPT_DIR}/../memory/credit-recovery-events.jsonl}"

portable_mktemp() {
  local template="${1:-graymatter.XXXXXX}"
  local tmp_path=""

  if tmp_path="$(mktemp -t "$template" 2>/dev/null)" || tmp_path="$(mktemp "${template}" 2>/dev/null)"; then
    printf '%s\n' "$tmp_path"
    return 0
  fi

  mkdir -p "$FALLBACK_TMPDIR"
  if tmp_path="$(TMPDIR="$FALLBACK_TMPDIR" mktemp -t "$template" 2>/dev/null)" || tmp_path="$(mktemp "${FALLBACK_TMPDIR%/}/${template}" 2>/dev/null)"; then
    printf '%s\n' "$tmp_path"
    return 0
  fi

  echo "Unable to create temporary file for GrayMatter API transport" >&2
  return 1
}

decode_base64_url() {
  local value="${1:-}"
  local padded="$value"
  local remainder=$(( ${#padded} % 4 ))

  case "$remainder" in
    2) padded="${padded}==" ;;
    3) padded="${padded}=" ;;
    1) padded="${padded}===" ;;
  esac

  padded="$(printf '%s' "$padded" | tr '_-' '/+')"

  if printf '%s' "$padded" | base64 --decode 2>/dev/null; then
    return 0
  fi

  printf '%s' "$padded" | base64 -D 2>/dev/null
}

token_claims_json() {
  local token="${1:-}"
  local payload=""

  [[ -n "$token" ]] || return 1
  payload="$(printf '%s' "$token" | cut -d'.' -f2)"
  [[ -n "$payload" && "$payload" != "$token" ]] || return 1

  decode_base64_url "$payload"
}

token_is_clearly_read_only() {
  local token="${1:-}"
  local claims=""

  claims="$(token_claims_json "$token" 2>/dev/null)" || return 1

  if command -v jq >/dev/null 2>&1; then
    jq -e '
      def normalized_roles:
        ((.roles // []) + (.roleList // []) + (.authorities // []) + (.authorityList // []))
        | map(select(type == "string"))
        | unique;
      def non_trivial_roles:
        normalized_roles
        | map(select(. != "EVERYONE" and . != "FREE"));
      def normalized_scopes:
        (.scopes // [])
        | map(select(type == "string"))
        | unique;
      def non_readonly_scopes:
        normalized_scopes
        | map(select(. != "SCOPE_schema.read"));

      (non_trivial_roles | length) == 0 and (non_readonly_scopes | length) == 0
    ' >/dev/null 2>&1 <<<"$claims"
    return $?
  fi

  return 1
}

token_has_valkyr_agent_role() {
  local token="${1:-}"
  local claims=""

  claims="$(token_claims_json "$token" 2>/dev/null)" || return 1

  if command -v jq >/dev/null 2>&1; then
    jq -e '
      def normalize:
        tostring
        | ascii_upcase
        | if startswith("ROLE_") then . else "ROLE_" + . end;
      def role_values:
        [(.roles // []), (.roleList // []), (.authorities // []), (.authorityList // [])]
        | map(if type == "array" then . else [] end)
        | add
        | map(select(type == "string") | normalize);
      any(role_values[]?; . == "ROLE_VALKYR_AGENT")
    ' >/dev/null 2>&1 <<<"$claims"
    return $?
  fi

  return 1
}

tenant_id_from_token() {
  local token="${1:-}"
  local claims=""
  local explicit_tenant=""

  claims="$(token_claims_json "$token" 2>/dev/null)" || return 0

  if command -v jq >/dev/null 2>&1; then
    explicit_tenant="$(
      jq -r '
        .tenantId // .organizationId // .orgId // empty
        | tostring
        | select(. != "" and ascii_downcase != "null")
      ' <<<"$claims" 2>/dev/null || true
    )"
    if [[ -n "$explicit_tenant" ]]; then
      printf '%s\n' "$explicit_tenant"
      return 0
    fi
  fi

  if token_has_valkyr_agent_role "$token"; then
    printf 'main\n'
  fi
}

resolve_tenant_id() {
  local explicit="${GRAYMATTER_TENANT_ID:-${VALKYR_TENANT_ID:-}}"

  if [[ -n "$explicit" ]]; then
    printf '%s\n' "$explicit"
    return 0
  fi

  tenant_id_from_token "$TOKEN"
}

token_expires_soon() {
  local token="${1:-}"
  local claims=""
  local now=""

  claims="$(token_claims_json "$token" 2>/dev/null)" || return 1
  now="$(date +%s)"

  if command -v jq >/dev/null 2>&1; then
    jq -e \
      --argjson now "$now" \
      --argjson skew "$TOKEN_REFRESH_SKEW_SECONDS" \
      '(.exp? | type == "number") and (.exp <= ($now + $skew))' \
      >/dev/null 2>&1 <<<"$claims"
    return $?
  fi

  return 1
}

method_requires_write_access() {
  case "$METHOD_UPPER" in
    POST|PUT|PATCH|DELETE)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

url_encode() {
  local value="${1:-}"
  if command -v jq >/dev/null 2>&1; then
    jq -rn --arg value "$value" '$value|@uri'
    return 0
  fi

  local encoded=""
  local i char hex
  for (( i=0; i<${#value}; i++ )); do
    char="${value:i:1}"
    case "$char" in
      [a-zA-Z0-9.~_-]) encoded+="$char" ;;
      *) printf -v hex '%%%02X' "'$char"; encoded+="$hex" ;;
    esac
  done
  printf '%s\n' "$encoded"
}

append_query_param() {
  local url="$1"
  local key="$2"
  local value="$3"
  local separator="?"

  [[ -n "$value" ]] || {
    printf '%s\n' "$url"
    return 0
  }

  if [[ "$url" == *\?* ]]; then
    separator="&"
  fi

  printf '%s%s%s=%s\n' "$url" "$separator" "$key" "$(url_encode "$value")"
}

emit_credit_recovery_event() {
  local event="$1"
  local operation="${2:-${GRAYMATTER_ACTIVATION_OPERATION:-memory_query}}"
  local trace_id="${3:-}"
  local deferred_file="${4:-}"
  local required_credits="${5:-}"
  local current_balance="${6:-}"
  local event_dir=""

  [[ -n "$GRAYMATTER_CREDIT_EVENTS_PATH" ]] || return 0
  event_dir="$(dirname "$GRAYMATTER_CREDIT_EVENTS_PATH")"
  mkdir -p "$event_dir"

  if command -v jq >/dev/null 2>&1; then
    jq -nc \
      --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --arg event "$event" \
      --arg operation "$operation" \
      --arg path "$PATH_PART" \
      --arg method "$METHOD_UPPER" \
      --arg source "$GRAYMATTER_ACTIVATION_SOURCE" \
      --arg install_id "$GRAYMATTER_INSTALL_ID" \
      --arg trace_id "$trace_id" \
      --arg deferred_file "$deferred_file" \
      --arg required_credits "$required_credits" \
      --arg current_balance "$current_balance" \
      '{
        timestamp:$ts,
        event:$event,
        operation:$operation,
        method:$method,
        path:$path,
        source:$source,
        installId:$install_id,
        traceId:$trace_id,
        deferredFile:$deferred_file,
        requiredCredits:$required_credits,
        currentBalance:$current_balance
      }' >>"$GRAYMATTER_CREDIT_EVENTS_PATH"
    return 0
  fi

  printf '{"timestamp":"%s","event":"%s","operation":"%s","method":"%s","path":"%s","source":"%s","installId":"%s","traceId":"%s","deferredFile":"%s","requiredCredits":"%s","currentBalance":"%s"}\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    "$event" \
    "$operation" \
    "$METHOD_UPPER" \
    "$PATH_PART" \
    "$GRAYMATTER_ACTIVATION_SOURCE" \
    "$GRAYMATTER_INSTALL_ID" \
    "$trace_id" \
    "$deferred_file" \
    "$required_credits" \
    "$current_balance" >>"$GRAYMATTER_CREDIT_EVENTS_PATH"
}

activation_context_url() {
  local base_url="$1"
  local intent="$2"
  local operation="${GRAYMATTER_ACTIVATION_OPERATION:-memory_query}"
  local url="$base_url"

  url="$(append_query_param "$url" source "$GRAYMATTER_ACTIVATION_SOURCE")"
  url="$(append_query_param "$url" intent "$intent")"
  url="$(append_query_param "$url" operation "$operation")"
  url="$(append_query_param "$url" install_id "$GRAYMATTER_INSTALL_ID")"
  url="$(append_query_param "$url" return_to "$GRAYMATTER_ACTIVATION_RETURN_TO")"
  url="$(append_query_param "$url" api_base "$BASE")"
  url="$(append_query_param "$url" request_path "$PATH_PART")"
  printf '%s\n' "$url"
}

fail_read_only_token() {
  local username_hint="${USERNAME:-unknown}"
  printf '{"error":"READ_ONLY_TOKEN","message":"GrayMatter auth token is read-only for %s. The current ValkyrAI login only grants schema-read access, so mutating requests cannot succeed. Update the account roles/scopes or supply a write-capable VALKYR_AUTH token."}\n' "$username_hint"
  exit 23
}

keychain_read() {
  local account="$1"
  local service="$2"
  security find-generic-password -a "$account" -s "$service" -w 2>/dev/null || true
}

store_token() {
  local token="$1"
  if [[ -z "$token" ]] || ! command -v security >/dev/null 2>&1; then
    return 0
  fi
  if [[ -n "$USERNAME" ]]; then
    replace_keychain_secret "$USERNAME" "$KEYCHAIN_SERVICE" "$token"
  fi
  replace_keychain_secret default "$KEYCHAIN_SERVICE" "$token"
}

replace_keychain_secret() {
  local account="$1"
  local service="$2"
  local value="$3"

  security delete-generic-password -a "$account" -s "$service" >/dev/null 2>&1 || true
  security add-generic-password -U -a "$account" -s "$service" -w "$value" >/dev/null
}

run_login() {
  local login_cmd="${GRAYMATTER_LOGIN_COMMAND:-${SCRIPT_DIR}/gm-login}"
  if [[ ! -x "$login_cmd" ]]; then
    login_cmd="$(command -v gm-login 2>/dev/null || true)"
  fi

  if [[ -z "$login_cmd" || ! -x "$login_cmd" ]]; then
    return 1
  fi

  eval "$("$login_cmd" env)"
  TOKEN=${VALKYR_AUTH_TOKEN:-${VALKYR_JWT_SESSION:-}}
  if [[ -z "$USERNAME" ]] && command -v security >/dev/null 2>&1; then
    USERNAME=$(keychain_read default "$USERNAME_SERVICE")
  fi
  if [[ -z "$PASSWORD" && -n "$USERNAME" ]] && command -v security >/dev/null 2>&1; then
    PASSWORD=$(keychain_read "$USERNAME" "$PASSWORD_SERVICE")
  fi
}

if [[ -z "$USERNAME" ]] && command -v security >/dev/null 2>&1; then
  USERNAME=$(keychain_read default "$USERNAME_SERVICE")
fi

if [[ -z "$PASSWORD" && -n "$USERNAME" ]] && command -v security >/dev/null 2>&1; then
  PASSWORD=$(keychain_read "$USERNAME" "$PASSWORD_SERVICE")
fi

if [[ -z "$TOKEN" ]] && command -v security >/dev/null 2>&1; then
  if [[ -n "$USERNAME" ]]; then
    TOKEN=$(keychain_read "$USERNAME" "$KEYCHAIN_SERVICE")
  fi
  if [[ -z "$TOKEN" ]]; then
    TOKEN=$(keychain_read default "$KEYCHAIN_SERVICE")
  fi
  if [[ -z "$TOKEN" ]]; then
    TOKEN=$(keychain_read default openclaw-valkyrai-admin-jwtSession)
  fi
  if [[ -z "$TOKEN" && "$KEYCHAIN_SERVICE" != "VALKYR_AUTH" ]]; then
    TOKEN=$(keychain_read default VALKYR_AUTH)
  fi
fi

if [[ -z "$TOKEN" && "$LIGHT_MODE" != "true" ]]; then
  if ! run_login || [[ -z "$TOKEN" ]]; then
    echo "VALKYR_AUTH token is required. Checked VALKYR_AUTH_TOKEN, VALKYR_JWT_SESSION, keychain ${KEYCHAIN_SERVICE}, keychain openclaw-valkyrai-admin-jwtSession, and login did not produce a token." >&2
    exit 2
  fi
fi

URL="${BASE%/}/${PATH_PART#/}"
METHOD_UPPER="$(echo "$METHOD" | tr '[:lower:]' '[:upper:]')"

COMMON_HEADERS=(
  -H "accept: application/json"
)
if [[ -n "$TOKEN" ]]; then
  COMMON_HEADERS+=(
    -H "Authorization: Bearer ${TOKEN}"
    -H "VALKYR_AUTH: ${TOKEN}"
    -H "Cookie: VALKYR_AUTH=${TOKEN}"
  )
fi

show_insufficient_funds_guidance() {
  local response_file="${1:-}"
  local buy_credits_url
  local human_signup_url
  local required_credits=""
  local current_balance=""
  local trace_id=""
  local operation_kind="memory_query"
  local deferred_file=""

  operation_kind="$(determine_operation_kind)"
  GRAYMATTER_ACTIVATION_OPERATION="$operation_kind"

  if [[ -n "$response_file" ]] && command -v jq >/dev/null 2>&1; then
    required_credits="$(jq -r '.requiredCredits // .required_credits // .required // .details.requiredCredits // empty' "$response_file" 2>/dev/null || true)"
    current_balance="$(jq -r '.currentBalance // .balance // .details.currentBalance // empty' "$response_file" 2>/dev/null || true)"
    trace_id="$(jq -r '.traceId // .trace_id // .details.traceId // empty' "$response_file" 2>/dev/null || true)"
  fi

  buy_credits_url="$(activation_context_url "$BUY_CREDITS_URL_BASE" recharge)"
  human_signup_url="$(activation_context_url "$HUMAN_SIGNUP_URL_BASE" signup)"
  buy_credits_url="$(append_query_param "$buy_credits_url" required_credits "$required_credits")"
  buy_credits_url="$(append_query_param "$buy_credits_url" current_balance "$current_balance")"
  buy_credits_url="$(append_query_param "$buy_credits_url" trace_id "$trace_id")"

  echo "Insufficient credits. Buy credits: ${buy_credits_url}" >&2
  echo "Need an account? Sign up here: ${human_signup_url}" >&2
  if [[ -n "$required_credits" ]]; then
    echo "Recharge ${required_credits} credits to complete ${operation_kind}." >&2
  fi
  if [[ -n "$current_balance" ]]; then
    echo "Current balance: ${current_balance}" >&2
  fi
  echo "Activation context: install=${GRAYMATTER_INSTALL_ID} operation=${GRAYMATTER_ACTIVATION_OPERATION:-memory_query} return=${GRAYMATTER_ACTIVATION_RETURN_TO}" >&2
  emit_credit_recovery_event "credit_blocked" "$operation_kind" "$trace_id" "" "$required_credits" "$current_balance"

  deferred_file="$(create_deferred_operation "$response_file" "$operation_kind")"
  if [[ -n "$deferred_file" ]]; then
    emit_credit_recovery_event "deferred_write_created" "$operation_kind" "$trace_id" "$deferred_file" "$required_credits" "$current_balance"
    echo "Stored locally for replay: ${deferred_file}" >&2
    echo "Run scripts/gm-replay-deferred to retry after recharge." >&2
  fi

  if command -v osascript >/dev/null 2>&1; then
    if osascript >/dev/null 2>&1 <<EOF
set buyUrl to "${buy_credits_url}"
set signupUrl to "${human_signup_url}"
set dialogText to "Your GrayMatter account has insufficient credits." & return & return & "Buy credits:" & return & buyUrl & return & return & "Human signup form:" & return & signupUrl & return & return & "After signup/payment, return to GrayMatter activation and retry the blocked operation."
set resultButton to button returned of (display dialog dialogText buttons {"Not now", "Sign up", "Buy credits"} default button "Buy credits" with title "GrayMatter Credits")
if resultButton is "Buy credits" then
  do shell script "open " & quoted form of buyUrl
else if resultButton is "Sign up" then
  do shell script "open " & quoted form of signupUrl
end if
EOF
    then
      emit_credit_recovery_event "buy_credits_opened" "$operation_kind" "$trace_id" "$deferred_file" "$required_credits" "$current_balance"
      return
    fi
  fi

  if command -v powershell.exe >/dev/null 2>&1; then
    if VALKYR_BUY_URL="$buy_credits_url" VALKYR_SIGNUP_URL="$human_signup_url" powershell.exe -NoProfile -Command '
Add-Type -AssemblyName PresentationFramework
$buyUrl = $env:VALKYR_BUY_URL
$signupUrl = $env:VALKYR_SIGNUP_URL
$message = "Your GrayMatter account has insufficient credits.`n`nYes: Buy credits`nNo: Open human signup form`n`nBuy credits:`n$buyUrl`n`nSignup:`n$signupUrl`n`nAfter signup/payment, return to GrayMatter activation and retry the blocked operation."
$result = [System.Windows.MessageBox]::Show($message, "GrayMatter Credits", "YesNoCancel", "Warning")
if ($result -eq "Yes") { Start-Process $buyUrl }
elseif ($result -eq "No") { Start-Process $signupUrl }
' >/dev/null 2>&1; then
      emit_credit_recovery_event "buy_credits_opened" "$operation_kind" "$trace_id" "$deferred_file" "$required_credits" "$current_balance"
      return
    fi
  fi

  if command -v open >/dev/null 2>&1; then
    open "$buy_credits_url" >/dev/null 2>&1 || true
    emit_credit_recovery_event "buy_credits_opened" "$operation_kind" "$trace_id" "$deferred_file" "$required_credits" "$current_balance"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$buy_credits_url" >/dev/null 2>&1 || true
    emit_credit_recovery_event "buy_credits_opened" "$operation_kind" "$trace_id" "$deferred_file" "$required_credits" "$current_balance"
  elif command -v cmd.exe >/dev/null 2>&1; then
    cmd.exe /C start "" "$buy_credits_url" >/dev/null 2>&1 || true
    emit_credit_recovery_event "buy_credits_opened" "$operation_kind" "$trace_id" "$deferred_file" "$required_credits" "$current_balance"
  fi
}

determine_operation_kind() {
  local normalized_path="${PATH_PART#/}"
  if [[ "$METHOD_UPPER" == "GET" ]]; then
    if [[ "$normalized_path" == "MemoryEntry/query"* ]]; then
      printf 'memory_query\n'
      return 0
    fi
    printf 'memory_read\n'
    return 0
  fi
  if [[ "$normalized_path" == "MemoryEntry"* ]]; then
    printf 'memory_write\n'
    return 0
  fi
  if [[ "$normalized_path" == "Entity"* ]]; then
    printf 'entity_write\n'
    return 0
  fi
  if [[ "$normalized_path" == "Graph"* ]]; then
    printf 'graph_write\n'
    return 0
  fi
  printf 'api_write\n'
}

request_is_replay_safe() {
  local normalized_path="${PATH_PART#/}"
  case "$METHOD_UPPER" in
    POST|PUT|PATCH|DELETE)
      [[ "$normalized_path" == "MemoryEntry"* || "$normalized_path" == "Entity"* || "$normalized_path" == "Graph"* ]]
      return $?
      ;;
    *)
      return 1
      ;;
  esac
}

create_deferred_operation() {
  local response_file="${1:-}"
  local operation_kind="${2:-api_write}"
  local op_id=""
  local target_file=""
  local body_file=""
  local trace_id=""
  local required_credits=""
  local current_balance=""

  [[ "$GRAYMATTER_SKIP_DEFERRED" == "true" ]] && return 0
  request_is_replay_safe || return 0

  if [[ -n "$response_file" ]] && command -v jq >/dev/null 2>&1; then
    trace_id="$(jq -r '.traceId // .trace_id // .details.traceId // empty' "$response_file" 2>/dev/null || true)"
    required_credits="$(jq -r '.requiredCredits // .required_credits // .required // .details.requiredCredits // empty' "$response_file" 2>/dev/null || true)"
    current_balance="$(jq -r '.currentBalance // .balance // .details.currentBalance // empty' "$response_file" 2>/dev/null || true)"
  fi

  op_id="$(date +%Y%m%dT%H%M%SZ)-$$-$(od -An -N4 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n')"
  mkdir -p "$GRAYMATTER_DEFERRED_DIR"
  target_file="${GRAYMATTER_DEFERRED_DIR%/}/${op_id}.json"
  body_file="$(portable_mktemp graymatter-deferred-body.XXXXXX)"
  printf '%s' "$BODY" >"$body_file"

  if command -v jq >/dev/null 2>&1; then
    jq -n \
      --arg id "$op_id" \
      --arg ts "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
      --arg method "$METHOD_UPPER" \
      --arg path "$PATH_PART" \
      --arg body "$BODY" \
      --arg operation "$operation_kind" \
      --arg api_base "$BASE" \
      --arg install_id "$GRAYMATTER_INSTALL_ID" \
      --arg source "$GRAYMATTER_ACTIVATION_SOURCE" \
      --arg trace_id "$trace_id" \
      --arg required_credits "$required_credits" \
      --arg current_balance "$current_balance" \
      --arg body_sha "$(shasum -a 256 "$body_file" | awk '{print $1}')" \
      '{
        id:$id,
        createdAt:$ts,
        method:$method,
        path:$path,
        body:$body,
        operation:$operation,
        apiBase:$api_base,
        installId:$install_id,
        source:$source,
        traceId:$trace_id,
        requiredCredits:$required_credits,
        currentBalance:$current_balance,
        bodySha256:$body_sha
      }' >"$target_file"
    rm -f "$body_file"
    printf '%s\n' "$target_file"
    return 0
  fi

  {
    printf '{'
    printf '"id":"%s",' "$op_id"
    printf '"createdAt":"%s",' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '"method":"%s",' "$METHOD_UPPER"
    printf '"path":"%s",' "$PATH_PART"
    printf '"body":"%s",' "$(printf '%s' "$BODY" | sed 's/\\/\\\\/g; s/"/\\"/g')"
    printf '"operation":"%s",' "$operation_kind"
    printf '"apiBase":"%s",' "$BASE"
    printf '"installId":"%s",' "$GRAYMATTER_INSTALL_ID"
    printf '"source":"%s",' "$GRAYMATTER_ACTIVATION_SOURCE"
    printf '"traceId":"%s",' "$trace_id"
    printf '"requiredCredits":"%s",' "$required_credits"
    printf '"currentBalance":"%s",' "$current_balance"
    printf '"bodySha256":"%s"' "$(shasum -a 256 "$body_file" | awk '{print $1}')"
    printf '}'
  } >"$target_file"
  rm -f "$body_file"
  printf '%s\n' "$target_file"
}

RESPONSE_FILE="$(portable_mktemp graymatter-response.XXXXXX)"
RESPONSE_HEADERS="$(portable_mktemp graymatter-headers.XXXXXX)"
STATEFUL_COOKIE_JAR=""
STATEFUL_XSRF_TOKEN=""
cleanup() {
  rm -f "$RESPONSE_FILE"
  rm -f "$RESPONSE_HEADERS"
  if [[ -n "$STATEFUL_COOKIE_JAR" ]]; then
    rm -f "$STATEFUL_COOKIE_JAR"
  fi
}
trap cleanup EXIT

extract_token_from_login_response() {
  local body_file="$1"
  local headers_file="$2"
  local token=""

  if command -v jq >/dev/null 2>&1; then
    token="$(jq -r '.VALKYR_AUTH // .data.VALKYR_AUTH // .token // .session // .jwt // .jwtSession // .data.jwtSession // empty' "$body_file" 2>/dev/null || true)"
  fi
  if [[ -n "$token" && "$token" != "null" ]]; then
    printf '%s\n' "$token"
    return 0
  fi

  token="$(tr -d '\r' < "$headers_file" | grep -i 'set-cookie: .*VALKYR_AUTH=' | sed -E 's/.*VALKYR_AUTH=([^;]+).*/\1/' | head -n 1 || true)"
  if [[ -n "$token" ]]; then
    printf '%s\n' "$token"
    return 0
  fi

  token="$(tr -d '\r' < "$headers_file" | grep -i '^VALKYR_AUTH:' | sed -E 's/^[^:]+:[[:space:]]*//' | head -n 1 || true)"
  if [[ -n "$token" ]]; then
    printf '%s\n' "$token"
    return 0
  fi

  token="$(tr -d '\r' < "$headers_file" | grep -i '^authorization:' | sed -E 's/^[^:]+:[[:space:]]*Bearer[[:space:]]+//' | head -n 1 || true)"
  if [[ -n "$token" ]]; then
    printf '%s\n' "$token"
    return 0
  fi
}

refresh_token() {
  if [[ -z "$USERNAME" || -z "$PASSWORD" ]]; then
    return 1
  fi

  local login_body
  local login_headers
  local login_status
  login_body="$(portable_mktemp graymatter-login-body.XXXXXX)"
  login_headers="$(portable_mktemp graymatter-login-headers.XXXXXX)"

  set +e
  login_status="$(
    curl -sS \
      --connect-timeout "$CURL_CONNECT_TIMEOUT" \
      --max-time "$CURL_MAX_TIME" \
      -o "$login_body" -D "$login_headers" -w "%{http_code}" \
      -X POST "${BASE%/}/${LOGIN_PATH#/}" \
      -H "accept: application/json" \
      -H "content-type: application/json" \
      --data "$(jq -nc --arg username "$USERNAME" --arg password "$PASSWORD" '{username:$username,password:$password}')"
  )"
  local curl_status=$?
  set -e

  if (( curl_status != 0 )) || [[ ! "$login_status" =~ ^[0-9]{3}$ ]] || (( login_status >= 400 )); then
    rm -f "$login_body" "$login_headers"
    return 1
  fi

  local refreshed_token
  refreshed_token=$(extract_token_from_login_response "$login_body" "$login_headers")
  rm -f "$login_body" "$login_headers"

  if [[ -z "$refreshed_token" ]]; then
    return 1
  fi

  TOKEN=$refreshed_token
  if token_is_clearly_read_only "$TOKEN"; then
    return 0
  fi
  store_token "$TOKEN"
  return 0
}

prepare_stateful_auth_for_write() {
  if [[ -z "$USERNAME" || -z "$PASSWORD" || "$LIGHT_MODE" == "true" ]]; then
    return 1
  fi

  local login_body
  local login_headers
  local login_status
  login_body="$(portable_mktemp graymatter-login-body.XXXXXX)"
  login_headers="$(portable_mktemp graymatter-login-headers.XXXXXX)"
  STATEFUL_COOKIE_JAR="$(portable_mktemp graymatter-login-cookie.XXXXXX)"

  set +e
  login_status="$(
    curl -sS \
      --connect-timeout "$CURL_CONNECT_TIMEOUT" \
      --max-time "$CURL_MAX_TIME" \
      -o "$login_body" -D "$login_headers" -c "$STATEFUL_COOKIE_JAR" \
      -w "%{http_code}" \
      -X POST "${BASE%/}/${LOGIN_PATH#/}" \
      -H "accept: application/json" \
      -H "content-type: application/json" \
      --data "$(jq -nc --arg username "$USERNAME" --arg password "$PASSWORD" '{username:$username,password:$password}')"
  )"
  local curl_status=$?
  set -e

  if (( curl_status != 0 )) || [[ ! "$login_status" =~ ^[0-9]{3}$ ]] || (( login_status >= 400 )); then
    rm -f "$login_body" "$login_headers"
    return 1
  fi

  local refreshed_token
  refreshed_token=$(extract_token_from_login_response "$login_body" "$login_headers")
  if [[ -z "$refreshed_token" && -s "$STATEFUL_COOKIE_JAR" ]]; then
    refreshed_token=$(awk '$6 == "VALKYR_AUTH" {print $7}' "$STATEFUL_COOKIE_JAR" | tail -n 1)
  fi
  STATEFUL_XSRF_TOKEN="$(awk '$6 == "XSRF-TOKEN" {print $7}' "$STATEFUL_COOKIE_JAR" | tail -n 1)"
  rm -f "$login_body" "$login_headers"

  if [[ -n "$refreshed_token" ]]; then
    TOKEN=$refreshed_token
    store_token "$TOKEN"
    return 0
  fi

  [[ -s "$STATEFUL_COOKIE_JAR" && -n "$STATEFUL_XSRF_TOKEN" ]]
}

if [[ -n "$TOKEN" ]] && token_expires_soon "$TOKEN"; then
  if refresh_token && [[ -n "$TOKEN" ]] && ! token_expires_soon "$TOKEN"; then
    :
  elif run_login && [[ -n "$TOKEN" ]] && ! token_expires_soon "$TOKEN"; then
    :
  fi
fi

if method_requires_write_access && [[ -n "$TOKEN" ]] && token_is_clearly_read_only "$TOKEN"; then
  if refresh_token && [[ -n "$TOKEN" ]] && ! token_is_clearly_read_only "$TOKEN"; then
    :
  elif run_login && [[ -n "$TOKEN" ]] && ! token_is_clearly_read_only "$TOKEN"; then
    :
  else
    fail_read_only_token
  fi
fi

perform_request() {
  COMMON_HEADERS=(
    -H "accept: application/json"
  )
  if [[ -n "$TOKEN" ]]; then
    COMMON_HEADERS+=(
      -H "Authorization: Bearer ${TOKEN}"
      -H "VALKYR_AUTH: ${TOKEN}"
    )
    if [[ -z "$STATEFUL_COOKIE_JAR" ]]; then
      COMMON_HEADERS+=(
        -H "Cookie: VALKYR_AUTH=${TOKEN}"
      )
    fi
  fi
  if [[ -n "$STATEFUL_XSRF_TOKEN" ]]; then
    COMMON_HEADERS+=(
      -H "X-XSRF-TOKEN: ${STATEFUL_XSRF_TOKEN}"
    )
  fi
  local tenant_id
  tenant_id="$(resolve_tenant_id)"
  if [[ -n "$tenant_id" ]]; then
    COMMON_HEADERS+=(
      -H "X-Tenant-Id: ${tenant_id}"
    )
  fi

  CURL_ARGS=(
    -sS
    --connect-timeout "$CURL_CONNECT_TIMEOUT"
    --max-time "$CURL_MAX_TIME"
    -o "$RESPONSE_FILE"
    -D "$RESPONSE_HEADERS"
    -w "%{http_code}"
    -X "$METHOD_UPPER"
    "$URL"
    "${COMMON_HEADERS[@]}"
  )

  if [[ -n "$STATEFUL_COOKIE_JAR" && -s "$STATEFUL_COOKIE_JAR" ]]; then
    CURL_ARGS+=(
      -b "$STATEFUL_COOKIE_JAR"
    )
  fi

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
}

if method_requires_write_access; then
  prepare_stateful_auth_for_write || true
fi

perform_request

if [[ "$HTTP_STATUS" == "401" || "$HTTP_STATUS" == "403" ]]; then
  if refresh_token; then
    perform_request
  elif run_login && [[ -n "$TOKEN" ]]; then
    perform_request
  fi
fi

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
      show_insufficient_funds_guidance "$RESPONSE_FILE"
    fi
  elif grep -q "INSUFFICIENT_FUNDS" "$RESPONSE_FILE" 2>/dev/null; then
    show_insufficient_funds_guidance "$RESPONSE_FILE"
  fi

  exit 22
fi

cat "$RESPONSE_FILE"
