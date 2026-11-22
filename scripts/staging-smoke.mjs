/**
 * Staging smoke test.
 *
 * Verifies the staging deployment is reachable only through the Basic gate, keeps
 * the production CSP, carries no Cloudflare RUM beacon, rejects production origins
 * and has mail disabled. Credentials come from STAGING_ACCESS or
 * .artifacts/staging-credentials.txt (user=..., password=...).
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fetch, ProxyAgent } from 'undici';

const origin = process.env.STAGING_ORIGIN ?? 'https://staging.search.foghub.org';
const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;

function gate() {
  if (process.env.STAGING_ACCESS) return process.env.STAGING_ACCESS;
  const file = '.artifacts/staging-credentials.txt';
  const values = Object.fromEntries(
    readFileSync(file, 'utf8')
      .trim()
      .split('\n')
      .map((line) => line.split('=')),
  );
  return `${values.user}:${values.password}`;
}

const basic = 'Basic ' + Buffer.from(gate()).toString('base64');
const expectedCsp =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: https:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'";

async function call(path, { method = 'GET', data, auth = true, headers = {} } = {}) {
  return fetch(origin + path, {
    method,
    dispatcher,
    signal: AbortSignal.timeout(30000),
    headers: {
      ...(auth ? { Authorization: basic } : {}),
      ...(data === undefined ? {} : { Origin: origin, 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
}

const anonymous = await call('/', { auth: false });
assert.equal(anonymous.status, 401, 'staging must require the Basic gate');
assert(anonymous.headers.get('www-authenticate')?.startsWith('Basic'), 'missing WWW-Authenticate');
assert(anonymous.headers.get('x-robots-tag')?.includes('noindex'), 'missing X-Robots-Tag on the gate');
await anonymous.body?.cancel();
console.log('Basic 访问闸门：通过（401 + WWW-Authenticate + noindex）');

const homepage = await call('/');
assert.equal(homepage.status, 200);
assert.equal(homepage.headers.get('content-security-policy'), expectedCsp, 'CSP 与生产不一致');
assert(homepage.headers.get('x-robots-tag')?.includes('noindex'), 'staging 页面缺少 noindex');
assert.equal(homepage.headers.get('referrer-policy'), 'no-referrer');
assert.equal(homepage.headers.get('x-frame-options'), 'DENY');
const html = await homepage.text();
assert(!/cloudflareinsights\.com\/beacon|data-cf-beacon/.test(html), 'staging 仍注入 RUM 信标');
console.log('CSP 与生产逐字一致、无 RUM 信标、noindex：通过');

const asset = html.match(/src="([^"]+\.js)"/)?.[1];
assert(asset, 'missing bundle');
const bundle = await call(asset);
assert.equal(bundle.status, 200);
assert(bundle.headers.get('content-type')?.includes('javascript'));
const code = await bundle.text();
assert(!code.includes('fogpurification@gmail.com'), 'bundle 泄露生产账号');
assert(!code.includes('staging@foghub.org'), 'bundle 泄露 staging 账号');
console.log(`前端资源隔离：通过（${asset}）`);

const session = await call('/api/auth/get-session');
assert.equal(session.status, 200);
assert.equal(await session.json(), null);
for (const path of ['/api/preferences', '/api/webdav/connection', '/api/webdav/files']) {
  const response = await call(path);
  assert.equal(response.status, 401, `${path} 未登录应 401`);
  assert(response.headers.get('cache-control')?.includes('no-store'), `${path} 缺少 no-store`);
  await response.body?.cancel();
}
console.log('未登录私人接口 401 + no-store：通过');

const signup = await call('/api/auth/sign-up/email', {
  method: 'POST',
  data: { email: 'intruder@example.com', password: 'Test-only-password-2026', name: 'x' },
});
assert.equal(signup.status, 403);
await signup.body?.cancel();

const wrong = await call('/api/auth/sign-in/email', {
  method: 'POST',
  data: { email: 'staging@foghub.org', password: 'Not-the-staging-password-2026' },
});
assert.equal(wrong.status, 401);
await wrong.body?.cancel();
console.log('注册关闭、错误密码 401：通过');

const reset = await call('/api/auth/request-password-reset', {
  method: 'POST',
  data: { email: 'staging@foghub.org', redirectTo: origin },
});
assert.equal(reset.status, 503, 'staging 不应能发送真实邮件');
await reset.body?.cancel();
console.log('邮件隔离：通过（重置接口 503）');

const foreign = await call('/api/auth/sign-in/email', {
  method: 'POST',
  data: { email: 'staging@foghub.org', password: 'Not-the-staging-password-2026' },
  headers: { Origin: 'https://search.foghub.org' },
});
assert.equal(foreign.status, 403, '生产 Origin 必须被拒绝');
await foreign.body?.cancel();
console.log('生产 Origin 被拒绝：通过');

console.log('\nStaging 冒烟全部通过。');
