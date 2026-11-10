import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { defaults } from '../../src/shared/preferences';

const ORIGIN = 'http://127.0.0.1:5173';

test.beforeEach(async ({ playwright }) => {
  const api = await playwright.request.newContext({
    baseURL: ORIGIN,
    extraHTTPHeaders: { Origin: ORIGIN, 'cf-connecting-ip': `fixture-${randomUUID()}` },
  });
  expect((await api.post('/api/auth/sign-in/email', { data: { email: 'owner@example.com', password: 'BeyondFog-test-password-2026' } })).status()).toBe(200);
  const snap = await (await api.get('/api/preferences')).json() as { version: number };
  expect((await api.put('/api/preferences', { data: { schemaVersion: 2, version: snap.version, data: defaults } })).status()).toBe(200);
  await api.dispose();
});

async function login(context: BrowserContext, page: Page) {
  await context.setExtraHTTPHeaders({ 'cf-connecting-ip': `test-${randomUUID()}` });
  const r = await context.request.post('/api/auth/sign-in/email', { headers: { Origin: ORIGIN }, data: { email: 'owner@example.com', password: 'BeyondFog-test-password-2026' } });
  expect(r.status()).toBe(200);
  await page.goto('/');
  await expect(page.getByRole('button', { name: '我的空间' })).toBeVisible();
}

test('the flat grid folds the rows that do not fit and expands again', async ({ browser }) => {
  const context = await browser.newContext(), page = await context.newPage();
  await login(context, page);
  const snap = await (await context.request.get('/api/preferences')).json() as { version: number; data: Record<string, unknown> };
  const shortcuts = Array.from({ length: 24 }, (_, i) => ({ id: `seed-${i}`, title: `示例站点 ${i + 1}`, url: `https://example.com/${i + 1}`, folderId: null }));
  const put = await context.request.put('/api/preferences', {
    headers: { Origin: ORIGIN },
    data: { schemaVersion: 2, version: snap.version, data: { ...snap.data, shortcutLayout: 'flat', shortcuts } },
  });
  expect(put.status()).toBe(200);
  await page.reload();

  const grid = page.locator('.shortcut-grid');
  const expand = page.getByRole('button', { name: /展开全部（共 24 个网站）/ });
  await expect(expand).toBeVisible();
  await expect(grid).toHaveClass(/is-collapsed/);
  const folded = await grid.evaluate(node => node.getBoundingClientRect().height);
  expect(await grid.evaluate(node => node.scrollHeight)).toBeGreaterThan(folded);

  await expand.click();
  await expect(page.getByRole('button', { name: '收起捷径', exact: true })).toBeVisible();
  await expect(grid).not.toHaveClass(/is-collapsed/);
  expect(await grid.evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThan(folded);
  await expect(page.getByRole('link', { name: '示例站点 24', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '收起捷径', exact: true }).click();
  await expect(grid).toHaveClass(/is-collapsed/);
  await context.close();
});

test('the shortcut search filters by name and by domain', async ({ browser }) => {
  const context = await browser.newContext(), page = await context.newPage();
  await login(context, page);
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('button', { name: '捷径', exact: true }).click();

  await expect(page.getByText('共 5 个', { exact: true })).toBeVisible();
  await page.getByRole('searchbox', { name: '搜索已有网站' }).fill('github.com');
  await expect(page.getByText('1 / 5 个匹配', { exact: true })).toBeVisible();
  await expect(page.locator('.shortcut-list .shortcut-row')).toHaveCount(1);

  await page.getByRole('button', { name: '清除搜索' }).click();
  await expect(page.getByText('共 5 个', { exact: true })).toBeVisible();
  await expect(page.locator('.shortcut-list .shortcut-row')).toHaveCount(5);

  await page.getByRole('searchbox', { name: '搜索已有网站' }).fill('维基');
  await expect(page.getByText('1 / 5 个匹配', { exact: true })).toBeVisible();
  await expect(page.locator('.shortcut-list .shortcut-row').filter({ hasText: '维基百科' })).toBeVisible();

  await page.getByRole('searchbox', { name: '搜索已有网站' }).fill('不存在的站点');
  await expect(page.getByText('0 / 5 个匹配', { exact: true })).toBeVisible();
  await context.close();
});

test('a deleted shortcut can be restored from the undo bar', async ({ browser }) => {
  const context = await browser.newContext(), page = await context.newPage();
  await login(context, page);
  await page.getByRole('button', { name: '打开设置' }).click();
  await page.getByRole('button', { name: '捷径', exact: true }).click();

  await page.getByRole('button', { name: '删除 Gmail' }).click();
  await expect(page.locator('.shortcut-list .shortcut-row')).toHaveCount(4);
  const undo = page.getByRole('status').filter({ hasText: '已删除「Gmail」' });
  await expect(undo).toBeVisible();

  await undo.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('.shortcut-list .shortcut-row')).toHaveCount(5);
  await expect(page.locator('.shortcut-list .shortcut-row').filter({ hasText: 'Gmail' })).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: '已删除「Gmail」' })).toBeHidden();
  await context.close();
});
