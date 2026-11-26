#!/usr/bin/env bash
# The load-test stack: Postgres in its own container (port 5434, volume masarat-load-pg, apart from
# the dev database) and the API run natively, each pinned to its own CPUs. Rootless podman here
# can't limit CPU time (only memory and pids are delegated to the user's cgroup), so the "size" of
# a server is the number of CPUs it is pinned to with taskset; memory is a real cgroup limit.
#
#   loadtest/stack.sh db-up   <cpus> <mem>     e.g. db-up 4-7 8g
#   loadtest/stack.sh api-up  <cpus> [pool]    e.g. api-up 0-1 20
#   loadtest/stack.sh worker-up <cpus>          the export worker, e.g. worker-up 2-3
#   loadtest/stack.sh services-up                Redis and MinIO (compose.yaml) and the load bucket
#   loadtest/stack.sh migrate | down | api-down | status
#
# CPU layout on the i7-12800H this was written on: 0-11 are the 6 performance cores (2 threads
# each), 12-19 the 8 efficiency cores. The API gets 0-1, the export worker 2-3, Postgres 4-11 and
# k6 12-19.
set -euo pipefail
cd "$(dirname "$0")/.."

DB_NAME=masarat_load_db
DB_PORT=5434
DB_IMAGE=public.ecr.aws/docker/library/postgres:18
# The owner (migrations, seeding) and the API's least-privileged role
export LOAD_DATABASE_URL="postgres://masarat:masarat@localhost:${DB_PORT}/masarat_load"
export LOAD_APP_URL="postgres://masarat_app:masarat_app@localhost:${DB_PORT}/masarat_load"
LOAD_BUCKET=masarat-load
API_PORT=3100
STATE=$PWD/loadtest/.state
mkdir -p "$STATE"

# Postgres settings for a server with this much memory (the usual starting points: a quarter for
# shared buffers, three quarters as the planner's cache estimate)
pg_flags() {
  local mem_mb=$1
  echo "-c shared_buffers=$((mem_mb / 4))MB -c effective_cache_size=$((mem_mb * 3 / 4))MB" \
    "-c work_mem=16MB -c maintenance_work_mem=$((mem_mb / 16))MB -c max_connections=200" \
    "-c shared_preload_libraries=pg_stat_statements -c pg_stat_statements.track=all" \
    "-c track_io_timing=on -c max_wal_size=8GB -c checkpoint_timeout=15min" \
    "-c random_page_cost=1.1 -c max_parallel_workers_per_gather=2"
}

to_mb() {
  case $1 in
    *g) echo $((${1%g} * 1024)) ;;
    *m) echo "${1%m}" ;;
    *) echo "$1" ;;
  esac
}

db_up() {
  local cpus=$1 mem=$2
  podman rm -f "$DB_NAME" >/dev/null 2>&1 || true
  # shellcheck disable=SC2046
  taskset -c "$cpus" podman run -d --name "$DB_NAME" \
    --memory "$mem" --shm-size 1g \
    -e POSTGRES_USER=masarat -e POSTGRES_PASSWORD=masarat -e POSTGRES_DB=masarat_load \
    -p "${DB_PORT}:5432" -v masarat-load-pg:/var/lib/postgresql \
    "$DB_IMAGE" postgres $(pg_flags "$(to_mb "$mem")") >/dev/null
  for _ in $(seq 60); do
    podman exec "$DB_NAME" pg_isready -U masarat -d masarat_load >/dev/null 2>&1 && break
    sleep 1
  done
  podman exec "$DB_NAME" psql -U masarat -d masarat_load -qc \
    'CREATE EXTENSION IF NOT EXISTS pg_stat_statements' >/dev/null
  echo "Postgres up on CPUs $cpus with $mem ($LOAD_DATABASE_URL)"
}

api_env() {
  # Every value set here, so apps/api/.env (the dev settings) doesn't leak in. The API runs as it
  # would in production: the app role, Redis and MinIO, and its logs written (JSON, info level)
  export DATABASE_URL=$LOAD_APP_URL MIGRATION_DATABASE_URL=$LOAD_DATABASE_URL PORT=$API_PORT \
    APP_ENV=development DEMO_MODE=true TRUST_PROXY=true STORAGE_DIR="$PWD/loadtest/.storage" \
    COOKIE_DOMAIN= SITE_URL=http://localhost:5175 OWNER_URL=http://localhost:5173 \
    GOVT_URL=http://localhost:5174 TZ=Africa/Khartoum \
    REDIS_URL=redis://localhost:6380/1 S3_BUCKET=$LOAD_BUCKET \
    LOG_DIR="$STATE/logs" LOG_LEVEL=info LOG_PRETTY=false INSTANCE_NAME=load-api
}

services_up() {
  podman compose up -d redis minio >/dev/null 2>&1 || docker compose up -d redis minio >/dev/null
  for _ in $(seq 30); do curl -sf http://localhost:9000/minio/health/live >/dev/null && break; sleep 1; done
  podman run --rm --network host -e MC_HOST_local=http://masarat:masarat-dev-secret@localhost:9000 \
    cgr.dev/chainguard/minio-client:latest mb --ignore-existing "local/$LOAD_BUCKET" >/dev/null
  echo "Redis and MinIO up; bucket $LOAD_BUCKET"
}

api_up() {
  local cpus=$1 pool=${2:-10}
  api_down
  api_env
  export DB_POOL_MAX=$pool
  (
    cd apps/api
    taskset -c "$cpus" bun src/index.ts >"$STATE/api.log" 2>&1 &
    echo $! >"$STATE/api.pid"
  )
  for _ in $(seq 60); do
    curl -sf "http://localhost:${API_PORT}/health/ready" >/dev/null && break
    sleep 1
  done
  echo "API up on CPUs $cpus, pool $pool, http://localhost:${API_PORT} (pid $(cat "$STATE/api.pid"))"
}

# The export worker (apps/api/src/exportWorker.ts): its own process on its own CPUs, as it would
# be its own server, with a small pool (it holds one connection per export it prepares)
worker_up() {
  local cpus=$1
  worker_down
  api_env
  export DB_POOL_MAX=8 INSTANCE_NAME=load-exports
  (
    cd apps/api
    taskset -c "$cpus" bun src/exportWorker.ts >"$STATE/worker.log" 2>&1 &
    echo $! >"$STATE/worker.pid"
  )
  for _ in $(seq 30); do
    grep -q 'Export worker started' "$STATE/worker.log" 2>/dev/null && break
    sleep 1
  done
  echo "Export worker up on CPUs $cpus (pid $(cat "$STATE/worker.pid"))"
}

worker_down() {
  if [[ -f $STATE/worker.pid ]]; then
    kill "$(cat "$STATE/worker.pid")" 2>/dev/null || true
    rm -f "$STATE/worker.pid"
    sleep 1
  fi
}

api_down() {
  if [[ -f $STATE/api.pid ]]; then
    kill "$(cat "$STATE/api.pid")" 2>/dev/null || true
    rm -f "$STATE/api.pid"
    sleep 1
  fi
}

case ${1:-} in
  db-up) db_up "${2:?cpus}" "${3:?memory}" ;;
  api-up) api_up "${2:?cpus}" "${3:-10}" ;;
  api-down) api_down ;;
  worker-up) worker_up "${2:?cpus}" ;;
  worker-down) worker_down ;;
  services-up) services_up ;;
  migrate)
    api_env
    (cd apps/api && bun src/db/migrate.ts)
    ;;
  seed)
    shift
    api_env
    (cd apps/api && bun src/scripts/loadSeed.ts "$@")
    ;;
  down)
    api_down
    worker_down
    podman rm -f "$DB_NAME" >/dev/null 2>&1 || true
    echo "Stopped (the data stays in the masarat-load-pg volume)"
    ;;
  wipe)
    api_down
    worker_down
    podman rm -f "$DB_NAME" >/dev/null 2>&1 || true
    podman volume rm masarat-load-pg >/dev/null 2>&1 || true
    rm -rf loadtest/.storage
    echo "Load-test database and storage removed"
    ;;
  status)
    podman ps --filter "name=$DB_NAME" --format '{{.Names}} {{.Status}}'
    [[ -f $STATE/api.pid ]] && echo "API pid $(cat "$STATE/api.pid")" || echo "API not running"
    [[ -f $STATE/worker.pid ]] && echo "Export worker pid $(cat "$STATE/worker.pid")" ||
      echo "Export worker not running"
    ;;
  *)
    sed -n 2,13p "$0"
    exit 1
    ;;
esac
