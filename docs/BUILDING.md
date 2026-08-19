# Building the NocoDB AGPL Baseline

These instructions apply to tag `v2025.11.0` plus the minimal reproducibility fixes in this fork. They do not use code from later NocoDB revisions.

## Prerequisites

- Git
- Node.js `22.12.0`
- Corepack
- Python 3, a C/C++ compiler, and platform build tools for native Node modules
- Docker Desktop or another Docker Engine for the optional image build

On Windows, Visual Studio Build Tools with the Desktop C++ workload is sufficient. The repository `.npmrc` asks pnpm to use Node.js `22.12.0` for lifecycle commands.

## Install

From the repository root:

```sh
corepack enable
corepack prepare pnpm@9.15.5 --activate
pnpm --version
pnpm install --frozen-lockfile
pnpm --filter nocodb-sdk build
```

The expected pnpm version is exactly `9.15.5`. Do not regenerate the lockfile merely to use a newer package manager.

## Development

Use two terminals after completing the install and SDK build.

Terminal 1, backend:

```sh
pnpm start:backend
```

Terminal 2, frontend:

```sh
pnpm start:frontend
```

The API listens on `http://127.0.0.1:8080` and the Nuxt development server on `http://127.0.0.1:3000`. Health check:

```sh
curl --fail http://127.0.0.1:8080/api/v1/health
```

For an isolated data directory in PowerShell, set it before starting the backend:

```powershell
$env:NC_TOOL_DIR = Join-Path $PWD '.data'
pnpm start:backend
```

For POSIX shells:

```sh
NC_TOOL_DIR="$PWD/.data" pnpm start:backend
```

The historical backend development script contains baseline environment flags. They have not been bypassed or rewritten in this fork. Do not use Enterprise entry points or scripts.

## Production build

```sh
pnpm --filter nocodb-sdk build
pnpm --filter nc-gui build
pnpm --filter nocodb build
```

The verified backend bundle is `packages/nocodb/docker/main.js`. To run it with an isolated local data directory:

PowerShell:

```powershell
$env:NC_TOOL_DIR = Join-Path $PWD '.data-production'
$env:PORT = '8080'
node packages/nocodb/docker/main.js
```

POSIX:

```sh
NC_TOOL_DIR="$PWD/.data-production" PORT=8080 node packages/nocodb/docker/main.js
```

## Testing

Run the Community SDK checks and tests:

```sh
pnpm --filter nocodb-sdk build
pnpm --filter nocodb-sdk run test:unit
pnpm --filter nocodb-sdk run test:lint
pnpm --filter nocodb-sdk run test:prettier
pnpm --filter nocodb-sdk run test:spelling
```

Run backend tests:

```sh
pnpm --filter nocodb test
pnpm --filter nocodb run test:unit
```

The GUI's current Vitest configuration can be checked with:

```sh
pnpm --filter nc-gui exec vitest -c test/vite.config.ts run
```

It exits with code 1 in this baseline because there are no matching test files. For Community Playwright tests, install Chromium, start both development servers, and invoke Playwright without the baseline scripts that set `EE=true`:

```sh
pnpm --filter playwright exec playwright install chromium
pnpm --filter playwright exec playwright test --project=chromium
```

The full browser suite owns test data and is best run against dedicated services/databases, not a developer's working database.

## Docker build

Docker packaging needs the backend bundle and static GUI in the backend Docker context.

Build the artifacts:

```sh
pnpm --filter nocodb-sdk build
pnpm --filter nocodb build
pnpm --filter nc-gui generate
```

On PowerShell, copy the generated GUI and build the image:

```powershell
$target = Join-Path $PWD 'packages/nocodb/docker/nc-gui'
New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -Path 'packages/nc-gui/dist/*' -Destination $target -Recurse -Force
docker build -f packages/nocodb/Dockerfile.local -t nocodb-agpl-baseline:dev packages/nocodb
```

On POSIX:

```sh
mkdir -p packages/nocodb/docker/nc-gui
cp -R packages/nc-gui/dist/. packages/nocodb/docker/nc-gui/
docker build -f packages/nocodb/Dockerfile.local -t nocodb-agpl-baseline:dev packages/nocodb
```

Run the image:

```sh
docker run --rm -p 8080:8080 -v nocodb-data:/usr/app/data nocodb-agpl-baseline:dev
```

`packages/nocodb/build-local-docker-image.sh` is not the reproducible default: it removes local containers/images and includes historical Enterprise packaging flags. The explicit commands above avoid that script.

The baseline `Dockerfile.local` still warns that the Snowflake and Databricks workspace paths are outside its package-only build context. The smoke test above validates the default SQLite path; external database dialect images need a separate, Community-only packaging audit before release.

## Verification performed

The following was verified on Windows with Node.js lifecycle version `22.12.0`, pnpm `9.15.5`, and a fresh isolated SQLite data directory:

- Frozen install: passed.
- Community SDK build: passed.
- Nuxt development server: started and returned HTTP 200 on port 3000.
- Backend production bundle: built, started, and returned HTTP 200 from `/api/v1/health`.
- Signup and login: passed through the documented HTTP API.
- Base creation: passed.
- Table creation: passed.
- Record create, list/read, update/read-back, and delete: passed.
- Nuxt production build and static generation: passed, with baseline chunk/circular-import warnings.
- Backend production build: passed, with one `require-in-the-middle` warning.
- Local Docker image build and container health check: passed.

An interactive in-app browser session was unavailable in the execution environment, so the login/base/table/CRUD path was verified at the public API boundary while the frontend was independently verified running. This is not a claim that the full click path was exercised. Run the Community Playwright command above in an environment with Chromium to close that UI-verification gap.

Docker Desktop was initially stopped; after starting its Linux engine, the image built successfully. Container smoke testing then exposed a Windows CRLF shebang and a Node.js major-version mismatch between build and runtime stages. The local Dockerfile now normalizes the copied script and pins both stages to Node.js `22.12.0` with pnpm `9.15.5`; the corrected container returned HTTP 200 from `/api/v1/health`.

## Baseline failures retained and recorded

The unchanged tree was attempted before fixes. These were the observed failures and warnings:

| Stage | Observed result | Minimal response |
| --- | --- | --- |
| Install with host pnpm 10.27.0 | `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` for patched dependencies | Pin pnpm 9.15.5 in the root manifest and use Corepack. |
| First resumed pnpm 9 install | Command-runner timeout followed by `EPIPE` | Reran the same frozen install; no repository change was needed. |
| GUI postinstall before SDK build | Nuxt logged that the SDK `build/main` entry was missing, but install exited 0 | Make the SDK build an explicit post-install step. |
| SDK build on Windows | The POSIX `; rm` was parsed into the template path; default templates then generated an incompatible API client | Use `&& rimraf` with the existing pinned generator and Community templates. |
| Backend build on Windows | `EE` was reported as an unknown command because of POSIX inline environment syntax | Use the already-declared `cross-env`, preserving the original environment variable and value. |
| GUI build | TypeScript extended missing `ee/.nuxt/tsconfig.json` | Keep the Community `.nuxt/tsconfig.json` only. |
| SDK Jest | 24 suites passed and 1 failed; 357 tests passed, 24 skipped, 1 failed (`Time.spec.ts` equality comparison) | Recorded; no product-code change was made. |
| SDK lint | 18 baseline errors remain after excluding Enterprise/generated sources and CRLF-only noise | Recorded; unrelated style/product edits were not made. |
| SDK Prettier | Three baseline files differ | Recorded. |
| SDK CSpell | Baseline vocabulary produces many findings | Recorded; Enterprise and generated API paths are excluded. |
| Backend Jest | No tests found; exits 0 because the script uses `--passWithNoTests` | Recorded. |
| Backend Mocha unit suite | Fails during module loading: `Cannot access 'isEE' before initialization` | Recorded; no application-code change was made. |
| GUI Vitest | No matching test files; exits 1 | Recorded. |
| Initial Docker image build | Docker Desktop Linux engine pipe not present | Started the installed local engine and reran the same build. |
| Initial Docker container start on Windows | `/usr/src/appEntry/start.sh: No such file or directory` because its shebang contained CRLF | Normalize the copied shell script inside `Dockerfile.local`; no application code changed. |
| Second Docker container start | Builder used Node 22 while Alpine 3.20 installed Node 20 in the runner, causing `ERR_REQUIRE_ESM` | Pin both image stages to the repository's Node.js 22.12.0 and align pnpm to 9.15.5. |
| First pinned-Node Docker rebuild | Node 22.12.0's bundled Corepack did not recognize pnpm's newer signing key | Install the pinned pnpm 9.15.5 with the image's npm instead of changing Node or pnpm versions. |
| Third Docker container start | The unpinned `pnpm dlx modclean` step deleted a runtime `lru-cache` module file | Remove the optional size-cleaning step and preserve production dependency contents. |

No runtime dependency version was upgraded. The frozen lockfile remains unchanged.
