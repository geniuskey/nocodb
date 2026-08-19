# Community integration interfaces

This workspace contains only the shared integration interfaces used by the
Community backend. Install it with the repository-pinned pnpm version and build
the core package from the repository root:

```sh
pnpm run integrations:build:core
```

Provider implementations are intentionally not included in the clean AGPL
baseline. Future providers must be independently implemented and carry clear
license and provenance metadata.
