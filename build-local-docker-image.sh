#!/bin/bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" &>/dev/null && pwd)
LOG_FILE=${SCRIPT_DIR}/build-local-docker-image.log

cd "${SCRIPT_DIR}"

echo "Info: Stopping and removing the existing local container and image" | tee "${LOG_FILE}"
docker stop nocodb-local >>"${LOG_FILE}" 2>&1 || true
docker rm nocodb-local >>"${LOG_FILE}" 2>&1 || true
docker rmi nocodb-local >>"${LOG_FILE}" 2>&1 || true

echo "Info: Installing the frozen workspace" | tee -a "${LOG_FILE}"
pnpm install --frozen-lockfile >>"${LOG_FILE}" 2>&1

echo "Info: Building and staging the Community application" | tee -a "${LOG_FILE}"
pnpm run build:community >>"${LOG_FILE}" 2>&1

echo "Info: Building the frozen-lockfile Docker image" | tee -a "${LOG_FILE}"
docker build . -f packages/nocodb/Dockerfile.local -t nocodb-local >>"${LOG_FILE}" 2>&1

echo 'Docker image "nocodb-local" built successfully.' | tee -a "${LOG_FILE}"
echo 'Run it with: docker run -d -p 3333:8080 --name nocodb-local nocodb-local' | tee -a "${LOG_FILE}"
