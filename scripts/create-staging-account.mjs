#!/usr/bin/env node
/**
 * Creates the synthetic owner account inside the staging D1 database.
 *
 * The staging Worker only accepts the owner, so the account email must match the
 * staging `OWNER_EMAIL` var. Nothing here reads production: the config is verified to be
 * the staging one, the D1 id must differ from production, and the SQL is generated fresh.
 *
 * Usage: node scripts/create-staging-account.mjs [email] [password]
 * Writes the credentials to .artifacts/staging-account.txt (gitignored).
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { accountSql } from './account-lib.mjs';

const PRODUCTION_D1 = 'f2bb555f-83d0-4bb4-8ff8-d0b7a0995669';
const PRODUCTION_DOMAIN = 'search.foghub.org';
const STAGING_DOMAIN = 'staging.search.foghub.org';

function readStagingConfig() {
  const raw = readFileSync('wrangler.staging.jsonc', 'utf8');
  // The config is JSONC: strip whole-line `//` comments, then parse.
  const json = raw
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
  return JSON.parse(json);
}

const config = readStagingConfig();
if (config.name !== 'beyondfog-staging') throw new Error(`拒绝执行：配置文件指向 ${config.name}`);
const database = config.d1_databases?.[0];
if (!database?.database_id) throw new Error('拒绝执行：缺少 D1 绑定');
if (database.database_id === PRODUCTION_D1) throw new Error('拒绝执行：D1 指向生产数据库');
if (config.vars?.APP_ORIGIN !== `https://${STAGING_DOMAIN}`) throw new Error('拒绝执行：APP_ORIGIN 不是 staging 域名');
if (config.routes?.some((route) => route.pattern === PRODUCTION_DOMAIN)) throw new Error('拒绝执行：路由包含生产域名');

const email = (process.argv[2] ?? 'staging@foghub.org').toLowerCase();
if (email !== String(config.vars?.OWNER_EMAIL).toLowerCase()) {
  throw new Error(`拒绝执行：账号邮箱必须等于 staging OWNER_EMAIL（${config.vars?.OWNER_EMAIL}）`);
}
const password = process.argv[3] ?? randomBytes(18).toString('base64url');
if (password.length < 12 || password.length > 128) throw new Error('密码须为 12–128 个字符');

const sql = await accountSql(email, password);
const dir = mkdtempSync(join(tmpdir(), 'beyondfog-staging-account-'));
const file = join(dir, 'account.sql');
try {
  writeFileSync(file, `${sql}\n`, { mode: 0o600 });
  const args = [
    'wrangler',
    'd1',
    'execute',
    database.database_name,
    '--remote',
    '--config',
    'wrangler.staging.jsonc',
    '--file',
    file,
  ];
  const result = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) throw new Error(`d1 execute 失败（exit ${result.status}）`);
  writeFileSync('.artifacts/staging-account.txt', `email=${email}\npassword=${password}\n`);
  console.log(`staging account ready: ${email}`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
