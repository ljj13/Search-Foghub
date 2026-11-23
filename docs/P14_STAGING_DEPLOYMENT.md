# P14 Staging Deployment

> **Historical.** The staging environment was decommissioned in P15: `staging.search.foghub.org` no longer resolves, and its Wrangler config and scripts were removed from the repository. This document is kept as the record of what was validated.

Staging is deployed with its own Wrangler config and its own resources. Nothing in this
document touches production.

## Prerequisites

- Node 24+ and `npm ci`.
- A Wrangler login with access to the `foghub.org` zone (`npx wrangler whoami`).
- The staging D1 database and its migrations (one-time, already done — see below).
- `.artifacts/staging-credentials.txt` (`user=…`, `password=…`) for the Basic gate, and
  `.artifacts/staging-account.txt` (`email=…`, `password=…`) for the staging owner account.
  Both files are gitignored.

## One-time setup (already completed)

```powershell
# 1. Empty database, then the production schema
npx wrangler d1 create beyondfog-staging-db
npx wrangler d1 migrations apply beyondfog-staging-db --remote --config wrangler.staging.jsonc

# 2. Secrets (fresh values, never copied from production)
npx wrangler secret bulk .artifacts/staging-secrets.json --config wrangler.staging.jsonc

# 3. Staging owner account (guards refuse to run against production)
node scripts/create-staging-account.mjs
```

`wrangler.staging.jsonc` pins the Worker name (`beyondfog-staging`), the staging D1 id, the
`staging.search.foghub.org` custom domain, `workers_dev: false`, and deliberately omits the
`send_email` binding.

## Repeatable deploy

```powershell
node scripts/deploy-staging.mjs
```

The script refuses to continue unless the config still points at staging resources (Worker
name, D1 id, route, `APP_ORIGIN`, `ENVIRONMENT=staging`, no `send_email`), then runs
`npm run build`, `npx wrangler deploy --config wrangler.staging.jsonc`, and
`node scripts/staging-smoke.mjs`.

Manual equivalent:

```powershell
npm run build
npx wrangler deploy --config wrangler.staging.jsonc
node scripts/staging-smoke.mjs
```

## Verifying a deployment

`scripts/staging-smoke.mjs` checks, over HTTPS through the proxy:

1. no credentials → `401` + `WWW-Authenticate` + `X-Robots-Tag: noindex`;
2. with credentials → `200`, CSP byte-identical to production, no RUM beacon, `noindex`;
3. bundle is JavaScript and contains neither the production nor the staging owner address;
4. `/api/auth/get-session` → `200 null`; private APIs → `401` + `no-store`;
5. sign-up → `403`; wrong password → `401`;
6. password reset → `503` (mail is not bound);
7. a request carrying the production `Origin` → `403`.

## Rollback

```powershell
npx wrangler deployments list --config wrangler.staging.jsonc
npx wrangler rollback <version-id> --config wrangler.staging.jsonc
```

Or check out the previous commit and run `node scripts/deploy-staging.mjs` again. Staging data
is disposable: the database can be re-migrated from `migrations/` at any time.

## Deployments so far

| Version | Commit | Notes |
| --- | --- | --- |
| `0f5a49a1-5b4f-44ec-955d-74a650ad1e12` | `feat/ui-modernize` (working tree) | first staging deploy: modernized front end, Basic gate, no mail |

## Access

- URL: `https://staging.search.foghub.org` (HTTP Basic required).
- Credentials: `.artifacts/staging-credentials.txt` (gitignored, rotate by re-uploading
  `STAGING_ACCESS` with `npx wrangler secret put STAGING_ACCESS --config wrangler.staging.jsonc`).
- Test account: `staging@foghub.org` (password in `.artifacts/staging-account.txt`).
