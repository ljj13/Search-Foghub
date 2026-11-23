# P14 Staging Architecture

> **Historical.** The staging environment was decommissioned in P15: `staging.search.foghub.org` no longer resolves, and its Wrangler config and scripts were removed from the repository. This document is kept as the record of what was validated.

Staging is a second, fully separate Cloudflare Worker that serves the modernized front end at
`https://staging.search.foghub.org`. It shares no data plane with production: its own Worker
script, its own D1 database, its own Durable Object namespace, its own Better Auth secrets and
its own owner account. Production keeps serving the pre-modernization build from `main`.

## Components

| Piece | Production | Staging |
| --- | --- | --- |
| Worker script | `beyondfog` | `beyondfog-staging` |
| Custom domain | `search.foghub.org`, `beyondfog.cc.cd` (302 → new host) | `staging.search.foghub.org` only |
| `workers.dev` / preview URLs | enabled | disabled (`workers_dev: false`) |
| D1 database | `beyondfog` — `f2bb555f-83d0-4bb4-8ff8-d0b7a0995669` | `beyondfog-staging-db` — `fb23bb45-004f-4c2a-afe9-4cb65ceabbc5` |
| Durable Object | `SERVICE` → `BeyondFogService` (namespace owned by `beyondfog`) | `SERVICE` → `BeyondFogService` (namespace owned by `beyondfog-staging`) |
| `APP_ORIGIN` | `https://search.foghub.org` | `https://staging.search.foghub.org` |
| `OWNER_EMAIL` | `fogpurification@gmail.com` | `staging@foghub.org` |
| `send_email` binding | `EMAIL` → `fogpurification@gmail.com` | **none** |
| Secrets | production `BETTER_AUTH_SECRET`, `WEBDAV_ENCRYPTION_KEY` | freshly generated pair, plus `STAGING_ACCESS` |
| Access control | public | HTTP Basic gate + `X-Robots-Tag: noindex` |
| RUM beacon | disabled by a Configuration Rule | disabled by a Configuration Rule |

A Durable Object namespace belongs to the script that declares the class, so the staging Worker
gets its own `BeyondFogService` namespace automatically. The staging D1 was created empty and
migrated with `migrations/0001_initial.sql`; no production row, schema dump or secret was copied.

## Request path

```
browser ──TLS──▶ staging.search.foghub.org (Cloudflare edge, RUM disabled)
                     │
                     ▼
              beyondfog-staging Worker
                     │  1. stagingGate(): HTTP Basic check → 401 when missing/wrong
                     │  2. /api/* → SERVICE.get(idFromName('beyondfog-private-service'))
                     │  3. everything else → ASSETS (dist/client, SPA fallback)
                     │  4. applySecurityHeaders() + X-Robots-Tag: noindex
                     ▼
        D1 beyondfog-staging-db   +   DO namespace of beyondfog-staging
```

The gate runs before any routing, so unauthenticated requests never reach the Durable Object,
D1 or the asset layer. The comparison is length-checked and constant-time-ish (XOR over equal
lengths) to avoid leaking the credential through timing.

## Configuration files

- `wrangler.staging.jsonc` — the staging Worker definition. It deliberately omits `send_email`,
  sets `workers_dev: false`, and points `assets.directory` at `./dist/client` because a direct
  `wrangler deploy` (unlike the Vite plugin) does not inject it.
- `worker/types.ts` — `Env` gained `STAGING_ACCESS?: string` and `ENVIRONMENT?: string`.
- `worker/index.ts` — `stagingGate()` plus the `X-Robots-Tag` header for `ENVIRONMENT=staging`.
- `scripts/deploy-staging.mjs` — guarded repeatable deploy (build → deploy → smoke).
- `scripts/staging-smoke.mjs` — HTTP-level smoke test for the staging host.
- `scripts/create-staging-account.mjs` — creates the staging owner account in the staging D1 only.

## Why a separate Worker instead of a preview URL

`wrangler preview` (4.147.0, open beta) deploys the current Worker as a Preview but keeps the
production bindings: the same D1, the same Durable Object namespace, the same `EMAIL` binding.
It offers no way to override bindings, so a preview would write to production data. A separate
Worker with its own D1 and its own secrets is the only configuration that satisfies the
"no production data" requirement while still being a real Cloudflare deployment.
