#!/bin/sh

if [ -n "${NC_TOOL_DIR:-}" ]; then
  mkdir -p "${NC_TOOL_DIR}"
fi

if [ -n "${AWS_ACCESS_KEY_ID:-}" ] \
  && [ -n "${AWS_SECRET_ACCESS_KEY:-}" ] \
  && [ -n "${AWS_BUCKET:-}" ] \
  && [ -n "${AWS_BUCKET_PATH:-}" ]; then
  database_path="${NC_TOOL_DIR%/}/noco.db"
  replica_url="s3://${AWS_BUCKET}/${AWS_BUCKET_PATH}"

  if [ -f "${database_path}" ]; then
    rm -f "${database_path}" "${database_path}-shm" "${database_path}-wal"
  fi

  litestream restore -o "${database_path}" "${replica_url}"
  if [ ! -f "${database_path}" ]; then
    touch "${database_path}"
  fi
  litestream replicate "${database_path}" "${replica_url}" &
fi

exec node docker/index.js
