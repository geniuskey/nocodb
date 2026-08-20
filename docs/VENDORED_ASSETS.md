# Vendored Runtime Assets

This document records audited third-party library assets copied into the Community server rather than resolved through the pnpm graph. The machine-readable source of truth is [`VENDORED_ASSETS.json`](./VENDORED_ASSETS.json), and `pnpm run check:vendored-assets` verifies every inventoried normalized SHA-256 digest, version marker, required notice, and notice digest.

Project branding images and third-party provider logos are outside this inventory. They require a separate trademark/brand review and must not be inferred to be approved merely because they are static assets.

All JavaScript and CSS files under the backend public asset roots, and any JavaScript file under the GUI public asset root, must have an inventory entry. The checker rejects a new copied library that is added without provenance metadata.

## Approved assets

| Component | Version | Served files | License | Provenance result |
| --- | --- | --- | --- | --- |
| Axios | 0.19.2 | `js/axios.0.19.2.min.js` | MIT | Byte-identical to the npm tarball after Git text normalization |
| ReDoc | 2.0.0 (`5fb4daa`) | `js/redoc.standalone.min.js` | MIT plus embedded dependency notices | Byte-identical to the npm tarball; the missing webpack notice file is now restored |
| Swagger UI | 5.28.1 (`ge9b44b5a`) | `js/swagger-ui-bundle.js`, `css/swagger-ui.css` | Apache-2.0 plus embedded dependency notices | CSS is byte-identical to npm. JavaScript is code-identical to npm 5.28.1 except for the npm artifact's stale embedded 5.28.0 build metadata; the retained baseline has the correct 5.28.1 metadata. |
| Vue.js | 2.6.14 | `js/vue.2.6.14.min.js` | MIT | Byte-identical to the npm tarball |
| Vuetify | 2.6.14 | `js/vuetify.2.x.min.js`, `css/vuetify.2.x.min.css` | MIT | Byte-identical to the npm tarball |
| Material Design Icons | 5.9.55 | `css/materialdesignicons.5.x.min.css` | Pictogrammers free-license notice; MIT for code and Apache-2.0/component licenses for icons/fonts | Byte-identical to `@mdi/font@5.9.55` |
| Google Fonts CSS snapshots | Montserrat v25 URLs, Roboto v30 URLs | `css/fonts.montserrat.css`, `css/fonts.roboto.css` | The CSS metadata is retained; referenced font binaries are remotely served and are not vendored | Frozen hashes are recorded; the original endpoint query was not recorded upstream |

The ReDoc and Swagger UI bundles contain comments requiring adjacent webpack-generated `*.LICENSE.txt` files. Those exact notice files are included beside the bundles. Primary component license texts are retained under `packages/nocodb/src/public/licenses/`.

The bare backend bundle does not copy this directory beside itself. The canonical `packages/nocodb/Dockerfile` performs the production assembly by copying `src/public/` to `docker/public/`; container smoke verification confirms that retained bundles and notices are served from that layout.

## Removed assets

Two duplicate assets had no reference in source, templates, manifests, or build configuration and are excluded from the approved inventory:

- `packages/nc-gui/public/js/swagger-ui-bundle.min.js` (Swagger UI 4.5.2)
- `packages/nocodb/src/public/js/vue.global.js` (Vue 3.2.47)

The checker rejects reintroduction of these obsolete copies. The backend-served Swagger UI 5.28.1 and Vue 2.6.14 assets remain because current API-documentation and authentication templates reference them.

## Known gap

`materialdesignicons.5.x.min.css` references four files under `../fonts/`, but those font binaries were absent from the frozen AGPL tree. Modern browsers therefore cannot load the icon font from a clean local server. Restoring those independently licensed upstream assets, or replacing the legacy authentication templates' icon dependency, belongs in a separate reproducibility change with its own review.

This inventory covers files copied into the source tree. It is not a substitute for the dependency closure report produced after installation:

```sh
pnpm licenses list --prod --long
pnpm licenses list --prod --json
```
