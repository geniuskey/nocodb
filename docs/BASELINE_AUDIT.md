# NocoDB AGPL Baseline Audit

This is a source-history and licensing-metadata audit, not legal advice. It is intentionally conservative: a path can have been published under AGPL and still be excluded from this fork because it is labelled or treated upstream as Enterprise code.

Audit date: 2026-08-19. Repository inspected: `https://github.com/nocodb/nocodb.git`.

## Recommended baseline

- **Tag:** `v2025.11.0`
- **Tag object:** `e0efe8be24275d28ab10ec1485749b8e7f0b1bab` (annotated tag; do not mistake this for the source commit)
- **Commit SHA:** `d9d3d9d16d7358d023669942e2160aaeafaaa8cb`
- **Tree SHA:** `871e24011755d838e2e5791b176f52b084c78faf`
- **Commit date:** 2025-11-27T11:51:37+05:30 (committer date)
- **Repository license:** GNU Affero General Public License v3. The root `package.json` describes this as `AGPL-3.0-or-later`; the root `LICENSE` is the complete AGPL v3 text.

`v2025.11.0` is the latest release tag before either release lineage received the Sustainable Use License change. The next chronologically created release tag is `0.300.0`, and its source tree already contains the Sustainable Use License. This conclusion is based on tag ancestry and license blobs, not version-number inference.

“Complete source tree under AGPL” here means the last complete published release tree with the repository-level AGPL license. Explicitly permissive third-party or package-level licenses still apply to their respective material, as detailed below.

## License transition

- **Previous license:** GNU AGPL v3 at repository level; principal npm manifests use `AGPL-3.0-or-later`.
- **New license:** Sustainable Use License, Version 1.0. The new text also states that third-party components retain their original licenses and that only the `master` branch is licensed under the Sustainable Use License.
- **Transition commit on the default/develop ancestry:** `d98ad39c9b147be0fbd4e1e6ffbf354283b0b4e1` (`chore: change to sustainable use license`). It deletes `LICENSE`, adds `LICENSE.md`, and replaces the nested licenses for `packages/nc-gui`, `packages/nc-lib-gui`, and `packages/nocodb-sdk`. Its direct parent, and therefore the last commit before the change on that ancestry, is `cdcff441b275fbb672fe4bfffb2eb109d3e31497` (2026-01-06T10:55:22+05:30).
- **Parallel transition on the master/calendar-release ancestry:** `7187de70f66d400ad3fb0921d833b2f7d988d048`, with direct parent `d8484c0910cb61e153fd784b5ca3aa7302d2ebc9`. It performs the corresponding license replacement on the separate master history. The two transition commits have merge base `2d8bb02f7ee9bb449e58e10aea4c4eda9755af00`; neither is the ancestor of the other. Thus there is no single SHA covering both parallel release histories.
- **Related preparatory/topic history:** `fe73baf7fb534f2a48b9b85c5e8cd5d9667585f5` (draft) and `1975f87075a06caa8ea3206236ba403c4bcec379` (license filename change) appear in `--all` history, but they are not the transition commits carried by the tagged release ancestries.
- **First non-AGPL release:** `0.300.0`, source commit `3b47db79618f20c1c09f8c0841ba4e04086315fe`, is the earliest tag whose source contains the develop transition and `LICENSE.md` Sustainable Use text. On the `vYYYY.MM.N` release line, the first non-AGPL tag is `v2026.01.0`, source commit `5f967acfc6476eb43fbeb1e1651c0b73cc6ede60`, containing the parallel master transition.

No commit after `v2025.11.0` is approved as input to this fork merely because it might still carry an AGPL header in an individual file. The baseline boundary is the exact tagged tree above.

## Source tree audit

The baseline has three identical AGPL license blobs at `LICENSE`, `packages/nc-gui/LICENSE`, and `packages/nocodb-sdk/LICENSE` (blob `1ce875873d862b9c6b8583c6be32a864921ba551`). No Sustainable Use, Business Source, Commons Clause, Elastic, or explicit proprietary-license marker was found in the baseline's source licensing metadata scan.

| Path/package in `v2025.11.0` | Observed license status | Baseline disposition |
| --- | --- | --- |
| Repository root and ordinary build/documentation files | Root AGPL v3; root manifest says `AGPL-3.0-or-later` | Usable, subject to the specific exclusions below |
| `packages/nocodb/` excluding `src/ee`, `src/ee-on-prem`, and any `src/ee-cloud` path | Manifest says `AGPL-3.0-or-later` | Core Community backend baseline |
| `packages/nc-gui/` excluding `ee/` | Nested AGPL license and manifest `AGPL-3.0-or-later` | Core Community frontend baseline |
| `packages/nocodb-sdk/` excluding `src/ee/` | Nested AGPL license and manifest `AGPL-3.0-or-later` | Community SDK baseline |
| `packages/nocodb-sdk-v2/` | Manifest says `AGPL-3.0-or-later`; no separate license file | Usable under repository AGPL |
| `packages/nc-integration-scaffolder/` | Manifest says `AGPL-3.0-or-later` | Usable under AGPL |
| `packages/nc-knex-dialects/knex-databricks/`, `packages/nc-knex-dialects/knex-snowflake/` | Manifests say MIT | Permissive, AGPL-compatible; preserve notices and package attribution |
| `packages/nc-migrator/` | Manifest says ISC | Permissive, AGPL-compatible; preserve attribution |
| `packages/nc-secret-mgr/` | Manifest says ISC. Its committed bundle notice includes MIT, Apache-2.0, BSD-style, and AGPL notices | Usable only with all bundled third-party notices preserved; rebuilding from source is preferable to carrying `dist/` |
| `packages/nc-sql-executor/` | Manifest says ISC | Permissive, AGPL-compatible; preserve attribution |
| `scripts/pkg-executable/` | Manifest says ISC | Optional; preserve attribution if retained |
| `tests/playwright/` excluding `tests/ee/` | Manifest says `AGPL-3.0-or-later` | Community tests are usable |
| Sakila SQL fixtures under `packages/nocodb/tests/mysql-dump/` and `packages/nocodb/tests/mysql-sakila-db/` | Embedded MySQL AB three-clause BSD-style notice | May be retained only with the embedded notices and conditions intact |
| `packages/noco-integrations/core/` and integration workspace support | Package manifests often omit a `license` field and there is no nested license file; repository AGPL is the only affirmative repository-level license evidence | Review individually before import; do not treat a missing manifest field as a separate license grant |
| `packages/noco-integrations/packages/`, `templates/`, and `wip/` | No manifest license fields; explicitly excluded by upstream's CE synchronization list | Exclude from the initial clean Community baseline |
| `charts/`, `cloud/`, release/sync tooling, and `.github/workflows/` | No separate license found, so repository AGPL is the licensing evidence; however upstream's CE synchronization list excludes these operational paths | Recreate or review independently rather than importing by default |

### Enterprise/proprietary material finding

Enterprise-labelled implementation material **does exist** in this revision. At least the following were present: 1,164 files under `packages/nc-gui/ee`, 423 under `packages/nocodb/src/ee`, 20 under `packages/nocodb/src/ee-on-prem`, 13 under `packages/nocodb-sdk/src/ee`, 15 under `scripts/ee`, 15 Playwright EE tests, and 8 backend EE unit-test files.

No separate proprietary license notice was found on those paths in this revision; the enclosing package manifests and repository license are AGPL. Therefore this audit does **not** conclude that the published blobs were proprietary at `v2025.11.0`. It does conclude that they are Enterprise-only implementations by path, build flags, tests, and the repository's own `scripts/sync/exclude-list.txt`. Under this fork's clean-room rules, that distinction does not make them acceptable: do not use, port, study for reimplementation, or retain them.

## Exclusions

Remove or avoid these paths when creating the actual fork baseline:

- `packages/nocodb/src/ee/`
- `packages/nocodb/src/ee-on-prem/`
- `packages/nocodb/src/ee-cloud/` if present on any selected history (it is named in the CE synchronization exclusions even though it is absent from the recommended tree)
- `packages/nocodb-sdk/src/ee/`
- `packages/nc-gui/ee/`
- `scripts/ee/`
- `tests/playwright/tests/ee/`
- `packages/nocodb/tests/unit/rest/tests/ee/`
- Enterprise build/test entry points and configuration, including `build-local-ee-docker-image.sh`, `.github/workflows/release-ee-on-prem-docker.yml`, and `packages/nocodb/rspack.*ee*.js`, `packages/nocodb/tsconfig.ee*.json`, or equivalents
- `packages/noco-integrations/packages/`, `packages/noco-integrations/templates/`, and `packages/noco-integrations/wip/` until each component has an affirmative license/provenance review and has been confirmed not to be Enterprise-only
- `cloud/`, `scripts/sync/`, and `scripts/release/`; recreate fork infrastructure rather than inherit upstream private/release topology
- NocoDB names, logos, mascots, and other brand assets where trademark rights are separate from copyright licensing; replace these before public distribution
- Generated bundles such as `packages/nc-secret-mgr/dist/` unless needed and shipped with every required third-party notice; prefer reproducible builds from audited source

Also do not cherry-pick, copy, port, adapt, or use as a reference any upstream commit not contained in the exact `v2025.11.0` source tree. Do not use the excluded Enterprise implementation even though it is present in the historical AGPL tree. License-checking code inside excluded Enterprise paths must be removed only as part of excluding the entire path; it must not be bypassed, patched, disabled, or altered.

## Recommended fork strategy

1. Create an immutable archival ref at the exact dereferenced tag commit, for example `upstream-agpl-v2025.11.0`, and record both the commit and tree SHA in release documentation.
2. Create the working fork from that commit, not from the current upstream branch and not from a source archive with unverifiable provenance.
3. In the first fork-only commit, delete the Enterprise, cloud/release, and ambiguous integration paths listed above as whole units. Do not edit or study their implementation while reconstructing features.
4. Retain the AGPL v3 license, copyright history, contributor attribution, and all MIT/ISC/Apache/BSD third-party notices. Add a machine-readable `THIRD_PARTY_NOTICES` inventory before the first public fork release.
5. Rebrand independently. Copyright permission does not grant NocoDB trademark rights.
6. Establish a provenance policy: every future change must be original work against this baseline, a clearly compatible dependency, or an independently implemented behavior based only on public documentation/specifications. Record source links and design notes for clean-room features.
7. Configure CI to reject commits descended from either Sustainable Use transition and to scan new files for Sustainable Use/proprietary markers and excluded path names.
8. Obtain counsel review before public release, especially for ambiguous assets, generated bundles, integration providers, and attribution completeness.

## Verification commands

Run these against a full clone with all tags fetched. They inspect history and licensing metadata only; they do not check out or execute post-transition application code.

```sh
git remote -v
git fetch --tags origin

# Dereference the annotated tag to the source commit and tree.
git rev-parse 'v2025.11.0^{}'
git rev-parse 'v2025.11.0^{tree}'
git show -s --date=iso-strict --format='%H%n%aI%n%cI%n%P%n%s' 'v2025.11.0^{}'

# Confirm the baseline root license and its principal package declarations.
git show 'v2025.11.0^{}:LICENSE' | sed -n '1,5p'
git show 'v2025.11.0^{}:package.json' | grep -n '"license"'
git show 'v2025.11.0^{}:packages/nc-gui/package.json' | grep -n '"license"'
git show 'v2025.11.0^{}:packages/nocodb/package.json' | grep -n '"license"'
git show 'v2025.11.0^{}:packages/nocodb-sdk/package.json' | grep -n '"license"'

# Locate every commit touching repository license files.
git log --all --date=iso-strict --format='%H %ad %D %s' -- LICENSE LICENSE.md

# Verify each transition, direct parent, and changed paths.
git show -s --date=iso-strict --format='%H%n%P%n%aI%n%cI%n%s' d98ad39c9b147be0fbd4e1e6ffbf354283b0b4e1
git diff-tree --no-commit-id --name-status -r d98ad39c9b147be0fbd4e1e6ffbf354283b0b4e1
git show 'd98ad39c9b147be0fbd4e1e6ffbf354283b0b4e1:LICENSE.md' | sed -n '1,22p'
git show -s --date=iso-strict --format='%H%n%P%n%aI%n%cI%n%s' 7187de70f66d400ad3fb0921d833b2f7d988d048
git diff-tree --no-commit-id --name-status -r 7187de70f66d400ad3fb0921d833b2f7d988d048
git merge-base d98ad39c9b147be0fbd4e1e6ffbf354283b0b4e1 7187de70f66d400ad3fb0921d833b2f7d988d048

# Prove tag ancestry instead of relying on version names (0 means “is ancestor”).
git merge-base --is-ancestor d98ad39c9b147be0fbd4e1e6ffbf354283b0b4e1 '0.300.0^{}'; echo $?
git merge-base --is-ancestor 7187de70f66d400ad3fb0921d833b2f7d988d048 'v2026.01.0^{}'; echo $?
git merge-base --is-ancestor d98ad39c9b147be0fbd4e1e6ffbf354283b0b4e1 'v2025.11.0^{}'; echo $?
git show '0.300.0^{}:LICENSE.md' | sed -n '1,22p'
git show 'v2026.01.0^{}:LICENSE.md' | sed -n '1,22p'

# List tags around the boundary with both tag-object and dereferenced source SHAs.
git for-each-ref refs/tags --sort=creatordate --format='%(refname:short) %(objectname) %(creatordate:iso-strict) %(subject)'
git rev-parse 'v2025.11.0^{}' '0.300.0^{}' 'v2026.01.0^{}'

# Inventory nested licenses, package manifests, Enterprise paths, and CE exclusions.
git ls-tree -r --name-only 'v2025.11.0^{}' | grep -Ei '(^|/)(LICENSE|LICENCE|COPYING|NOTICE)(\..*)?$'
git ls-tree -r --name-only 'v2025.11.0^{}' | grep -E '(^|/)(package\.json|Cargo\.toml|pyproject\.toml|pom\.xml|go\.mod)$'
git ls-tree -r --name-only 'v2025.11.0^{}' | grep -E '(^|/)(ee|ee-on-prem|ee-cloud)(/|$)|enterprise|proprietary'
git show 'v2025.11.0^{}:scripts/sync/exclude-list.txt'

# Scan licensing markers without opening Enterprise implementations.
git grep -I -n -E 'SPDX-License-Identifier|Sustainable Use License|Enterprise (Edition )?License|proprietary|Business Source License|Commons Clause|Elastic License' 'v2025.11.0^{}' -- ':!pnpm-lock.yaml' ':!**/package-lock.json' ':!**/*.svg' ':!**/*.json' ':!**/*.lock'

# Inspect the known embedded third-party notices.
git show 'v2025.11.0^{}:packages/nc-secret-mgr/dist/cli.js.LICENSE.txt' | sed -n '1,90p'
git show 'v2025.11.0^{}:packages/nocodb/tests/mysql-dump/mysql-sakila-schema.sql' | sed -n '1,18p'
```
