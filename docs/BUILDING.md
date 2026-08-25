# Building the Community Foundation

These commands build the RowWeave modern AGPL foundation without using a later NocoDB
package, image, generated GUI, or Enterprise implementation.

## Prerequisites

- Git
- Node.js `22.12.0`
- pnpm `10.27.0`
- Docker Desktop or Docker Engine for the image build
- 16 GB of Node heap available for the frontend production build

The root `.npmrc` pins Node `22.12.0`, and `package.json` pins pnpm `10.27.0`.
Install the exact package-manager version if it is not already available:

```sh
npm install --global pnpm@10.27.0
node --version
pnpm --version
```

Expected versions are `v22.12.0` and `10.27.0`.

## Install dependencies

From the repository root:

```sh
CI=true pnpm install --frozen-lockfile
```

PowerShell:

```powershell
$env:CI = 'true'
pnpm install --frozen-lockfile
```

The root install intentionally does not generate the SDK. On a clean checkout,
the GUI postinstall reports that Nuxt preparation is deferred until the SDK is
built. The production and development commands below establish the required
order. The nested integration workspace is installed with its own frozen
lockfile by `pnpm run integrations:build` and `pnpm run build:community`.

## Development

Build the SDK and retained Community integration interface once:

```sh
pnpm run build:sdk
pnpm run integrations:build
```

Create a writable metadata directory, then start the backend:

```sh
mkdir -p .data
NC_TOOL_DIR="$PWD/.data" NC_DISABLE_TELE=true pnpm start:backend
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force .data | Out-Null
$env:NC_TOOL_DIR = (Resolve-Path .data).Path
$env:NC_DISABLE_TELE = 'true'
pnpm start:backend
```

The backend listens on `http://127.0.0.1:8080` unless `PORT` is set. In a
second terminal, start Nuxt:

```sh
NUXT_PUBLIC_NC_BACKEND_URL=http://127.0.0.1:8080 pnpm --filter nc-gui run dev -- --host 127.0.0.1 --port 3000
```

PowerShell:

```powershell
$env:NUXT_PUBLIC_NC_BACKEND_URL = 'http://127.0.0.1:8080'
pnpm --filter nc-gui run dev -- --host 127.0.0.1 --port 3000
```

Open `http://127.0.0.1:3000`. The backend watcher uses the fork-owned
Community Rspack configuration.

### Optional outbound services

RowWeave does not send telemetry, fetch a product feed, submit feedback, or
load remote email branding by default. These integrations are enabled only
when an operator explicitly supplies a RowWeave-owned endpoint:

| Variable | Purpose |
| --- | --- |
| `ROWWEAVE_TELEMETRY_URL` | Full opt-in telemetry collection endpoint |
| `ROWWEAVE_NEWSLETTER_URL` | Full opt-in newsletter subscription endpoint |
| `ROWWEAVE_PRODUCT_FEED_URL` | Base URL for optional `/social/feed` and `/cloud/features` services |
| `ROWWEAVE_FEEDBACK_URL` | Full optional feedback-form endpoint |
| `ROWWEAVE_GIFT_URL` | Optional community contribution link shown after meaningful use |
| `ROWWEAVE_EMAIL_ASSETS_BASE_URL` | Optional base URL for independently owned email assets |

`NC_DISABLE_TELE=true` remains supported and always wins over
`ROWWEAVE_TELEMETRY_URL` for compatibility. Do not point any of these variables
at upstream NocoDB services.

## Production build

Linux/macOS:

```sh
NODE_OPTIONS=--max-old-space-size=16384 pnpm run build:community
```

PowerShell:

```powershell
$env:NODE_OPTIONS = '--max-old-space-size=16384'
pnpm run build:community
```

The command builds, in order:

1. the Community SDK from the retained OpenAPI documents;
2. the nested Community integration interface;
3. the Nuxt static frontend;
4. the local `nc-lib-gui` staging directory;
5. `packages/nocodb/docker/main.js` with the Community backend configuration.

Run the resulting bundle:

```sh
mkdir -p .data-prod
PORT=8080 NC_TOOL_DIR="$PWD/.data-prod" NC_DISABLE_TELE=true node packages/nocodb/docker/main.js
```

PowerShell:

```powershell
New-Item -ItemType Directory -Force .data-prod | Out-Null
$env:PORT = '8080'
$env:NC_TOOL_DIR = (Resolve-Path .data-prod).Path
$env:NC_DISABLE_TELE = 'true'
node packages/nocodb/docker/main.js
```

Health and GUI checks:

```sh
curl --fail http://127.0.0.1:8080/api/v1/health
curl --fail http://127.0.0.1:8080/dashboard/
```

## Testing

Backend integration-style unit suite with an explicit SQLite database:

```sh
DB_CLIENT=sqlite3 pnpm --filter nocodb run test:unit
```

PowerShell:

```powershell
$env:DB_CLIENT = 'sqlite3'
pnpm --filter nocodb run test:unit
```

Use an explicit `DB_CLIENT` so a missing server database cannot add a connection
timeout or silently change which database is under test. PostgreSQL and MySQL
commands, pinned container versions, and verified complete-suite results are
recorded in [DB_COMPATIBILITY.md](./DB_COMPATIBILITY.md).

Backend Jest command:

```sh
pnpm --filter nocodb test
```

In the frozen revision, Jest reports no tests because its default discovery
does not select the retained Nest `*.spec.ts` files. Do not treat that command
alone as backend coverage.

SDK unit tests:

```sh
pnpm --filter nocodb-sdk exec jest --runInBand
```

The suite contains 182 ordinary passing tests and one expected-failure test.
The retained `Time.spec.ts` expects the clock value from an offset timestamp to
compare as `02:15`; the retained implementation normalizes the offset and
returns false. Issue #62 records the frozen-baseline defect, and
`it.failing` ensures CI fails if the behaviour changes before the expectation
and timezone semantics are updated together.

Frontend Vitest configuration (the frozen revision currently has no matching
frontend test files and therefore exits with status 1):

```sh
pnpm --filter nc-gui run test -- --run
```

Type-check the backend explicitly:

```sh
pnpm --filter nocodb exec tsc --noEmit -p tsconfig.json
```

With a server already running, execute the foundation acceptance flow:

```sh
NC_VERIFY_URL=http://127.0.0.1:8080 pnpm run verify:community
```

PowerShell:

```powershell
$env:NC_VERIFY_URL = 'http://127.0.0.1:8080'
pnpm run verify:community
```

This signs up or reuses `foundation@example.test`, signs in, creates a temporary
Base and table, creates/reads/updates/deletes a record, and removes the Base.
Override `NC_VERIFY_EMAIL` and `NC_VERIFY_PASSWORD` when necessary.

The complete Playwright suite is under `tests/playwright` and expects its
dedicated backend launch mode and browser dependencies. Run it only after
installing the Playwright browser declared by that workspace:

```sh
pnpm --filter playwright exec playwright install chromium
pnpm --filter playwright run test:quick
```

PostgreSQL and MySQL suites additionally require the Compose services exposed
by the root `start:pg` and `start:mysql` scripts.

## Docker build

Build from the repository root so Docker can see every workspace package and
both lockfiles:

```sh
docker build --progress=plain -f Dockerfile.community -t rowweave:foundation .
```

Run the image:

```sh
docker run --rm --name rowweave -p 8080:8080 rowweave:foundation
```

Persist metadata and attachments by mounting `/usr/app/data`:

```sh
docker run --rm --name rowweave -p 8080:8080 -v rowweave-data:/usr/app/data rowweave:foundation
```

The image builds the SDK, frontend, local GUI package, and backend entirely
from this checkout. It does not clone Litestream at a mutable branch and does
not install a published `nc-lib-gui` artifact.

## Failures observed during foundation work

The unchanged AGPL checkout was attempted before fixes. These failures drove
the minimal build changes:

| Failure                                                                                                | Resolution/status                                                                                        |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| pnpm refused to replace an existing `node_modules` without a TTY                                       | Use `CI=true`; a clean checkout is unaffected                                                            |
| GUI postinstall could not resolve a not-yet-built local SDK                                            | Defer Nuxt preparation on a clean install; build SDK first                                               |
| SDK generator treated the PowerShell `; rm` suffix as part of the template path                        | Use `&&`, pinned local generator, and cross-platform `rimraf`                                            |
| Root override referenced the impossible package `@types/mime@npm:nonexistent`                          | Replace it with the valid `@types/mime` 4.0.0 compatibility stub; no runtime dependency upgrade          |
| Backend type-check treated `src/types` subdirectories as ambient packages                              | Let `include` load local declarations and restrict `typeRoots` to dependency types                       |
| A retained migration imported a missing `BaseVersion.V2` marker                                        | Restore the minimal V2 metadata marker required by that retained migration                               |
| Nested integrations resolved stale SDK output                                                          | Frozen install and build the nested workspace after the SDK                                              |
| Windows Node 22 returned `spawnSync pnpm.cmd EINVAL` in GUI postinstall                                | Invoke the local Nuxt CLI with the current Node executable                                               |
| Production startup failed with `ENOENT` when `NC_TOOL_DIR` did not exist                               | Create the exact data directory before local startup; Docker creates it in the image                     |
| Docker's bundled Corepack rejected pnpm's current signing key                                          | Install the exact pinned pnpm CLI in the builder image                                                   |
| SDK unit test for offset time comparison fails                                                         | Recorded baseline defect; 182/183 tests pass                                                             |
| Backend unit tests probed MySQL before silently falling back to SQLite                                 | Select SQLite explicitly; server-DB diagnostics set `DB_REQUIRE_CONNECTION=true`                         |
| PostgreSQL/MySQL fixture paths failed on Windows                                                       | Resolve the fixture directory structurally instead of replacing a POSIX-only path string                 |
| Repeated SQLite fixture resets failed with `EBUSY` on Windows                                          | Close the test and application data-source connections before replacing the fixture                      |
| Local PostgreSQL tests ignored a source's configured schema                                            | Retain the schema/search path and use a dedicated schema-aware source connection                         |
| MySQL returned driver-specific buffer, decimal, bit, and boolean values                                | Use one retained value conversion path for metadata and source connections                               |
| MySQL percent-unique and median generated invalid or non-portable SQL                                  | Use a scalar subquery and MySQL 8 window functions without changing dependencies                         |
| Windows attachment reads rejected valid files or reset multipart connections                           | Validate attachment paths with platform path semantics and exercise the auth gate without an unused body |
| Type-checking `tests/unit/tsconfig.json` alone reports retained `rootDir` and source-map option errors | Treat it as the Mocha runtime compiler configuration; use the backend root `tsconfig.json` command above |
| `pnpm --filter nc-gui exec nuxi typecheck` fails before source diagnostics because the temporary `vue-tsc` resolves a TypeScript package export without `./lib/tsc` | Use `pnpm run build:community` as the frozen frontend compile check; resolve the toolchain mismatch separately during modernization without upgrading application dependencies |

Warnings about duplicated Pinia imports, deprecated Nuxt helpers, circular SDK
re-exports, large frontend chunks, and one dynamic `require` in
`require-in-the-middle` are retained baseline warnings. They are candidates for
the modernization phase, not reasons to upgrade dependencies in the foundation
commit.

## Continuous integration

`.github/workflows/unit-test.yml` runs for application, build, dependency, and
test changes targeting `foundation`. It uses the pinned Node.js and pnpm
versions and performs the following on a clean Ubuntu runner:

1. frozen dependency installation;
2. SDK and nested integration builds;
3. backend type-check, SDK Jest, and complete backend Mocha tests against
   SQLite, PostgreSQL 14.7, and MySQL 8.3.0;
4. Community production build and the authentication/Base/table/record CRUD
   verifier with SQLite, PostgreSQL 14.7, and MySQL 8.3.0 metadata stores;
5. source-built Community Docker image plus the same verifier against the
   running container.

Documentation-only changes do not start this resource-intensive workflow.
