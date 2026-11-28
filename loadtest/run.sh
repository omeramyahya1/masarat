#!/usr/bin/env bash
# One load-test run at one server size, or a series of loads to find where a size stops meeting
# the SLOs. Each run's results go to loadtest/results/<label>/scale-<scale>/:
#   summary.json   k6's end-of-test summary (p95 per kind and endpoint, request rate, errors)
#   k6.txt         k6's text output, with the thresholds that passed or failed
#   stats.csv      every 5 s: CPU (cores) and memory of the API (every process together), the
#                  export worker, Postgres, Redis and MinIO
#   queries.txt    Postgres's slowest queries in total time (pg_stat_statements)
#   failed         the thresholds (SLOs) that failed
#   result         PASS, FAIL, or EXPORT-ONLY (only the exports' SLOs failed: the export worker
#                  fell behind; a knee series goes on past it)
#
#   loadtest/run.sh <label> <api-cpus> <db-cpus> <db-mem> <pool> <scale> [duration] [flows]
#   loadtest/run.sh knee <label> <api-cpus> <db-cpus> <db-mem> <pool> "<scale> <scale> …" [duration] [flows]
#
#   loadtest/run.sh api2-db4 0-1 4-7 8g 20 1          the target load on 2 + 4 CPUs
#   loadtest/run.sh knee api2-db4 0-1 4-7 8g 20 "0.5 1 1.5 2 3 4"
#
# The data must have been seeded first (loadtest/README.md). The export worker runs on CPUs 2-3
# (WORKER_CPUS), k6 on 12-19 (K6_CPUS). API_PROCS=2 runs two API processes sharing the port;
# TRIPS_PER_DAY sets the booking rate (k6/mixed.js). Redis and MinIO are sampled, and pinned
# by `stack.sh services-up <redis-cpus> <minio-cpus>`.
set -uo pipefail
cd "$(dirname "$0")/.."
K6=${K6:-$(command -v k6 || echo "$HOME/.local/bin/k6")}
STATE=$PWD/loadtest/.state
DB=masarat_load_db

psql_load() { podman exec "$DB" psql -U masarat -d masarat_load -qAt -c "$1"; }

K6_CPUS=${K6_CPUS:-12-19}
TRIPS_PER_DAY=${TRIPS_PER_DAY:-20000}

# CPU time in microseconds and memory in bytes of processes (summed), and of the Postgres container
cpu_us() {
  local p total=0
  for p in "$@"; do total=$((total + $(awk '{ print int(($14 + $15) * 1000000 / 100) }' "/proc/$p/stat"))); done
  echo "$total"
}
rss() {
  local p total=0
  for p in "$@"; do total=$((total + $(awk '/VmRSS/ { print $2 * 1024 }' "/proc/$p/status"))); done
  echo "$total"
}
api_pids() { cat "$STATE/api.pid"; }
service_pid() { podman inspect -f '{{.State.Pid}}' "masarat_$1_1"; }
# shellcheck disable=SC2046
api_cpu_us() { cpu_us $(api_pids); }
# shellcheck disable=SC2046
api_rss() { rss $(api_pids); }
worker_cpu_us() { cpu_us "$(cat "$STATE/worker.pid")"; }
worker_rss() { rss "$(cat "$STATE/worker.pid")"; }
db_cpu_us() { podman exec "$DB" awk '/usage_usec/ { print $2 }' /sys/fs/cgroup/cpu.stat; }
db_mem() { podman exec "$DB" cat /sys/fs/cgroup/memory.current; }

sample() {
  local out=$1 t=0 redis minio
  redis=$(service_pid redis) minio=$(service_pid minio)
  echo "seconds,api_cores,api_rss_mb,worker_cores,worker_rss_mb,db_cores,db_mem_mb,redis_cores,redis_rss_mb,minio_cores,minio_rss_mb" >"$out"
  local prev_api prev_db prev_worker prev_redis prev_minio now_api now_db now_worker now_redis now_minio
  prev_api=$(api_cpu_us) prev_db=$(db_cpu_us) prev_worker=$(worker_cpu_us)
  prev_redis=$(cpu_us "$redis") prev_minio=$(cpu_us "$minio")
  cores() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.2f", (a - b) / 5000000 }'; }
  while sleep 5; do
    t=$((t + 5))
    now_api=$(api_cpu_us 2>/dev/null) || break
    now_db=$(db_cpu_us 2>/dev/null) || break
    now_worker=$(worker_cpu_us 2>/dev/null) || break
    now_redis=$(cpu_us "$redis" 2>/dev/null) || break
    now_minio=$(cpu_us "$minio" 2>/dev/null) || break
    echo "$t,$(cores "$now_api" "$prev_api"),$(($(api_rss) / 1048576)),$(cores "$now_worker" "$prev_worker"),$(($(worker_rss) / 1048576)),$(cores "$now_db" "$prev_db"),$(($(db_mem) / 1048576)),$(cores "$now_redis" "$prev_redis"),$(($(rss "$redis") / 1048576)),$(cores "$now_minio" "$prev_minio"),$(($(rss "$minio") / 1048576))" >>"$out"
    prev_api=$now_api prev_db=$now_db prev_worker=$now_worker prev_redis=$now_redis prev_minio=$now_minio
  done
}

# The thresholds that failed, one per line, and the verdict: EXPORT-ONLY when every failure is the
# exports' own (their SLOs, or iterations dropped by the export scenario alone)
verdict() {
  local summary=$1 dir=$2
  jq -r '.metrics | to_entries[] | select(.value.thresholds) | select([.value.thresholds[]] | any) | .key' \
    "$summary" >"$dir/failed"
  [[ -s $dir/failed ]] || { echo PASS; return; }
  local dropped export_dropped others
  dropped=$(jq '.metrics.dropped_iterations.count // 0' "$summary")
  export_dropped=$(jq '.metrics["dropped_iterations{scenario:exportData}"].count // 0' "$summary")
  others=$(grep -cvE '^(export_job_ms|export_ok|http_req_duration\{kind:export\}|dropped_iterations\{scenario:exportData\})$' "$dir/failed")
  if grep -qx dropped_iterations "$dir/failed" && [[ $dropped == "$export_dropped" ]]; then
    others=$((others - 1))
  fi
  if ((others == 0)); then echo EXPORT-ONLY; else echo FAIL; fi
}

run_one() {
  local label=$1 api_cpus=$2 db_cpus=$3 db_mem=$4 pool=$5 scale=$6 duration=${7:-5m}
  local flows=${8:-booking,browse,govtDashboard,govtReview,exportData,verify,login}
  local dir=loadtest/results/$label/scale-$scale
  mkdir -p "$dir"
  echo "== $label: API on CPUs $api_cpus (pool $pool), Postgres on $db_cpus with $db_mem; scale $scale for $duration"
  # The export worker, on its own CPUs (it would be its own server)
  loadtest/stack.sh worker-up "${WORKER_CPUS:-2-3}" >/dev/null || { echo "   FAIL (export worker didn't start)"; return 1; }
  # Same size as last time: keep Postgres running, so its cache stays warm
  if [[ $(cat "$STATE/db-size" 2>/dev/null) != "$db_cpus $db_mem" ]]; then
    loadtest/stack.sh db-up "$db_cpus" "$db_mem" >/dev/null
    echo "$db_cpus $db_mem" >"$STATE/db-size"
    # Warm the cache the way a running server would be: a short run that isn't measured
    loadtest/stack.sh api-up "$api_cpus" "$pool" >/dev/null
    (cd loadtest/k6 && taskset -c "$K6_CPUS" "$K6" run --quiet --summary-mode disabled -e SCALE=0.3 -e DURATION=90s \
      -e TRIPS_PER_DAY="$TRIPS_PER_DAY" mixed.js >/dev/null 2>&1)
  fi
  loadtest/stack.sh api-up "$api_cpus" "$pool" >/dev/null || { echo "   FAIL (the API didn't start)"; return 1; }
  # Exports queued by an earlier run (or the warm-up)
  podman exec masarat_redis_1 redis-cli -n 1 --scan --pattern 'exports:*' 2>/dev/null |
    xargs -r podman exec masarat_redis_1 redis-cli -n 1 del >/dev/null 2>&1 || true
  # Queries left running by an earlier run (Bun drops a request after 10 s, Postgres carries on)
  psql_load "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'masarat_load'
             AND pid <> pg_backend_pid() AND state <> 'idle'" >/dev/null
  psql_load 'SELECT pg_stat_statements_reset()' >/dev/null
  # A summary left by an earlier run of this label and scale must not decide this one
  rm -f "$dir/summary.json" "$dir/failed"
  sample "$dir/stats.csv" &
  local sampler=$!
  (cd loadtest/k6 && taskset -c "$K6_CPUS" "$K6" run -e SCALE="$scale" -e DURATION="$duration" -e FLOWS="$flows" \
    -e TRIPS_PER_DAY="$TRIPS_PER_DAY" --summary-export "../../$dir/summary.json" mixed.js) >"$dir/k6.txt" 2>&1
  local code=$?
  kill "$sampler" 2>/dev/null
  wait "$sampler" 2>/dev/null
  psql_load "SELECT round(total_exec_time)::text || ' ms total, ' || calls || ' calls, ' || round(mean_exec_time::numeric, 1) || ' ms mean: ' || regexp_replace(left(query, 400), '\s+', ' ', 'g')
             FROM pg_stat_statements WHERE dbid = (SELECT oid FROM pg_database WHERE datname = 'masarat_load')
             ORDER BY total_exec_time DESC LIMIT 25" >"$dir/queries.txt"
  tail -50 "$STATE/api.log" >"$dir/api.log"
  tail -50 "$STATE/worker.log" >"$dir/worker.log"
  # k6 exits 99 when a threshold failed; any other failure (a script error, an abort) is a FAIL
  # whatever the summary says
  if [[ $code -eq 0 ]]; then
    echo PASS >"$dir/result"
    : >"$dir/failed"
  elif [[ $code -eq 99 && -s $dir/summary.json ]]; then
    verdict "$dir/summary.json" "$dir" >"$dir/result"
  else
    echo FAIL >"$dir/result"
    echo "k6 exit $code" >"$dir/failed"
  fi
  echo "   $(cat "$dir/result") (k6 exit $code)$([[ -s $dir/failed ]] && echo ": $(tr '\n' ' ' <"$dir/failed")")"
  [[ $(cat "$dir/result") != FAIL ]]
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
