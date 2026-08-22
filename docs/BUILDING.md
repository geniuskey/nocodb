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
pnpm run integrations:build:core
```

The expected pnpm version is exactly `9.15.5`. Do not regenerate the lockfile merely to use a newer package manager.

The integration contract uses its own lockfile. To verify that nested workspace independently:

```sh
pnpm --dir packages/noco-integrations install --frozen-lockfile
pnpm --dir packages/noco-integrations build
pnpm --dir packages/noco-integrations test
```

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
New-Item -ItemType Directory -Path $env:NC_TOOL_DIR -Force | Out-Null
pnpm start:backend
```

For POSIX shells:

```sh
mkdir -p "$PWD/.data"
NC_TOOL_DIR="$PWD/.data" pnpm start:backend
```

The default bootstrap, backend build, development server, and Community Playwright entry points do not set Enterprise flags or load Enterprise build configurations. Enterprise-labelled source trees and their dedicated build/test entry points have been physically removed from the fork.

Record Trash expiry cleanup is scheduled automatically at minute 15 of every
hour. For maintenance only, set `NC_RECORD_TRASH_CLEANUP_DISABLED=true` before
starting the backend to suspend permanent removal of expired snapshots. See
[TRASH_RESTORE.md](./TRASH_RESTORE.md) for retention and batch limits.

## Production build

```sh
pnpm run build:community
```

This generates the Community SDK and GUI, bundles the backend, and stages the
generated GUI beside the bundle. The verified backend bundle is
`packages/nocodb/docker/main.js`. To run it with an isolated local data
directory:

PowerShell:

```powershell
$env:NC_TOOL_DIR = Join-Path $PWD '.data-production'
New-Item -ItemType Directory -Path $env:NC_TOOL_DIR -Force | Out-Null
$env:PORT = '8080'
node packages/nocodb/docker/main.js
```

POSIX:

```sh
mkdir -p "$PWD/.data-production"
NC_TOOL_DIR="$PWD/.data-production" PORT=8080 node packages/nocodb/docker/main.js
```

The dashboard is served from the independently generated Community GUI staged
beside the bundle. Server-owned `src/public` assets are assembled by the Docker
procedure below, so use the container layout when verifying the API-document
browser libraries and their notices.

## Testing

Verify the Community source boundary and copied runtime assets before building or testing:

```sh
pnpm run check:community-boundaries
pnpm run check:service-boundaries
pnpm run check:migration-integrity
pnpm run check:vendored-assets
pnpm run test:community-gui-stage
```

The first static check confirms that removed Enterprise-labelled and provenance-excluded paths remain absent, that Nuxt/Windi/GUI extension discovery retains defensive exclusions, that Community sources do not import excluded path segments, that the integration workspace contains only its core interface contract, that workflows are fork-owned and allowlisted, and that principal package scripts do not select excluded builds. The service-boundary check prevents new runtime dependency inversions and requires removal of stale legacy exceptions; see [SERVICE_BOUNDARIES.md](./SERVICE_BOUNDARIES.md). The migration check verifies every retained migration file's normalized SHA-256 digest and the exact v0/v1/v2/audit execution sequences. Pull-request CI also compares the ledger with the base commit and rejects changes, removals, or reordering of existing entries. The vendored-asset check validates the source, version markers, normalized SHA-256 digest, and license notices for every inventoried third-party library asset copied outside the pnpm graph. The staging test exercises replacement, validation, and path-safety behavior for Community GUI staging. See [VENDORED_ASSETS.md](./VENDORED_ASSETS.md).

For a new metadata change, add a new migration and append its registration to
the appropriate source. Then regenerate the ledger and review the resulting
addition:

```sh
pnpm run check:migration-integrity -- --write
pnpm run check:migration-integrity
```

The generator may add new entries, but pull-request CI rejects rewriting the
hash or sequence position of any entry already present on the base branch.

After a frozen install, produce the dependency-license closure for release review with:

```sh
pnpm licenses list --prod --long
pnpm licenses list --prod --json
```

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
pnpm --filter nocodb run typecheck:community
pnpm --filter nocodb run test:community:smoke
pnpm --filter nocodb test
pnpm --filter nocodb run test:unit
```

The Community smoke test uses Community-only Jest aliases and TypeScript configuration. The default Jest discovery pattern and the broader historical Mocha suite still have baseline coverage and initialization debt recorded below.

Run the Community GUI behavior tests with:

```sh
pnpm --filter nocodb-sdk build
pnpm --filter nc-gui run test:run
```

Vitest collects only `test/**/*.spec.ts` and intentionally fails when the suite
is empty. The SDK build is required on a clean checkout because the GUI imports
its workspace output. The current tests characterize the sorting behavior
shared by Grid and future record-list surfaces. For Community Playwright tests, install
Chromium, start both development servers, and invoke Playwright without the
baseline scripts that set `EE=true`:

```sh
pnpm --filter playwright exec playwright install chromium
pnpm --filter playwright exec playwright test --project=chromium
```

The full browser suite owns test data and is best run against dedicated services/databases, not a developer's working database.

For the reproducible core acceptance matrix, build the canonical image and run
the same browser workflow against fresh SQLite, PostgreSQL, and MySQL metadata
stores:

```sh
pnpm run docker:build:community
pnpm --filter playwright exec playwright install chromium
pnpm run test:community:image -- sqlite
pnpm run test:community:image -- postgres
pnpm run test:community:image -- mysql
```

Exercise the historical metadata upgrade boundary against the same image and
database matrix:

```sh
pnpm run test:community:upgrade -- sqlite
pnpm run test:community:upgrade -- postgres
pnpm run test:community:upgrade -- mysql
```

The upgrade fixture is pinned in `docs/UPGRADE_FIXTURES.json`. It creates only
the v2025.10.0 fresh-install v0 state (`nc_001_init`) using the retained,
hash-verified AGPL migration, inserts a persistence marker, and then lets the
current image apply `nc_002` through `nc_009`. Verification requires the exact
ordered migration ledger, the new List, Timeline, Gantt, dependency-graph,
teams, and workflow tables, the sync-config
columns, the row-order type change, marker preservation, and an idempotent
application restart on every database. No historical full application image or
excluded implementation tree is used. Set `COMMUNITY_UPGRADE_PORT` if host port
`18081` is unavailable.

The orchestrator creates uniquely named disposable containers and a private
network, waits for the database and application, runs the fresh browser
workflow, restarts the application container, and runs a persistence workflow
from a new browser session before removing its resources. On failure it prints
the application and database log tails before cleanup. PostgreSQL 16.6 and
MySQL 8.3.0 match the database versions already present in the frozen baseline's
Compose files; their container images are additionally pinned by manifest-list
digest. Set `COMMUNITY_IMAGE` to test a different local application image, or
`COMMUNITY_ACCEPTANCE_PORT` to change the published host port.

The test must start against a fresh instance because it verifies first-user
signup. It performs signup, lets the baseline finish its starter-base bootstrap,
creates a separate base and table, and requests the authenticated runtime
OpenAPI documents for public API v1, v2, and v3. The contract test checks each
document's OpenAPI/version identifiers, `xc-token` and bearer authentication
schemes, version-specific CRUD path layout, and generated `Tasks` request and
response schemas. It then creates a disposable base API token and uses its
`xc-token` header with each public API version after the Chromium workflow has
created its persistence marker. Each version creates, updates, reads, lists,
and deletes an isolated record with its own path and payload shape. The token
and API-created rows are removed before the application restart, while the
marker remains. After restart, a clean browser session signs in again, reopens
that base and table, reads and updates the marker, creates another record, and
deletes the marker. The frontend's existing `window.isPlaywright` hook selects
its stable DOM Grid for deterministic cell interaction; no server flag,
Enterprise mode, or license mechanism is changed. For a separately managed
fresh instance, set
`PW_BASE_URL` and invoke `pnpm --filter playwright run ci:test:community`
directly. The separate `ci:test:community:restart` script expects the state
created by the first workflow.

## Docker build

Build the complete Community application and local image with the same
cross-platform command used by CI:

```sh
pnpm run docker:build:community
```

The equivalent two commands are:

```sh
pnpm run build:community
docker build -f packages/nocodb/Dockerfile -t nocodb-agpl-baseline:dev .
```

The final `.` is required: the repository root is the Docker context because
the image installation is derived from the root workspace lockfile.

No shell-specific copy command is required. The ignored
`packages/nocodb/docker/nc-gui` directory is replaced from Nuxt output during
`build:community`; the image never depends on the precompiled `nc-lib-gui` npm
package.

The Docker builder pins Node.js `22.12.0` by image digest and pnpm `9.15.5`,
then uses `pnpm deploy --prod --frozen-lockfile` to create a portable runtime.
The local SDK, Snowflake dialect, and Databricks dialect are declared as
workspace dependencies and copied into that runtime instead of becoming
host-relative links. Native dependencies are built against the Node headers in
the pinned base image; the build fails if SQLite, Sharp, or any of those three
workspace packages is missing.

The same canonical Dockerfile includes the Apache-2.0 Litestream v0.3.13
release. Its amd64, arm64, arm/v6, and arm/v7 archives are selected explicitly
and verified by SHA-256 before extraction. Its license is fetched from the
release tag's exact commit, checksum-verified, and installed at
`/usr/share/licenses/litestream/LICENSE`. To produce a multi-architecture
release with Buildx, replace the example registry name before running:

```sh
docker buildx build --platform linux/amd64,linux/arm64 \
  -f packages/nocodb/Dockerfile \
  -t ghcr.io/OWNER/PROJECT:TAG --push .
```

The former `Dockerfile.local` and `Dockerfile.timely` duplicated the dependency
installation and did not consume the workspace lockfile. They are intentionally
replaced by this single local/release image definition.

Run the image:

```sh
docker run --rm -p 8080:8080 -v nocodb-data:/usr/app/data nocodb-agpl-baseline:dev
```

`build-local-docker-image.sh` delegates to the same frozen Community pipeline,
but it first removes a local container and image named `nocodb-local`. The
explicit commands above remain safer for routine development.

## Nix build

The flake builds the same Community SDK, GUI, backend bundle, and staged GUI as
the local production command. It pins pnpm `9.15.5` as a Nix input instead of
allowing Corepack to download a package-manager release at build time.

From a clean checkout on a Nix system with flakes enabled:

```sh
nix build .#pnpmDeps
nix build .#default
```

The second command produces `result/bin/nocodb` and a self-contained runtime
tree under `result/share/nocodb/`. Start it with an isolated data directory:

```sh
mkdir -p "$PWD/.data-nix"
NC_TOOL_DIR="$PWD/.data-nix" PORT=8080 ./result/bin/nocodb
```

Then verify the API and staged GUI:

```sh
curl --fail http://127.0.0.1:8080/api/v1/health
curl --fail http://127.0.0.1:8080/dashboard/
```

The Nix expression intentionally supplies Node.js `22.12.0` to the pinned pnpm
launcher, uses the frozen workspace lockfile, invokes the locally installed SDK
generator, and installs both the staged GUI and server-owned public assets. Nix
files are forced to LF by `.gitattributes` so a Windows checkout remains
buildable inside a Linux Nix builder.

## Verification performed

The following was verified on Windows with Node.js lifecycle version `22.12.0`, pnpm `9.15.5`, and a fresh isolated SQLite data directory:

- Frozen install: passed.
- Nested integration workspace frozen install, Community core build, and core tests: passed.
- Community source/default-script boundary check: passed.
- Append-only metadata migration ledger: 111 files and 108 ordered registrations hash-verified across the v0, v1, v2, and audit tracks.
- Vendored runtime asset provenance/hash/notice check: passed.
- Enterprise-labelled source/configuration absence check: passed.
- Community SDK build: passed.
- Nuxt development server: started and returned HTTP 200 on port 3000.
- Backend production bundle: built, started, and returned HTTP 200 from `/api/v1/health`.
- Backend development bundle: built, started, and returned HTTP 200 from `/api/v1/health` without Enterprise flags.
- Community backend TypeScript project: passed `typecheck:community`.
- Community backend Jest smoke test: 1 suite and 1 test passed.
- Community Playwright discovery: 198 tests in 65 files; no Enterprise test path was present.
- Signup and login: passed through the documented HTTP API.
- Base creation: passed.
- Table creation: passed.
- Record create, list/read, update/read-back, and delete: passed.
- Nuxt production build and static generation: passed, with baseline chunk/circular-import warnings.
- Backend production build: passed, with one `require-in-the-middle` warning.
- Cross-platform Community assembly command: passed; the production bundle served the generated dashboard and its hashed CSS without `nc-lib-gui` installed.
- Nix dependency fixed-output derivation and complete flake build: passed from a Windows-hosted Linux Nix builder.
- Nix runtime: health endpoint, dashboard, generated GUI CSS, and server-owned Swagger bundle returned HTTP 200.
- Frozen-lockfile Docker image build and native-module load checks: passed; the final image was approximately 290 MB.
- Canonical release image: passed with Litestream v0.3.13 and its checksum-verified Apache-2.0 license present; the final image was approximately 299 MB.
- ARM64 Litestream archive checksum and emulated `litestream version` execution: passed.
- Docker container signup, base creation, table creation, record CRUD, application restart, new-session login, persisted state read, and post-restart CRUD against SQLite, PostgreSQL 16.6, and MySQL 8.3.0 metadata stores: passed.
- Docker-staged dashboard and generated GUI CSS returned HTTP 200.
- Docker-assembled ReDoc/Swagger bundles and their restored notice/license files: returned HTTP 200; the removed Vue 3 duplicate returned HTTP 404.
- Community GUI Vitest: 1 file and 10 sorting behavior tests passed.
- Canonical Docker image Chromium acceptance: the same fresh and post-restart persistence workflows passed independently on SQLite, PostgreSQL, and MySQL.
- Runtime public API contract: authenticated, base-specific v1/v2/v3 OpenAPI documents exposed the expected security definitions, generated `Tasks` schemas, and version-specific list/create/read/update/delete operations on SQLite, PostgreSQL, and MySQL; each operation was also executed through all three API versions with a disposable `xc-token` credential.

The complete login/base/table/CRUD click path is now exercised by Chromium
against the assembled Docker image in both local verification and the Community
backend workflow. A second clean browser session also verifies that credentials,
schema, and records survive an application restart and remain writable. The
earlier API-only verification remains useful as a lower level diagnostic, but is
no longer the sole acceptance evidence.

Docker Desktop was initially stopped; after starting its Linux engine, the image built successfully. Container smoke testing then exposed a Windows CRLF shebang and a Node.js major-version mismatch between build and runtime stages. The local Dockerfile now normalizes the copied script and pins both stages to Node.js `22.12.0` with pnpm `9.15.5`; the corrected container returned HTTP 200 from `/api/v1/health`.

## Baseline failures retained and recorded

The unchanged tree was attempted before fixes. These were the observed failures and warnings:

| Stage                                          | Observed result                                                                                                 | Minimal response                                                                                                                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Install with host pnpm 10.27.0                 | `ERR_PNPM_LOCKFILE_CONFIG_MISMATCH` for patched dependencies                                                    | Pin pnpm 9.15.5 in the root manifest and use Corepack.                                                                                                                                       |
| First resumed pnpm 9 install                   | Command-runner timeout followed by `EPIPE`                                                                      | Reran the same frozen install; no repository change was needed.                                                                                                                              |
| GUI postinstall before SDK build               | Nuxt logged that the SDK `build/main` entry was missing, but install exited 0                                   | Make the SDK build an explicit post-install step.                                                                                                                                            |
| SDK build on Windows                           | The POSIX `; rm` was parsed into the template path; default templates then generated an incompatible API client | Use `&& rimraf` with the existing pinned generator and Community templates.                                                                                                                  |
| Backend build on Windows                       | `EE` was reported as an unknown command because of POSIX inline environment syntax                              | The initial compatibility fix used `cross-env`; Phase 1 subsequently removed the Enterprise variable from Community build and development entry points.                                      |
| Backend runtime with a new `NC_TOOL_DIR`       | SQLite failed with `ENOENT` when the selected directory did not yet exist                                       | Create the isolated directory explicitly before starting the backend, as shown above.                                                                                                        |
| GUI build                                      | TypeScript extended missing `ee/.nuxt/tsconfig.json`                                                            | Keep the Community `.nuxt/tsconfig.json` only.                                                                                                                                               |
| SDK Jest                                       | 24 suites passed and 1 failed; 357 tests passed, 24 skipped, 1 failed (`Time.spec.ts` equality comparison)      | Recorded; no product-code change was made.                                                                                                                                                   |
| SDK lint                                       | 18 baseline errors remain after excluding Enterprise/generated sources and CRLF-only noise                      | Recorded; unrelated style/product edits were not made.                                                                                                                                       |
| SDK Prettier                                   | Three baseline files differ                                                                                     | Recorded.                                                                                                                                                                                    |
| SDK CSpell                                     | Baseline vocabulary produces many findings                                                                      | Recorded; Enterprise and generated API paths are excluded.                                                                                                                                   |
| Backend Jest                                   | The historical default pattern finds no tests and exits 0 because it uses `--passWithNoTests`                   | A Community-only smoke lane now runs an explicitly collected service test; broad Jest discovery remains test debt.                                                                           |
| Backend Mocha unit suite                       | The baseline failed during module loading: `Cannot access 'isEE' before initialization`                         | Move edition constants to a dependency-free module. The command now initializes SQLite and exits 0, but emits no test-count summary, so it is not yet treated as a verified full-suite pass. |
| Initial GUI Vitest                             | No matching test files; exited 1                                                                                | Add a fork-owned non-watch Community suite and require at least one collected test; 10 sorting behavior tests now pass.                                                                       |
| Initial Docker image build                     | Docker Desktop Linux engine pipe not present                                                                    | Started the installed local engine and reran the same build.                                                                                                                                 |
| First MySQL 8.3 fresh migration                | MySQL rejected indexes on OAuth `TEXT` token columns because no key length was specified                        | Keep full-column indexes on SQLite/PostgreSQL; use explicitly named 512-character prefix indexes on MySQL, preserving full-token equality checks.                                             |
| First Linux database-matrix CI run             | pnpm preserved the argument separator and invoked the script as `node ... -- sqlite`, while Windows passed only `sqlite` | Normalize one optional leading `--` in the cross-platform orchestrator and continue rejecting missing or extra arguments.                                                        |
| First restart browser workflow                 | Exact accessible-name matching did not find the visible sign-in button because its icon contributes to the accessible name | Use the frozen baseline's existing text-based sign-in locator; no application markup or accessibility behavior was changed.                                                      |
| Initial Docker container start on Windows      | `/usr/src/appEntry/start.sh: No such file or directory` because its shebang contained CRLF                      | Normalize the copied shell script inside the canonical Dockerfile; no application code changed.                                                                                              |
| Second Docker container start                  | Builder used Node 22 while Alpine 3.20 installed Node 20 in the runner, causing `ERR_REQUIRE_ESM`               | Pin both image stages to the repository's Node.js 22.12.0 and align pnpm to 9.15.5.                                                                                                          |
| First pinned-Node Docker rebuild               | Node 22.12.0's bundled Corepack did not recognize pnpm's newer signing key                                      | Install the pinned pnpm 9.15.5 with the image's npm instead of changing Node or pnpm versions.                                                                                               |
| Third Docker container start                   | The unpinned `pnpm dlx modclean` step deleted a runtime `lru-cache` module file                                 | Remove the optional size-cleaning step and preserve production dependency contents.                                                                                                          |
| Package-only Docker dependency install         | No lockfile was present and the SDK/Snowflake/Databricks workspace links pointed outside the build context      | Build from the repository root and deploy the `nocodb` production closure from the frozen workspace lockfile.                                                                                |
| Legacy standard Dockerfile build               | Build context failed immediately because it copied the absent `docker/litestream.yml`                           | Consolidate local and release builds on the canonical root-context Dockerfile; the start script uses explicit CLI arguments and requires no config file.                                      |
| Legacy Litestream image path                   | Dockerfiles cloned mutable Litestream HEAD, used unpinned `pnpm dlx`, and installed the binary at a path different from the start script | Pin Litestream v0.3.13 archives by architecture and SHA-256, remove `modclean`, and invoke the binary through its installed `PATH` location.                                       |
| First workspace deploy audit                   | `link:` dialect dependencies were omitted from the portable deploy tree                                         | Declare both local dialects with the pnpm `workspace:*` protocol; resolved versions remain unchanged.                                                                                        |
| First portable image runtime check             | `--ignore-scripts` left the SQLite native binding absent                                                        | Remove only developer-worktree hooks from the copied manifest, run dependency lifecycle scripts in the Linux builder, and require-load SQLite and Sharp during the image build.              |
| First native LZ4 build                         | `node-gyp` downloaded Node headers during the image build                                                       | Point `npm_config_nodedir` at the headers already present in the pinned Node base image.                                                                                                     |
| Initial Nix dependency build                   | The package-manager launcher could not find Node and would otherwise download pnpm dynamically                  | Package the exact pnpm 9.15.5 tarball and wrap it with the pinned Node.js 22.12.0 runtime.                                                                                                   |
| First full Nix build from the Windows worktree | Bash parsed carriage returns from `nix/package.nix` as commands                                                 | Normalize the expression and enforce LF for `*.nix` in `.gitattributes`.                                                                                                                     |
| SDK generation in the Nix sandbox              | `pnpm dlx swagger-typescript-api@10.0.3` attempted a network fetch                                              | Declare the exact generator as an SDK development dependency and invoke it with `pnpm exec`.                                                                                                 |
| Nix Git-flake build before staging new files   | Untracked staging scripts were correctly absent from the flake source snapshot                                  | Stage the intended files before the final Git-flake verification; no source filter was weakened.                                                                                             |
| Legacy authentication icon CSS                 | `materialdesignicons.5.x.min.css` references four font files that were absent from the frozen tree              | Recorded in the vendored-asset inventory; restoration/replacement is isolated to a later reviewed change.                                                                                    |

No existing runtime dependency version was upgraded. The nested integration lockfile is reduced to its retained `core` project. The optional secret-manager package and its dedicated Enterprise-mode CLI generator are excluded as a complete unit instead of modifying the generator's edition selector.
