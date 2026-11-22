# P14 UI Cloud Validation

The modernized front end was validated against the real Cloudflare staging deployment
(`https://staging.search.foghub.org`), not against a local dev server. Chromium ran through the
local proxy and authenticated with the staging Basic gate.

## Method

- Playwright Chromium, `httpCredentials` for the Basic gate.
- Three viewports: 1440×900 (desktop), 768×1024 (tablet), 390×844 (mobile).
- Guest and signed-in states for each viewport.
- Signed-in flow: real UI login on the first viewport (`.login-button` → dialog → submit), then
  the session is reused through `storageState` for the other viewports. The staging login
  limiter allows 8 attempts per 5 minutes per IP, so the script signs in once per run.
- Screenshots: `.artifacts/p14-cloud/{guest,signed,settings,popup}-{desktop,tablet,mobile}.png`.
- Script: `scripts/staging-ui-check.mjs` (repeatable; the HTTP-level checks live in
  `scripts/staging-smoke.mjs`).

## Result: 62/62 checks passed

| Area | Checks | Result |
| --- | --- | --- |
| Guest, 3 viewports | 5 default shortcuts, no horizontal overflow, header shows 登录, skeleton resolved, console clean, no failed requests, login dialog inside viewport, Escape closes | 24/24 PASS |
| Signed in, 3 viewports | header shows 我的空间, no horizontal overflow, console clean, settings panel inside viewport, preference persisted after reload, folder popup inside viewport, Escape closes, console clean after flows, no failed requests | 27/27 PASS |
| Security | session restored from storage state, private API `no-store, private`, CSP present, `X-Robots-Tag: noindex`, cookie HttpOnly/Secure/SameSite=Lax, cookie scoped to staging host, session token unreadable from JS, no Basic credentials → 401, 401 page does not leak the app | 11/11 PASS |

Measured geometry:

| Viewport | Login dialog | Settings panel | Folder popup |
| --- | --- | --- | --- |
| 1440×900 | 420×499 @ 510,200 | 460×900 @ 980,0 | 355×170 @ 589,683 |
| 768×1024 | 420×499 @ 174,262 | 460×1024 @ 308,0 | 355×170 @ 253,717 |
| 390×844 | 350×489 @ 20,177 | 390×844 @ 0,0 (full screen) | 366×173 @ 12,672 (bottom sheet) |

## What the run proves

- The modernized bundle (`/assets/index-CLYzVnaq.js`) renders correctly on a real Cloudflare
  deployment with the production CSP, not just locally.
- Guest pages make no failing requests and log no console errors — the guest 401 that production
  still shows (old build) does not occur on the branch.
- Sign-in, preference persistence (toggle `newTab`, reload, value survives), folder creation,
  layout switch and the folder popup all work end to end against the staging D1 and Durable
  Object.
- The Basic gate, `noindex`, cookie flags and origin checks behave as designed.

## Notes and limitations

- The staging login limiter (8 per 5 minutes per IP) is shared by every test run; the script
  signs in once and reuses the session, and a run that exhausts the window has to wait ~5 minutes.
- Screenshots are of the staging deployment with the staging test account, not production data.
- No production resource was read or written during this validation.
