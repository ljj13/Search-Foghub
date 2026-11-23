# P14 Staging Security

> **Historical.** The staging environment was decommissioned in P15: `staging.search.foghub.org` no longer resolves, and its Wrangler config and scripts were removed from the repository. This document is kept as the record of what was validated.

Staging is a real, internet-reachable Cloudflare deployment. It is protected by an access gate
and by full resource isolation from production. This document records the model and the evidence.

## Threat model

| Risk | Mitigation |
| --- | --- |
| Anyone on the internet finds the staging URL | HTTP Basic gate on every request, `X-Robots-Tag: noindex, nofollow`, no `workers.dev` hostname, no preview URLs |
| Search engines index staging | `noindex` on the gate response and on every application response (`ENVIRONMENT=staging`) |
| Staging writes production data | Separate D1 (`fb23bb45-…` vs `f2bb555f-…`), separate Durable Object namespace (owned by `beyondfog-staging`), separate secrets |
| Staging sends real mail | No `send_email` binding; `request-password-reset` answers `503` |
| Staging reads production sessions | Cookies are host-scoped (`staging.search.foghub.org`), `APP_ORIGIN` is the staging host, and Better Auth `trustedOrigins` only contains it |
| Staging reaches production APIs | Production `Origin` is rejected with `403`; the staging Worker has no production bindings |
| Credentials leak through the bundle | The bundle contains no owner address; secrets live only in Worker secrets |
| Timing attack on the gate | Length check first, then XOR over equal-length buffers |

## Access gate

`worker/index.ts` runs `stagingGate()` before routing whenever `STAGING_ACCESS` is set:

- missing or malformed `Authorization: Basic …` → `401` with
  `WWW-Authenticate: Basic realm="BeyondFog staging", charset="UTF-8"`, `Cache-Control: no-store`
  and `X-Robots-Tag: noindex, nofollow`;
- wrong credentials → the same `401`;
- correct credentials → the request continues to the normal router.

The gate is only active when the secret exists, so production (which has no `STAGING_ACCESS`)
is unaffected.

## Data isolation

| Resource | Production | Staging |
| --- | --- | --- |
| D1 | `f2bb555f-83d0-4bb4-8ff8-d0b7a0995669` | `fb23bb45-004f-4c2a-afe9-4cb65ceabbc5` (created empty, migrated from `migrations/`) |
| Durable Object | namespace of `beyondfog` | namespace of `beyondfog-staging` |
| `BETTER_AUTH_SECRET` | production value | freshly generated 43-char base64url |
| `WEBDAV_ENCRYPTION_KEY` | production value | freshly generated 64-hex |
| Owner account | `fogpurification@gmail.com` | `staging@foghub.org` |
| Mail | `send_email` → owner inbox | none |
| WebDAV | owner's real connection | none configured (`configured: false`) |

No production row, schema dump, secret or session was copied. The staging database was created
empty and migrated with `migrations/0001_initial.sql` (7 tables, 0 users before the test account).

## Verified evidence

- `GET /` without credentials → `401`, `WWW-Authenticate: Basic …`, `X-Robots-Tag: noindex, nofollow`.
- `GET /` with credentials → `200`, CSP byte-identical to production, no `cloudflareinsights` beacon.
- `POST /api/auth/sign-in/email` with `Origin: https://search.foghub.org` → `403` (production origin rejected).
- `POST /api/auth/request-password-reset` → `503` (no mail binding).
- `GET /api/preferences` without a session → `401` + `Cache-Control: no-store, private`.
- Session cookie: `HttpOnly`, `Secure`, `SameSite=Lax`, host-scoped to `staging.search.foghub.org`,
  not readable from `document.cookie`.
- Production D1 still has exactly one user; production deployment is still `f358b11d` serving
  `/assets/index-BJdcq09k.js`.

## Residual risks

- The Basic credentials are shared with whoever tests staging; rotate `STAGING_ACCESS` when the
  circle changes.
- The staging account password is stored in `.artifacts/staging-account.txt` (gitignored). It only
  grants access to disposable staging data.
- Staging runs the same Worker code as production, so a bug in the shared code can still be
  exercised there — that is the point of staging, and it cannot reach production data.
- Cloudflare RUM is disabled for the staging host by a Configuration Rule; if that rule is
  removed, the beacon returns and the strict CSP blocks it (visible as a console error).
