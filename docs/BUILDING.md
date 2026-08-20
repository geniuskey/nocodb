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
pnpm run check:vendored-assets
pnpm run test:community-gui-stage
```

The first static check confirms that removed Enterprise-labelled and provenance-excluded paths remain absent, that Nuxt/Windi/GUI extension discovery retains defensive exclusions, that Community sources do not import excluded path segments, that the integration workspace contains only its core interface contract, that workflows are fork-owned and allowlisted, and that principal package scripts do not select excluded builds. The second validates the source, version markers, normalized SHA-256 digest, and license notices for every inventoried third-party library asset copied outside the pnpm graph. The third exercises replacement, validation, and path-safety behavior for Community GUI staging. See [VENDORED_ASSETS.md](./VENDORED_ASSETS.md).

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

Build the complete Community application and local image with the same
cross-platform command used by CI:

```sh
pnpm run docker:build:community
```

The equivalent two commands are:

```sh
pnpm run build:community
docker build -f packages/nocodb/Dockerfile.local -t nocodb-agpl-baseline:dev .
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
- Docker container signup, base creation, table creation, and record create/read/update/delete against SQLite: passed.
- Docker-staged dashboard and generated GUI CSS returned HTTP 200.
- Docker-assembled ReDoc/Swagger bundles and their restored notice/license files: returned HTTP 200; the removed Vue 3 duplicate returned HTTP 404.

An interactive in-app browser session was unavailable in the execution environment, so the login/base/table/CRUD path was verified at the public API boundary while the frontend was independently verified running. This is not a claim that the full click path was exercised. Run the Community Playwright command above in an environment with Chromium to close that UI-verification gap.

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
| GUI Vitest                                     | No matching test files; exits 1                                                                                 | Recorded.                                                                                                                                                                                    |
| Initial Docker image build                     | Docker Desktop Linux engine pipe not present                                                                    | Started the installed local engine and reran the same build.                                                                                                                                 |
| Initial Docker container start on Windows      | `/usr/src/appEntry/start.sh: No such file or directory` because its shebang contained CRLF                      | Normalize the copied shell script inside `Dockerfile.local`; no application code changed.                                                                                                    |
| Second Docker container start                  | Builder used Node 22 while Alpine 3.20 installed Node 20 in the runner, causing `ERR_REQUIRE_ESM`               | Pin both image stages to the repository's Node.js 22.12.0 and align pnpm to 9.15.5.                                                                                                          |
| First pinned-Node Docker rebuild               | Node 22.12.0's bundled Corepack did not recognize pnpm's newer signing key                                      | Install the pinned pnpm 9.15.5 with the image's npm instead of changing Node or pnpm versions.                                                                                               |
| Third Docker container start                   | The unpinned `pnpm dlx modclean` step deleted a runtime `lru-cache` module file                                 | Remove the optional size-cleaning step and preserve production dependency contents.                                                                                                          |
| Package-only Docker dependency install         | No lockfile was present and the SDK/Snowflake/Databricks workspace links pointed outside the build context      | Build from the repository root and deploy the `nocodb` production closure from the frozen workspace lockfile.                                                                                |
| First workspace deploy audit                   | `link:` dialect dependencies were omitted from the portable deploy tree                                         | Declare both local dialects with the pnpm `workspace:*` protocol; resolved versions remain unchanged.                                                                                        |
| First portable image runtime check             | `--ignore-scripts` left the SQLite native binding absent                                                        | Remove only developer-worktree hooks from the copied manifest, run dependency lifecycle scripts in the Linux builder, and require-load SQLite and Sharp during the image build.              |
| First native LZ4 build                         | `node-gyp` downloaded Node headers during the image build                                                       | Point `npm_config_nodedir` at the headers already present in the pinned Node base image.                                                                                                     |
| Initial Nix dependency build                   | The package-manager launcher could not find Node and would otherwise download pnpm dynamically                  | Package the exact pnpm 9.15.5 tarball and wrap it with the pinned Node.js 22.12.0 runtime.                                                                                                   |
| First full Nix build from the Windows worktree | Bash parsed carriage returns from `nix/package.nix` as commands                                                 | Normalize the expression and enforce LF for `*.nix` in `.gitattributes`.                                                                                                                     |
| SDK generation in the Nix sandbox              | `pnpm dlx swagger-typescript-api@10.0.3` attempted a network fetch                                              | Declare the exact generator as an SDK development dependency and invoke it with `pnpm exec`.                                                                                                 |
| Nix Git-flake build before staging new files   | Untracked staging scripts were correctly absent from the flake source snapshot                                  | Stage the intended files before the final Git-flake verification; no source filter was weakened.                                                                                             |
| Legacy authentication icon CSS                 | `materialdesignicons.5.x.min.css` references four font files that were absent from the frozen tree              | Recorded in the vendored-asset inventory; restoration/replacement is isolated to a later reviewed change.                                                                                    |

No existing runtime dependency version was upgraded. The nested integration lockfile is reduced to its retained `core` project. The optional secret-manager package and its dedicated Enterprise-mode CLI generator are excluded as a complete unit instead of modifying the generator's edition selector.
