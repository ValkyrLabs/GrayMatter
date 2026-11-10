#!/usr/bin/env bash
set -euo pipefail
# Optional private-backend check. Keep the standalone public suite runnable;
# passing a classpath explicitly requires the real compiled backend below.
if [[ $# -eq 0 ]]; then
  echo 'gm_receipt_workflow_test: SKIP (pass a compiled ValkyrAI test classpath file to run this optional check)'
  exit 0
fi
[[ $# -eq 1 && -r "$1" ]] || { echo 'Usage: gm_receipt_workflow_test.sh /path/to/valkyrai-test-classpath.txt' >&2; exit 2; }
# Use the compiled application's dependency list, including its test dependencies.
root="$(cd "$(dirname "$0")/.." && pwd)"
backend="$(cd "${VALKYRAI_BACKEND:-$root/../ValkyrAI/valkyrai}" && pwd)"
build="$backend/target"
if [[ -f "$backend/../.vaix/maven/valkyrai/classes/com/valkyrlabs/workflow/modules/skilloptics/SkillObserveOutcomeModule.class" ]]; then
  build="$backend/../.vaix/maven/valkyrai"
fi
dep_cp="$(cat "${1:?Usage: gm_receipt_workflow_test.sh /path/to/valkyrai-test-classpath.txt}")"
IFS=: read -r -a deps <<< "$dep_cp"
mock_agent=''
for jar in "${deps[@]}"; do
  case "$jar" in */mockito-core-*.jar) mock_agent="$jar"; break;; esac
done
[[ -f "$mock_agent" ]] || { echo "Compiled ValkyrAI test dependencies must include Mockito 5.15+." >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
cd "$work"
java -javaagent:"$mock_agent" --class-path "$root/examples:$build/classes:$build/test-classes:$dep_cp" \
  "$root/tests/GrayMatterReceiptWorkflowTest.java"
