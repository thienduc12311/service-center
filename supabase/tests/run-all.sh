#!/usr/bin/env bash
# Runs every supabase/tests/*.sql suite against the local Supabase database.
# Each suite is wrapped in an outer begin/rollback (suites also end in rollback)
# and runs with ON_ERROR_STOP, so nothing persists. A failed psql session drops
# its connection, which aborts the open transaction.
#
# Usage: supabase/tests/run-all.sh [--concurrency] [pattern ...]
#   --concurrency  also run the *.sh concurrency scripts (these COMMIT data to the
#                  seed org and are NOT rolled back; use only on a disposable DB)
#   pattern        substring filter on file names (e.g. f08 i18n)
set -u
cd "$(dirname "$0")"
CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_service-center}"
RUN_SH=0
PATTERNS=()
for arg in "$@"; do
  case "$arg" in
    --concurrency) RUN_SH=1 ;;
    *) PATTERNS+=("$arg") ;;
  esac
done

matches() {
  [ ${#PATTERNS[@]} -eq 0 ] && return 0
  for p in "${PATTERNS[@]}"; do case "$1" in *"$p"*) return 0 ;; esac; done
  return 1
}

pass=0; fail=0; failed=()
for f in *.sql; do
  matches "$f" || continue
  out=$( { echo "begin;"; cat "$f"; echo "rollback;"; } |
    docker exec -i "$CONTAINER" psql -U postgres -v ON_ERROR_STOP=1 -q 2>&1 )
  rc=$?
  if [ $rc -eq 0 ]; then
    echo "PASS $f"; pass=$((pass+1))
  else
    echo "FAIL $f (exit $rc)"; echo "$out" | grep -i -m3 -E 'error|fail' | sed 's/^/     /'
    fail=$((fail+1)); failed+=("$f")
  fi
done

if [ $RUN_SH -eq 1 ]; then
  for f in *.sh; do
    [ "$f" = "run-all.sh" ] && continue
    matches "$f" || continue
    if bash "$f" >/dev/null 2>&1; then echo "PASS $f"; pass=$((pass+1))
    else echo "FAIL $f"; fail=$((fail+1)); failed+=("$f"); fi
  done
else
  echo "(skipping *.sh concurrency scripts; pass --concurrency to run them)"
fi

echo "---- $pass passed, $fail failed"
[ $fail -eq 0 ] || { printf 'failed: %s\n' "${failed[@]}"; exit 1; }
