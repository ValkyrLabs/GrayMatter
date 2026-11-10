#!/usr/bin/env bash
set -euo pipefail
probe_dir=$(cd "$(dirname "$0")" && pwd)
[[ $# == 2 && ( "$1" == before || "$1" == after ) ]] || { echo 'Usage: run.sh before|after /path/to/graymatter-local-server.jar' >&2; exit 2; }
profile=$1
jar=$2
[[ -f "$jar" ]] || { echo 'Lite JAR not found' >&2; exit 2; }
jar=$(cd "$(dirname "$jar")" && pwd)/$(basename "$jar")
scratch=$(mktemp -d)
runtime=''
cleanup() {
  if [[ -n "$runtime" ]]; then
    kill "$runtime" 2>/dev/null || true
    wait "$runtime" 2>/dev/null || true
  fi
  rm -rf "$scratch"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
cd "$scratch"
export GRAYMATTER_ADMIN_PASSWORD
GRAYMATTER_ADMIN_PASSWORD=$(openssl rand -hex 24)
# The process receives no inherited Spring, hosted credential, or model configuration.
env -i PATH="$PATH" HOME="$HOME" GRAYMATTER_DATA_DIR="$scratch" \
  GRAYMATTER_ADMIN_USERNAME=admin GRAYMATTER_ADMIN_PASSWORD="$GRAYMATTER_ADMIN_PASSWORD" \
  GRAYMATTER_DB_URL='jdbc:h2:mem:probe;MODE=PostgreSQL;DATABASE_TO_LOWER=TRUE' \
  java -Djava.io.tmpdir="$scratch" -jar "$jar" --server.address=127.0.0.1 --server.port=0 > runtime.log 2>&1 &
runtime=$!
for ((attempt = 0; attempt < 120; attempt++)); do
  port=$(sed -nE 's/.*Tomcat started on port ([0-9]+).*/\1/p' runtime.log | tail -1)
  if [[ -n "$port" ]] && curl -fs --max-time 2 "http://127.0.0.1:$port/actuator/health" > /dev/null; then
    node "$probe_dir/probe.cjs" "$port" "$jar" "$profile"
    exit
  fi
  if ! kill -0 "$runtime" 2>/dev/null; then
    echo 'Isolated Lite runtime exited before becoming healthy.' >&2
    tail -12 runtime.log >&2
    exit 1
  fi
  sleep 1
done
echo 'Timed out waiting for the isolated Lite runtime.' >&2
exit 1
