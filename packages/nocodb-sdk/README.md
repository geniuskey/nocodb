# RowWeave compatibility SDK

This is the retained `nocodb-sdk` workspace used by RowWeave's frozen AGPL
baseline. The package identity remains unchanged for source and API
compatibility; it must not be confused with SDKs from later NocoDB releases.

Generate it only from API schemas in this repository:

```sh
pnpm --filter nocodb-sdk run build
```

See [`docs/COMPATIBILITY.md`](../../docs/COMPATIBILITY.md) before changing a
public type or endpoint. Licensed under AGPL-3.0-or-later.
