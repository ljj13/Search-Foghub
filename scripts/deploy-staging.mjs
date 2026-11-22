/**
 * Deploy the current branch to the isolated staging Worker.
 *
 * Refuses to run when wrangler.staging.jsonc points at production resources, then
 * builds the client, deploys with the staging config and runs the staging smoke test.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const PRODUCTION_D1 = 'f2bb555f-83d0-4bb4-8ff8-d0b7a0995669';

const raw = readFileSync('wrangler.staging.jsonc', 'utf8');
const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, ''));

function fail(message) {
  console.error(`staging deploy refused: ${message}`);
  process.exit(1);
}

if (config.name !== 'beyondfog-staging') fail(`worker name is ${config.name}`);
if (config.workers_dev !== false) fail('workers_dev must stay false');
const d1 = config.d1_databases?.find((entry) => entry.binding === 'DB');
if (!d1) fail('missing DB binding');
if (d1.database_id === PRODUCTION_D1) fail('DB binding points at the production database');
const routes = (config.routes ?? []).map((route) => route.pattern);
if (!routes.length) fail('missing routes');
for (const pattern of routes) {
  if (pattern !== 'staging.search.foghub.org') fail(`route ${pattern} is not the staging host`);
}
const vars = config.vars ?? {};
if (vars.APP_ORIGIN !== 'https://staging.search.foghub.org') fail(`APP_ORIGIN is ${vars.APP_ORIGIN}`);
if (vars.ENVIRONMENT !== 'staging') fail('ENVIRONMENT must be staging');
if (config.send_email) fail('staging must not bind send_email');
if (config.observability?.enabled) fail('staging should keep observability off');

console.log('staging config guards: ok');

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run('npm', ['run', 'build']);
run('npx', ['wrangler', 'deploy', '--config', 'wrangler.staging.jsonc']);
run('node', ['scripts/staging-smoke.mjs']);
