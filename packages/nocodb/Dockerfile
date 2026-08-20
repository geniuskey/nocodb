# syntax=docker/dockerfile:1

ARG NODE_IMAGE=node:22.12.0-alpine@sha256:51eff88af6dff26f59316b6e356188ffa2c422bd3c3b76f2556a2e7e89d080bd

######################
# Litestream downloader
######################
FROM --platform=$BUILDPLATFORM ${NODE_IMAGE} AS litestream-fetcher

ARG TARGETARCH
ARG TARGETVARIANT
ARG LITESTREAM_VERSION=v0.3.13
ARG LITESTREAM_COMMIT=977d4a5ee45ae546537324a3cfbf926de3bebc97

RUN apk add --no-cache ca-certificates curl \
    && set -eu; \
    case "${TARGETARCH}/${TARGETVARIANT}" in \
      amd64/) asset_arch=amd64; checksum=eb75a3de5cab03875cdae9f5f539e6aedadd66607003d9b1e7a9077948818ba0 ;; \
      arm64/) asset_arch=arm64; checksum=9585f5a508516bd66af2b2376bab4de256a5ef8e2b73ec760559e679628f2d59 ;; \
      arm/v6) asset_arch=arm6; checksum=f3efe0b6927cdad1831e679db5cd430bc86afff0a69e8fa3cd1e93a4c6d2f474 ;; \
      arm/v7) asset_arch=arm7; checksum=225f2d0ec431dd32d38ee47e3941eb72fe0316aaffd941185ba30f7c6de21866 ;; \
      *) echo "Unsupported Litestream target: ${TARGETARCH}/${TARGETVARIANT}" >&2; exit 1 ;; \
    esac; \
    archive="litestream-${LITESTREAM_VERSION}-linux-${asset_arch}.tar.gz"; \
    curl --fail --location --silent --show-error \
      "https://github.com/benbjohnson/litestream/releases/download/${LITESTREAM_VERSION}/${archive}" \
      --output "/tmp/${archive}"; \
    echo "${checksum}  /tmp/${archive}" | sha256sum -c -; \
    mkdir -p /out; \
    tar -xzf "/tmp/${archive}" -C /out; \
    chmod +x /out/litestream; \
    curl --fail --location --silent --show-error \
      "https://raw.githubusercontent.com/benbjohnson/litestream/${LITESTREAM_COMMIT}/LICENSE" \
      --output /out/LICENSE; \
    echo "58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd  /out/LICENSE" \
      | sha256sum -c -

# This optional target lets CI execute the selected target-architecture binary
# without rebuilding the application dependency closure.
FROM ${NODE_IMAGE} AS litestream-validator
ARG LITESTREAM_VERSION=v0.3.13
COPY --link --from=litestream-fetcher /out/litestream /usr/local/bin/litestream
RUN test "$(litestream version)" = "${LITESTREAM_VERSION}"

################
# NocoDB builder
################
FROM ${NODE_IMAGE} AS builder
WORKDIR /workspace

ENV npm_config_nodedir=/usr/local

RUN apk add --no-cache \
      g++ \
      make \
      py3-setuptools \
      python3 \
    && npm install --global pnpm@9.15.5

# The repository root is the build context. Copy the frozen workspace graph and
# only the source required by the backend's local production dependencies.
COPY --link .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY --link packages/nocodb/package.json ./packages/nocodb/package.json
COPY --link packages/nocodb-sdk/package.json ./packages/nocodb-sdk/package.json
COPY --link packages/nocodb-sdk/build/ ./packages/nocodb-sdk/build/
COPY --link packages/nc-knex-dialects/ ./packages/nc-knex-dialects/
COPY --link packages/nc-gui/.patches/ ./packages/nc-gui/.patches/

# Deploy a portable production dependency tree from the frozen lockfile. The
# root lifecycle hooks only prepare a developer worktree, so they are removed
# from the copied manifest without suppressing dependency lifecycle scripts.
RUN npm pkg delete scripts.preinstall scripts.prepare \
    && pnpm --filter nocodb deploy --prod --frozen-lockfile /workspace/deploy/nocodb \
    && test -f /workspace/deploy/nocodb/node_modules/nocodb-sdk/build/main/index.js \
    && test -f /workspace/deploy/nocodb/node_modules/knex-snowflake/src/index.js \
    && test -f /workspace/deploy/nocodb/node_modules/knex-databricks/src/index.js \
    && cd /workspace/deploy/nocodb \
    && node -e "require('sqlite3'); require('sharp')" \
    && rm -rf /workspace/deploy/nocodb/node_modules/sqlite3/deps

COPY --link packages/nocodb/docker/main.js /workspace/deploy/nocodb/docker/index.js
COPY --link packages/nocodb/docker/start-litestream.sh /usr/src/appEntry/start.sh
COPY --link packages/nocodb/src/public/ /workspace/deploy/nocodb/docker/public/
COPY --link packages/nocodb/docker/nc-gui/ /workspace/deploy/nocodb/docker/nc-gui/

# Git may materialize shell scripts with CRLF on Windows build hosts.
RUN sed -i 's/\r$//' /usr/src/appEntry/start.sh \
    && chmod +x /usr/src/appEntry/start.sh

########
# Runner
########
FROM ${NODE_IMAGE}
WORKDIR /usr/src/app

ENV LITESTREAM_S3_SKIP_VERIFY=false \
    LITESTREAM_RETENTION=1440h \
    LITESTREAM_RETENTION_CHECK_INTERVAL=72h \
    LITESTREAM_SNAPSHOT_INTERVAL=24h \
    LITESTREAM_SYNC_INTERVAL=60s \
    NC_DOCKER=0.6 \
    NC_TOOL_DIR=/usr/app/data/ \
    NODE_ENV=production \
    PORT=8080

RUN apk add --no-cache curl dumb-init

COPY --link --from=litestream-fetcher /out/litestream /usr/local/bin/litestream
COPY --link --from=litestream-fetcher /out/LICENSE /usr/share/licenses/litestream/LICENSE
COPY --link --from=builder /workspace/deploy/nocodb/ /usr/src/app/
COPY --link --from=builder /usr/src/appEntry/ /usr/src/appEntry/

EXPOSE 8080
ENTRYPOINT ["/usr/bin/dumb-init", "--"]
CMD ["/usr/src/appEntry/start.sh"]
