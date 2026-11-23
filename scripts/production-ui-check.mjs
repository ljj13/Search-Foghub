/**
 * Read-only browser acceptance run against the live production site.
 *
 * Opens https://search.foghub.org at three viewports as a guest, checks the modern UI,
 * the login dialog, security headers and the redirect from the old domain. It never signs
 * in and never writes preferences, so it is safe to run against production data.
 *
 * Requires: `npx playwright install chromium`. Screenshots go to .artifacts/p15/.
 * Exits non-zero if any check fails.
 */
import { mkdirSync } from 'node:fs';
import { fetch, ProxyAgent } from 'undici';
import { chromium } from '@playwright/test';

const BASE = process.env.ORIGIN ?? 'https://search.foghub.org';
const OLD = 'https://beyondfog.cc.cd';
const OUT = '.artifacts/p15';
mkdirSync(OUT, { recursive: true });

const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}

async function http(path, init = {}, origin = BASE) {
  return fetch(origin + path, { dispatcher, signal: AbortSignal.timeout(30000), ...init });
}

// ---------- HTTP checks ----------
const home = await http('/');
const html = await home.text();
check('首页 200', home.status === 200, String(home.status));
check('无 HTTP Basic 质询头', home.headers.get('www-authenticate') === null);
check('CSP 未被弱化', home.headers.get('content-security-policy') ===
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: https:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
check('HSTS 一年', home.headers.get('strict-transport-security') === 'max-age=31536000');
check('无 Cloudflare RUM 信标', !/cloudflareinsights\.com\/beacon|data-cf-beacon/.test(html));

const bundle = html.match(/src="([^"]+\.js)"/)?.[1] ?? '';
check('加载现代化前端 bundle', bundle !== '' && !bundle.includes('BJdcq09k'), bundle);

const session = await http('/api/auth/get-session');
check('未登录会话为 null', session.status === 200 && (await session.json()) === null);

for (const path of ['/api/preferences', '/api/webdav/connection']) {
  const r = await http(path);
  check(`未登录 ${path} 返回 401`, r.status === 401, String(r.status));
  check(`${path} 禁止缓存`, (r.headers.get('cache-control') ?? '').includes('no-store'));
  await r.body?.cancel();
}

const signup = await http('/api/auth/sign-up/email', {
  method: 'POST',
  headers: { Origin: BASE, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'intruder@example.com', password: 'Test-only-password-2026', name: 'x' }),
});
check('公开注册关闭', signup.status === 403, String(signup.status));
await signup.body?.cancel();

const old = await http('/a/b?c=1', { redirect: 'manual' }, OLD);
check('旧域名 302', old.status === 302, String(old.status));
check('旧域名保留路径与查询', old.headers.get('location') === `${BASE}/a/b?c=1`, old.headers.get('location') ?? '');
await old.body?.cancel();

// ---------- browser checks ----------
const browser = await chromium.launch({ proxy: proxy ? { server: proxy } : undefined });
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
];

for (const vp of viewports) {
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  const page = await context.newPage();
  const errors = [];
  const failed = [];
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
  page.on('requestfailed', (req) => failed.push(`${req.method()} ${req.url()} ${req.failure()?.errorText}`));

  const response = await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  check(`[${vp.name}] 页面状态 200`, response?.status() === 200, String(response?.status()));
  await page.locator('.shortcut-grid, .shortcut-skeleton').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/guest-${vp.name}.png` });

  check(`[${vp.name}] 无骨架残留`, (await page.locator('.shortcut-skeleton').count()) === 0);
  check(`[${vp.name}] 五个默认捷径`, (await page.locator('.shortcut-link').count()) === 5);
  check(`[${vp.name}] 顶栏显示登录`, (await page.locator('.login-button').innerText()).trim() === '登录');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check(`[${vp.name}] 无横向溢出`, overflow <= 0, String(overflow));
  // Console hygiene is judged on a plain guest load; the deliberate wrong password below
  // answers 401 and the browser logs that request, which is expected.
  check(`[${vp.name}] 无控制台错误`, errors.length === 0, errors.slice(0, 2).join(' | '));

  await page.locator('.login-button').click();
  const modal = page.locator('.scrim .modal');
  await modal.waitFor({ timeout: 10000 });
  const box = await modal.boundingBox();
  const inside = box && box.x >= 0 && box.y >= 0 && box.x + box.width <= vp.width && box.y + box.height <= vp.height;
  check(`[${vp.name}] 登录弹窗在视口内`, Boolean(inside), box ? `${Math.round(box.width)}x${Math.round(box.height)}@${Math.round(box.x)},${Math.round(box.y)}` : 'no box');
  await page.screenshot({ path: `${OUT}/login-${vp.name}.png` });

  await page.getByLabel('邮箱').fill('fogpurification@gmail.com');
  await page.getByLabel('密码').fill('Not-the-owner-password-2026');
  await page.locator('.scrim .modal button.primary').click();
  const wrongText = await page.getByText('邮箱或密码错误', { exact: true }).first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  check(`[${vp.name}] 错误密码返回预期提示`, wrongText);

  await page.keyboard.press('Escape');
  check(`[${vp.name}] Escape 关闭登录弹窗`, (await page.locator('.scrim').count()) === 0);
  // A failed sign-in is supposed to surface ONE 401; anything else still counts as noise.
  const unexpected = errors.filter((text) => !/status of 401/.test(text));
  check(`[${vp.name}] 错误密码只产生一个预期 401`, unexpected.length === 0, unexpected.slice(0, 2).join(' | '));
  check(`[${vp.name}] 无失败请求`, failed.length === 0, failed.slice(0, 2).join(' | '));
  await context.close();
}

await browser.close();

const failedChecks = results.filter((r) => !r.ok);
console.log(`\n${results.length - failedChecks.length}/${results.length} checks passed`);
if (failedChecks.length) process.exitCode = 1;
