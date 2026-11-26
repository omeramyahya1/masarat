#!/usr/bin/env bash
# One load-test run at one server size, or a series of loads to find where a size stops meeting
# the SLOs. Each run's results go to loadtest/results/<label>/scale-<scale>/:
#   summary.json   k6's end-of-test summary (p95 per kind and endpoint, request rate, errors)
#   k6.txt         k6's text output, with the thresholds that passed or failed
#   stats.csv      every 5 s: API CPU (cores) and memory, Postgres CPU (cores) and memory
#   queries.txt    Postgres's slowest queries in total time (pg_stat_statements)
#   result         PASS or FAIL
#
#   loadtest/run.sh <label> <api-cpus> <db-cpus> <db-mem> <pool> <scale> [duration] [flows]
#   loadtest/run.sh knee <label> <api-cpus> <db-cpus> <db-mem> <pool> "<scale> <scale> …" [duration] [flows]
#
#   loadtest/run.sh api2-db4 0-1 4-7 8g 20 1          the target load on 2 + 4 CPUs
#   loadtest/run.sh knee api2-db4 0-1 4-7 8g 20 "0.5 1 1.5 2 3 4"
#
# The data must have been seeded first (loadtest/README.md). k6 runs on CPUs 12-19.
set -uo pipefail
cd "$(dirname "$0")/.."
K6=${K6:-$(command -v k6 || echo "$HOME/.local/bin/k6")}
STATE=$PWD/loadtest/.state
DB=masarat_load_db

psql_load() { podman exec "$DB" psql -U masarat -d masarat_load -qAt -c "$1"; }

# CPU time in microseconds and memory in bytes: the API process, and the Postgres container
api_cpu_us() { awk '{ print int(($14 + $15) * 1000000 / 100) }' "/proc/$(cat "$STATE/api.pid")/stat"; }
api_rss() { awk '/VmRSS/ { print $2 * 1024 }' "/proc/$(cat "$STATE/api.pid")/status"; }
db_cpu_us() { podman exec "$DB" awk '/usage_usec/ { print $2 }' /sys/fs/cgroup/cpu.stat; }
db_mem() { podman exec "$DB" cat /sys/fs/cgroup/memory.current; }

sample() {
  local out=$1 prev_api prev_db now_api now_db t=0
  echo "seconds,api_cores,api_rss_mb,db_cores,db_mem_mb" >"$out"
  prev_api=$(api_cpu_us) prev_db=$(db_cpu_us)
  while sleep 5; do
    t=$((t + 5))
    now_api=$(api_cpu_us 2>/dev/null) || break
    now_db=$(db_cpu_us 2>/dev/null) || break
    echo "$t,$(awk -v a="$now_api" -v b="$prev_api" 'BEGIN { printf "%.2f", (a - b) / 5000000 }'),$(($(api_rss) / 1048576)),$(awk -v a="$now_db" -v b="$prev_db" 'BEGIN { printf "%.2f", (a - b) / 5000000 }'),$(($(db_mem) / 1048576))" >>"$out"
    prev_api=$now_api prev_db=$now_db
  done
}

run_one() {
  local label=$1 api_cpus=$2 db_cpus=$3 db_mem=$4 pool=$5 scale=$6 duration=${7:-5m}
  local flows=${8:-booking,browse,govt,exportData,verify}
  local dir=loadtest/results/$label/scale-$scale
  mkdir -p "$dir"
  echo "== $label: API on CPUs $api_cpus (pool $pool), Postgres on $db_cpus with $db_mem; scale $scale for $duration"
  # Same size as last time: keep Postgres running, so its cache stays warm
  if [[ $(cat "$STATE/db-size" 2>/dev/null) != "$db_cpus $db_mem" ]]; then
    loadtest/stack.sh db-up "$db_cpus" "$db_mem" >/dev/null
    echo "$db_cpus $db_mem" >"$STATE/db-size"
    # Warm the cache the way a running server would be: a short run that isn't measured
    loadtest/stack.sh api-up "$api_cpus" "$pool" >/dev/null
    (cd loadtest/k6 && taskset -c 12-19 "$K6" run --quiet --summary-mode disabled -e SCALE=0.3 -e DURATION=90s mixed.js >/dev/null 2>&1)
  fi
  loadtest/stack.sh api-up "$api_cpus" "$pool" >/dev/null
  # Queries left running by an earlier run (Bun drops a request after 10 s, Postgres carries on)
  psql_load "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'masarat_load'
             AND pid <> pg_backend_pid() AND state <> 'idle'" >/dev/null
  psql_load 'SELECT pg_stat_statements_reset()' >/dev/null
  sample "$dir/stats.csv" &
  local sampler=$!
  (cd loadtest/k6 && taskset -c 12-19 "$K6" run -e SCALE="$scale" -e DURATION="$duration" -e FLOWS="$flows" \
    --summary-export "../../$dir/summary.json" mixed.js) >"$dir/k6.txt" 2>&1
  local code=$?
  kill "$sampler" 2>/dev/null
  wait "$sampler" 2>/dev/null
  psql_load "SELECT round(total_exec_time)::text || ' ms total, ' || calls || ' calls, ' || round(mean_exec_time::numeric, 1) || ' ms mean: ' || regexp_replace(left(query, 400), '\s+', ' ', 'g')
             FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = 'masarat_load')
             ORDER BY total_exec_time DESC LIMIT 25" >"$dir/queries.txt"
  tail -50 "$STATE/api.log" >"$dir/api.log"
  # k6 exits 99 when a threshold failed
  if [[ $code -eq 0 ]]; then echo PASS >"$dir/result"; else echo FAIL >"$dir/result"; fi
  echo "   $(cat "$dir/result") (k6 exit $code)"
  [[ $code -eq 0 ]]
}

if [[ ${1:-} == knee ]]; then
  shift
  label=$1 api_cpus=$2 db_cpus=$3 db_mem=$4 pool=$5 scales=$6 duration=${7:-5m} flows=${8:-}
  for scale in $scales; do
    run_one "$label" "$api_cpus" "$db_cpus" "$db_mem" "$pool" "$scale" "$duration" "$flows" || break
  done
else
  [[ $# -ge 6 ]] || {
    sed -n 2,17p "$0"
    exit 1
  }
  run_one "$@"
fi
