# P14 Final Report

P14 built an isolated Cloudflare staging environment for the modernized front end, deployed it,
validated it in a real browser against the real deployment, and left production untouched.

## Status table

| Step | Item | Status | Evidence |
| --- | --- | --- | --- |
| P14.1 | Audit production bindings and Worker routing | PASS | `wrangler.jsonc` reviewed; `worker/index.ts` request path traced |
| P14.2 | Separate staging Worker | PASS | `beyondfog-staging`, version `0f5a49a1-5b4f-44ec-955d-74a650ad1e12` |
| P14.3 | Separate D1 | PASS | `beyondfog-staging-db` `fb23bb45-004f-4c2a-afe9-4cb65ceabbc5`, created empty, `0001_initial.sql` applied (7 tables) |
| P14.4 | Separate Durable Object namespace | PASS | DO namespace belongs to the `beyondfog-staging` script |
| P14.5 | Separate Better Auth config and test account | PASS | `APP_ORIGIN=https://staging.search.foghub.org`, new `BETTER_AUTH_SECRET`, account `staging@foghub.org` |
| P14.6 | Mail isolation | PASS | no `send_email` binding; `request-password-reset` → `503` |
| P14.7 | Domain and access protection | PASS | `staging.search.foghub.org` only, `workers_dev: false`, Basic gate, `X-Robots-Tag: noindex`, RUM disabled by Configuration Rule |
| P14.8 | Deploy `feat/ui-modernize` | PASS | bundle `/assets/index-CLYzVnaq.js`, CSP byte-identical to production |
| P14.9 | Cloud browser validation | PASS | 62/62 checks, 3 viewports × guest/signed, see `P14_UI_CLOUD_VALIDATION.md` |
| P14.10 | Strong isolation verification | PASS | separate D1/DO/secrets/cookies; production origin `403`; production D1 still 1 user |
| P14.11 | Repeatable deploy script | PASS | `scripts/deploy-staging.mjs` (guards → build → deploy → smoke) |
| P14.12 | Documentation | PASS | this file plus the three companion documents |

## Production untouched

| Check | Result |
| --- | --- |
| Production deployment | still `f358b11d-da50-48cc-8e64-4dd7c74b2dde` (100%) |
| Production bundle | still `/assets/index-BJdcq09k.js` (pre-modernization build) |
| Production D1 | still 1 user; no staging row written |
| Production Worker / routes / bindings | unchanged |
| Production Better Auth config | unchanged (`APP_ORIGIN=https://search.foghub.org`) |
| Old domain redirect | `beyondfog.cc.cd` → `search.foghub.org` still 302 with path and query |
| `main` branch | unchanged at `0d25fc5`; `feat/ui-modernize` not merged |
| Production RUM rule | unchanged; production still serves no beacon |

## What staging is

- URL: `https://staging.search.foghub.org` (HTTP Basic required).
- Worker: `beyondfog-staging`; D1: `beyondfog-staging-db`; own Durable Object namespace; own
  secrets; no mail binding.
- Deploy: `node scripts/deploy-staging.mjs`; smoke: `node scripts/staging-smoke.mjs`.
- Details: `P14_STAGING_ARCHITECTURE.md`, `P14_STAGING_DEPLOYMENT.md`, `P14_STAGING_SECURITY.md`.

## Not tested / limitations

- **Cloudflare Workers Previews were not used.** `wrangler preview` keeps production bindings
  (same D1, same DO namespace, same `EMAIL`) and offers no binding overrides, so a preview would
  write production data. A separate Worker was used instead; this is a deliberate substitution,
  not a missing step.
- Staging has no real WebDAV connection configured, so the WebDAV upload/download path was not
  exercised against a real provider (the connection endpoint returns `configured: false`).
- Password reset is intentionally unavailable on staging (no mail binding); the reset UI was
  exercised locally in P13, not against staging.
- Staging data is disposable and may be reset at any time.

## Conclusion

The modernized front end runs on a real, isolated Cloudflare deployment that can be redeployed
repeatedly with one command, and every isolation claim is backed by a check in this report.
Production continues to serve the previous build from `main`; merging and deploying the branch
remain a separate, explicit decision.
