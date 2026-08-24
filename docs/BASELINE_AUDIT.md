# NocoDB AGPL Baseline Audit

This is a source-history and licensing-metadata audit, not legal advice. It is
intentionally conservative. The audit does not inspect Enterprise-only
implementations and does not treat a repository license as permission to use
NocoDB trademarks.

Audit date: 2026-08-24. Repository inspected:
`https://github.com/nocodb/nocodb.git`.

## Recommended baseline

- **Tag:** no tag points at the exact recommended commit. The nearest and last
  modern AGPL release tag is `0.265.1`.
- **Commit SHA:** `cdcff441b275fbb672fe4bfffb2eb109d3e31497`
- **Tree SHA:** `0e42da498a31d8a92e2f985747ced13a95a9d8ae`
- **Commit date:** `2026-01-06T10:55:22+05:30`
- **Package version:** `packages/nocodb/package.json` declares `0.265.1`.
- **Repository license:** GNU Affero General Public License v3. The root and
  principal package manifests declare `AGPL-3.0-or-later`; the root `LICENSE`
  contains the complete AGPL v3 text.

This commit is recommended because it is the direct parent of the license
transition on the modern `develop` ancestry. It is therefore the final source
state on that lineage before the license changed. It is 533 commits after the
last release tag, so it is an exact, reproducible source baseline but not a
tagged upstream release.

The last tagged modern AGPL release is:

- **Tag:** `0.265.1`
- **Commit SHA:** `26fa3db331253c96d761bc1c899cd396009cfdb7`
- **Tag/commit date:** `2025-10-03T08:11:44Z`
- **Tree SHA:** `9e1469ff4384342ec85810a1e934f6aa82118941`
- **Manifest anomaly:** the tag is named `0.265.1`, while its backend manifest
  still declares `0.265.0`. This audit uses Git ancestry, license blobs, and the
  exact source SHA rather than inferring provenance from version strings.

The previously selected `v2025.11.0` tag is not an acceptable foundation for
this project's intent. Although created later and still AGPL, it belongs to a
parallel legacy lineage and contains backend package version `0.111.4`.

## License transition

- **Previous license:** GNU AGPL v3 at repository level; principal manifests
  declare `AGPL-3.0-or-later`.
- **New license:** Sustainable Use License, Version 1.0.
- **Transition commit:**
  `d98ad39c9b147be0fbd4e1e6ffbf354283b0b4e1`, whose sole parent is the
  recommended baseline `cdcff441b275fbb672fe4bfffb2eb109d3e31497`.
- **Transition date:** `2026-01-09T12:58:37+03:00`.
- **Changed license paths:** the transition deletes `LICENSE` and the nested
  AGPL license files for `nc-gui`, `nc-lib-gui`, and `nocodb-sdk`, replacing
  them with `LICENSE.md` Sustainable Use License files.
- **First non-AGPL release on this lineage:** `0.300.0`, commit
  `3b47db79618f20c1c09f8c0841ba4e04086315fe`.

There is also a separate legacy/master transition at
`7187de70f66d400ad3fb0921d833b2f7d988d048`. That parallel history caused the
earlier incorrect selection of the calendar-style `v2025.11.0` tag. It is not
the modern product lineage selected for this fork.

No upstream commit after `cdcff441b275fbb672fe4bfffb2eb109d3e31497` is an
approved implementation input to this project. The transition commit and later
tags may be inspected only for Git ancestry and license metadata, never for
application implementation.

## Source tree audit

The selected tree has 3,961 tracked files. Its four legal license files are
byte-identical AGPL v3 blobs (`1ce875873d862b9c6b8583c6be32a864921ba551`):

- `LICENSE`
- `packages/nc-gui/LICENSE`
- `packages/nc-lib-gui/LICENSE`
- `packages/nocodb-sdk/LICENSE`

No Sustainable Use License, Business Source License, Commons Clause, or
Elastic License marker was found in the selected tree outside dependency lock
data and generated bundles.

| Path/package | Observed license and provenance | Baseline disposition |
| --- | --- | --- |
| Repository root | `AGPL-3.0-or-later`; complete AGPL v3 text | Retain |
| `packages/nocodb/` | Manifest `0.265.1`, `AGPL-3.0-or-later` | Community backend baseline, subject to build-entry exclusions below |
| `packages/nc-gui/` | Nested AGPL license and AGPL manifest | Community frontend baseline; rebrand before distribution |
| `packages/nocodb-sdk/` | Version `0.265.1`, nested AGPL license and AGPL manifest | Community SDK baseline |
| `packages/nocodb-sdk-v2/` | Manifest `AGPL-3.0-or-later`; no nested license file | Retain under repository AGPL |
| `packages/nc-lib-gui/` | Version `0.265.1`, nested AGPL license; contains a committed generated GUI artifact | License-compatible, but do not make the fork's reproducible build depend on the committed/published artifact |
| `packages/noco-integrations/core/` | Source-only integration interface; manifest has no license field or nested license | Repository AGPL is the affirmative license evidence; retain only `core` and add explicit metadata in a fork-owned cleanup commit |
| `packages/nc-integration-scaffolder/` | Two source/config files; no manifest or nested license | Repository AGPL applies, but exclude from the initial runtime until purpose and provenance are independently reviewed |
| `packages/nc-mail-assets/` | No manifest or nested license; includes NocoDB branding and third-party social icons | Exclude branding; review remaining images before reuse |
| `packages/nc-secret-mgr/` | Manifest says ISC; committed bundles carry MIT, Apache-2.0, BSD-style, and AGPL notices | Exclude as a complete unit; see Enterprise-oriented build finding below |
| `scripts/pkg-executable/` | Manifest says ISC and contains five precompiled SQLite native binaries | Exclude from the reproducible baseline |
| `tests/playwright/` | Manifest `AGPL-3.0-or-later` | Community test baseline |
| MySQL Sakila fixtures under `packages/nocodb/tests/` | Embedded MySQL AB three-clause BSD-style notice | Retain only with notices and conditions intact |
| `.github/`, `.do/`, `charts/`, and upstream release/runner configuration | No separate license; repository AGPL is the license evidence | Recreate fork-owned operational infrastructure rather than inherit upstream publishing topology |

### Enterprise/proprietary material finding

Unlike the legacy `v2025.11.0` tree, the selected modern tree contains **zero
tracked files** in these Enterprise-labelled implementation paths:

- `packages/nc-gui/ee/`
- `packages/nc-lib-gui/ee/`
- `packages/nocodb/src/ee/`, `src/ee-on-prem/`, or `src/ee-cloud/`
- `packages/nocodb-sdk/src/ee/`
- `scripts/ee/`
- Enterprise Playwright test directories

No Git submodules or dependency names containing explicit `enterprise`,
`proprietary`, or standalone `ee` markers were found in package manifests.
This audit therefore found no Enterprise implementation tree in the selected
revision.

The Community source does retain compatibility switches, Enterprise labels,
and integration discovery hooks. In particular,
`packages/nocodb/src/utils/index.ts` fixes `isEE` to `false`. These shared AGPL
sources are not evidence that proprietary implementations are present, and
they must not be changed to bypass a license mechanism.

There is one material exclusion: `packages/nocodb/rspack.cli.config.js`
generates `packages/nc-secret-mgr/src/nocodb/cli.js` with `EE: true`, and the
generated artifact is committed. Several historical build/release entry points
also set `EE=true`, including the timely and Docker configurations. The fork
must exclude the secret-manager package, its generated backend artifact, and
its dedicated generator together. It must not inspect or modify that generated
artifact to recover Enterprise behavior.

## Exclusions

Remove or avoid these complete paths or entry points in the first clean
fork-only changes:

- `packages/nc-secret-mgr/`
- `packages/nocodb/rspack.cli.config.js`
- `packages/nocodb/rspack.timely.config.js`
- `packages/nocodb/src/run/timely.ts`
- `.github/workflows/release-secret-cli.yml`
- `.github/workflows/release-timely-docker.yml`
- `.github/workflows/release-timely-executables.yml`
- `scripts/pkg-executable/` and workflows that publish it
- `scripts/self-hosted-gh-runner/`
- upstream release, sync, deployment, and publishing workflows until replaced
  with minimal fork-owned CI
- generated or published `nc-lib-gui` output as a build input; build the
  Community GUI from retained AGPL source instead
- NocoDB names, logos, favicons, mail branding, and other brand assets,
  especially `packages/nc-gui/assets/img/brand/`, the NocoDB icons under
  `packages/nc-gui/assets/nc-icons/`, and NocoDB logo files under
  `packages/nc-mail-assets/`
- third-party product/social logos until their trademark and redistribution
  status is reviewed

Do not run historical build commands that set `EE=true` while establishing the
baseline. Replace the complete build entry point with a fork-owned Community
pipeline; do not patch, disable, or bypass a license check.

Do not copy, cherry-pick, port, adapt, or use as an implementation reference
any upstream commit after the selected SHA. Do not fetch a current package or
container as a substitute for a dependency missing from the frozen tree.

## Recommended fork strategy

1. Preserve the mistaken `0.111.4`-based work at
   `archive/legacy-0.111-work`; do not merge it into the new foundation.
2. Create an immutable archival ref for
   `cdcff441b275fbb672fe4bfffb2eb109d3e31497` and record its tree SHA.
3. Start the new `foundation` from that exact commit. Do not start from the
   current upstream branch or from an unverified source archive.
4. Make a small first fork-only commit that adds the provenance policy and
   removes the complete excluded units listed above. Do not inspect their
   implementations while removing them.
5. Establish a Community-only, frozen-lockfile build from the retained AGPL
   frontend, SDK, and backend sources. Do not depend on a later NocoDB npm
   package, image, generated GUI, or migration.
6. Re-run login, Base/table creation, record CRUD, production build, and Docker
   acceptance against SQLite, PostgreSQL, and MySQL before changing the GitHub
   default branch.
7. Replace NocoDB branding and publish complete copyright, AGPL, and
   third-party notices before the first public release.
8. Implement post-transition capabilities independently from this baseline,
   using only public behavior/specifications, general engineering knowledge,
   and independently licensed libraries. Maintain design/provenance notes for
   every major feature.

The old feature commits are fork-owned work and may be consulted as evidence of
our own authorship, but they should not be mechanically transplanted. Each
feature must be redesigned against the modern baseline's existing abstractions
and retested independently.

## Verification commands

Run these commands against a full clone with tags. They inspect source history,
license files, path names, and manifests only; they do not inspect
post-transition application implementations.

```sh
git remote -v
git fetch --tags upstream

# Verify the exact modern baseline and its direct transition child.
git show -s --date=iso-strict --format='%H%n%T%n%aI%n%cI%n%P%n%s' cdcff441b275fbb672fe4bfffb2eb109d3e31497
git rev-list --parents -n 1 d98ad39c9b147be0fbd4e1e6ffbf354283b0b4e1
git diff-tree --no-commit-id --name-status -r d98ad39c9b147be0fbd4e1e6ffbf354283b0b4e1

# Confirm the AGPL license and package version at the selected commit.
git show 'cdcff441b275fbb672fe4bfffb2eb109d3e31497:LICENSE' | sed -n '1,5p'
git show 'cdcff441b275fbb672fe4bfffb2eb109d3e31497:package.json' | grep -n '"license"'
git show 'cdcff441b275fbb672fe4bfffb2eb109d3e31497:packages/nocodb/package.json' | grep -n -E '"version"|"license"'

# Verify the last tagged modern release and the 533-commit gap.
git for-each-ref refs/tags --merged=cdcff441b275fbb672fe4bfffb2eb109d3e31497 --sort=-creatordate --count=12 --format='%(creatordate:iso-strict)|%(refname:short)|%(objectname)'
git rev-parse '0.265.1^{}' '0.265.1^{tree}'
git rev-list --count '0.265.1^{}..cdcff441b275fbb672fe4bfffb2eb109d3e31497'
git log '0.265.1^{}..cdcff441b275fbb672fe4bfffb2eb109d3e31497' -- LICENSE packages/nc-gui/LICENSE packages/nc-lib-gui/LICENSE packages/nocodb-sdk/LICENSE

# Confirm the first non-AGPL tag contains the transition commit.
git merge-base --is-ancestor d98ad39c9b147be0fbd4e1e6ffbf354283b0b4e1 '0.300.0^{}'
echo $?
git show 'd98ad39c9b147be0fbd4e1e6ffbf354283b0b4e1:LICENSE.md' | sed -n '1,12p'

# Inventory legal files and compare their blobs.
git ls-tree -r --name-only cdcff441b275fbb672fe4bfffb2eb109d3e31497 | grep -Ei '(^|/)(LICENSE|LICENCE|COPYING|NOTICE)(\..*)?$'
git rev-parse 'cdcff441b275fbb672fe4bfffb2eb109d3e31497:LICENSE'
git rev-parse 'cdcff441b275fbb672fe4bfffb2eb109d3e31497:packages/nc-gui/LICENSE'
git rev-parse 'cdcff441b275fbb672fe4bfffb2eb109d3e31497:packages/nc-lib-gui/LICENSE'
git rev-parse 'cdcff441b275fbb672fe4bfffb2eb109d3e31497:packages/nocodb-sdk/LICENSE'

# Inventory package manifests and Enterprise-labelled paths without opening them.
git ls-tree -r --name-only cdcff441b275fbb672fe4bfffb2eb109d3e31497 | grep -E '(^|/)package\.json$'
git ls-tree -r --name-only cdcff441b275fbb672fe4bfffb2eb109d3e31497 | grep -Ei '(^|/)(ee|ee-on-prem|ee-cloud|enterprise|proprietary)(/|$)'

# Find edition-selected build entry points. Do not execute them.
git grep -I -n -E 'EE=true|EE: true|process\.env\.EE' cdcff441b275fbb672fe4bfffb2eb109d3e31497 -- 'package.json' 'packages/**/package.json' 'packages/**/*.js' '.github/**'

# Confirm disallowed license markers are absent from the selected source tree.
git grep -I -n -E 'Sustainable Use License|Business Source License|Commons Clause|Elastic License' cdcff441b275fbb672fe4bfffb2eb109d3e31497 -- ':!pnpm-lock.yaml' ':!**/*.lock' ':!**/*.map' ':!packages/nc-secret-mgr/src/nocodb/cli.js' ':!packages/nc-secret-mgr/dist/cli.js'
```
