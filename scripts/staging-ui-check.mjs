/**
 * Browser acceptance run against the real staging deployment.
 *
 * Runs Chromium through the local proxy, authenticates with the staging Basic gate,
 * exercises guest and signed-in flows at three viewports, writes screenshots to
 * .artifacts/p14-cloud/ and prints PASS/FAIL lines. Exits non-zero if any check fails.
 *
 * Requires: a running staging deployment, `npx playwright install chromium`,
 * .artifacts/staging-credentials.txt and .artifacts/staging-account.txt.
 */
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const BASE = 'https://staging.search.foghub.org';
const OUT = '.artifacts/p14-cloud';
mkdirSync(OUT, { recursive: true });

const gate = Object.fromEntries(
  readFileSync('.artifacts/staging-credentials.txt', 'utf8').trim().split('\n').map((l) => l.split('=')),
);
const account = Object.fromEntries(
  readFileSync('.artifacts/staging-account.txt', 'utf8').trim().split('\n').map((l) => l.split('=')),
);
const proxy = process.env.HTTPS_PROXY;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

const browser = await chromium.launch({ proxy: proxy ? { server: proxy } : undefined });

async function newContext(viewport) {
  return browser.newContext({
    viewport,
    httpCredentials: { username: gate.user, password: gate.password },
  });
}

function watch(page) {
  const errors = [];
  const failed = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
  page.on('requestfailed', (req) => failed.push(`${req.method()} ${req.url()} ${req.failure()?.errorText}`));
  return { errors, failed };
}

const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

// ---------- guest ----------
for (const vp of viewports) {
  const context = await newContext({ width: vp.width, height: vp.height });
  const page = await context.newPage();
  const log = watch(page);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.locator('.shortcut-grid, .shortcut-skeleton').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);

  const shortcuts = await page.locator('.shortcut-link').count();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const loginLabel = (await page.locator('.login-button').innerText()).trim();
  const skeleton = await page.locator('.shortcut-skeleton').count();
  await page.screenshot({ path: `${OUT}/guest-${vp.name}.png` });

  check(`guest ${vp.name}: 5 default shortcuts`, shortcuts === 5, `got ${shortcuts}`);
  check(`guest ${vp.name}: no horizontal overflow`, overflow <= 0, `overflow=${overflow}`);
  check(`guest ${vp.name}: header shows 登录`, loginLabel === '登录', loginLabel);
  check(`guest ${vp.name}: skeleton resolved`, skeleton === 0, `skeleton=${skeleton}`);
  check(`guest ${vp.name}: console clean`, log.errors.length === 0, log.errors.slice(0, 2).join(' | '));
  check(`guest ${vp.name}: no failed requests`, log.failed.length === 0, log.failed.slice(0, 2).join(' | '));

  await page.locator('.login-button').click();
  await page.locator('.modal').waitFor({ timeout: 10000 });
  const dialogBox = await page.locator('.modal').boundingBox();
  const fits = dialogBox && dialogBox.x >= 0 && dialogBox.y >= 0 && dialogBox.x + dialogBox.width <= vp.width + 1 && dialogBox.y + dialogBox.height <= vp.height + 1;
  check(`guest ${vp.name}: login dialog inside viewport`, Boolean(fits), dialogBox ? `${Math.round(dialogBox.width)}x${Math.round(dialogBox.height)} @ ${Math.round(dialogBox.x)},${Math.round(dialogBox.y)}` : 'missing');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check(`guest ${vp.name}: Escape closes dialog`, (await page.locator('.modal').count()) === 0);

  await context.close();
}

// ---------- signed in ----------
// Sign in once (through the real UI on the first viewport) and reuse the session for the
// remaining viewports: the staging login limiter allows 8 attempts per 5 minutes per IP.
let signedState = null;
for (const vp of viewports) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    httpCredentials: { username: gate.user, password: gate.password },
    ...(signedState ? { storageState: signedState } : {}),
  });
  const page = await context.newPage();
  const log = watch(page);
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  if (!signedState) {
    await page.locator('.login-button', { hasText: '登录' }).waitFor({ timeout: 20000 });
    await page.locator('.login-button').click();
    await page.locator('.modal input[type="email"]').fill(account.email);
    await page.locator('.modal input[type="password"]').fill(account.password);
    await page.locator('.modal button.primary').click();
  }
  await page.locator('.login-button', { hasText: '我的空间' }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(800);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: `${OUT}/signed-${vp.name}.png` });
  check(`signed ${vp.name}: header shows 我的空间`, (await page.locator('.login-button').innerText()).includes('我的空间'));
  check(`signed ${vp.name}: no horizontal overflow`, overflow <= 0, `overflow=${overflow}`);
  check(`signed ${vp.name}: console clean`, log.errors.length === 0, log.errors.slice(0, 2).join(' | '));

  // settings: toggle newTab, wait for sync, reload, verify persistence
  await page.locator('.login-button').click();
  await page.locator('.panel').waitFor({ timeout: 10000 });
  await page.locator('.tabs button', { hasText: '外观' }).click();
  const newTab = page.locator('.panel .checkbox input[type="checkbox"]');
  const before = await newTab.isChecked();
  await newTab.setChecked(!before);
  await page.locator('.sync-status', { hasText: '已同步' }).waitFor({ timeout: 20000 });
  await page.screenshot({ path: `${OUT}/settings-${vp.name}.png` });
  const panelBox = await page.locator('.panel').boundingBox();
  const panelFits = panelBox && panelBox.x >= 0 && panelBox.y >= 0 && panelBox.x + panelBox.width <= vp.width + 1 && panelBox.y + panelBox.height <= vp.height + 1;
  check(`signed ${vp.name}: settings panel inside viewport`, Boolean(panelFits), panelBox ? `${Math.round(panelBox.width)}x${Math.round(panelBox.height)} @ ${Math.round(panelBox.x)},${Math.round(panelBox.y)}` : 'missing');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.login-button', { hasText: '我的空间' }).waitFor({ timeout: 20000 });
  await page.locator('.login-button').click();
  await page.locator('.tabs button', { hasText: '外观' }).click();
  const persisted = await page.locator('.panel .checkbox input[type="checkbox"]').isChecked();
  check(`signed ${vp.name}: preference persisted after reload`, persisted === !before, `before=${before} after=${persisted}`);
  await page.locator('.panel .checkbox input[type="checkbox"]').setChecked(before);
  await page.locator('.sync-status', { hasText: '已同步' }).waitFor({ timeout: 20000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // folders: create one, switch layout, open the popup
  await page.locator('.login-button').click();
  await page.locator('.tabs button', { hasText: '捷径' }).click();
  await page.getByRole('button', { name: '新建文件夹' }).click();
  const folderName = `云端验收 ${vp.name}`;
  await page.locator('.shortcut-form input').first().fill(folderName);
  await page.getByRole('button', { name: '保存文件夹' }).click();
  await page.locator('.folder-row-name', { hasText: folderName }).waitFor({ timeout: 10000 });
  await page.locator('input[aria-label="文件夹模式"]').check();
  await page.locator('.sync-status', { hasText: '已同步' }).waitFor({ timeout: 20000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  const folderTile = page.locator('.folder-trigger', { hasText: folderName }).first();
  await folderTile.waitFor({ timeout: 10000 });
  await folderTile.click();
  const popup = page.locator('.folder-popup');
  await popup.waitFor({ timeout: 10000 });
  const popupBox = await popup.boundingBox();
  const popupFits = popupBox && popupBox.x >= 0 && popupBox.y >= 0 && popupBox.x + popupBox.width <= vp.width + 1 && popupBox.y + popupBox.height <= vp.height + 1;
  check(`signed ${vp.name}: folder popup inside viewport`, Boolean(popupFits), popupBox ? `${Math.round(popupBox.width)}x${Math.round(popupBox.height)} @ ${Math.round(popupBox.x)},${Math.round(popupBox.y)}` : 'missing');
  await page.screenshot({ path: `${OUT}/popup-${vp.name}.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check(`signed ${vp.name}: Escape closes popup`, (await page.locator('.folder-popup').count()) === 0);

  // restore flat layout and remove the folder created for this viewport
  await page.locator('.login-button').click();
  await page.locator('.tabs button', { hasText: '捷径' }).click();
  await page.locator('input[aria-label="平铺模式"]').check();
  await page.locator('.sync-status', { hasText: '已同步' }).waitFor({ timeout: 20000 });
  await page.getByRole('button', { name: `删除文件夹 ${folderName}`, exact: true }).click();
  await page.getByRole('button', { name: '确定删除文件夹', exact: true }).click();
  await page.locator('.sync-status', { hasText: '已同步' }).waitFor({ timeout: 20000 });
  await page.keyboard.press('Escape');

  check(`signed ${vp.name}: console clean after flows`, log.errors.length === 0, log.errors.slice(0, 3).join(' | '));
  check(`signed ${vp.name}: no failed requests`, log.failed.length === 0, log.failed.slice(0, 2).join(' | '));
  if (!signedState) signedState = await context.storageState();
  await context.close();
}

// ---------- security ----------
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    httpCredentials: { username: gate.user, password: gate.password },
    ...(signedState ? { storageState: signedState } : {}),
  });
  const page = await context.newPage();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const session = await page.evaluate(async () => {
    const r = await fetch('/api/auth/get-session', { credentials: 'same-origin' });
    return (await r.json())?.user?.email ?? null;
  });
  check('security: session restored from storage state', session === account.email, String(session));

  const headers = await page.evaluate(async () => {
    const r = await fetch('/api/auth/get-session', { credentials: 'same-origin' });
    return { status: r.status, cache: r.headers.get('cache-control'), csp: r.headers.get('content-security-policy'), robots: r.headers.get('x-robots-tag') };
  });
  check('security: private API is no-store', headers.cache === 'no-store, private', String(headers.cache));
  check('security: CSP present on API', Boolean(headers.csp && headers.csp.includes("script-src 'self'")), String(headers.csp).slice(0, 60));
  check('security: X-Robots-Tag noindex', String(headers.robots).includes('noindex'), String(headers.robots));

  const cookies = await context.cookies(BASE);
  const sessionCookie = cookies.find((c) => c.name.includes('session_token'));
  check('security: session cookie HttpOnly', Boolean(sessionCookie?.httpOnly), sessionCookie?.name ?? 'missing');
  check('security: session cookie Secure', Boolean(sessionCookie?.secure), String(sessionCookie?.secure));
  check('security: session cookie SameSite=Lax', sessionCookie?.sameSite === 'Lax', String(sessionCookie?.sameSite));
  check('security: session cookie scoped to staging host', sessionCookie?.domain === 'staging.search.foghub.org', String(sessionCookie?.domain));

  const jsCookie = await page.evaluate(() => document.cookie);
  check('security: session token unreadable from JS', !jsCookie.includes('session_token'), jsCookie.slice(0, 60) || 'empty');
  await context.close();
}

// ---------- unauthorised access ----------
{
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const response = await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  check('security: no Basic credentials → 401', response?.status() === 401, String(response?.status()));
  const body = await page.content();
  check('security: 401 page does not leak the app', !body.includes('我的空间'), 'gate page');
  await context.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(` - ${f.name} ${f.detail}`);
  process.exit(1);
}
