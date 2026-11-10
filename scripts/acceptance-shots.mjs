// Local acceptance sweep: five viewports in visitor and owner state, two browser
// zoom levels, and reduced motion. Prints one line per case and writes screenshots
// to .artifacts/accept/. Needs `npm run dev` on 127.0.0.1:5173 and the seeded test
// account (npm run db:local && node scripts/seed-test.mjs).
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:5173';
const OUT = '.artifacts/accept';
mkdirSync(OUT, { recursive: true });

const viewports = [
  [360, 800, '360x800'],
  [390, 844, '390x844'],
  [768, 1024, '768x1024'],
  [1440, 900, '1440x900'],
  [1920, 1080, '1920x1080'],
];
// Browser zoom changes the CSS viewport: 125% and 150% on a 1440x900 window.
const zoomed = [
  [1152, 720, 'zoom125'],
  [960, 600, 'zoom150'],
];

const folders = [
  { id: 'f-mail', name: '邮箱', icon: 'mail' },
  { id: 'f-work', name: '工作', icon: 'briefcase' },
  { id: 'f-study', name: '学习', icon: 'book' },
  { id: 'f-shop', name: '购物', icon: 'shopping' },
  { id: 'f-fun', name: '娱乐', icon: 'play' },
  { id: 'f-tools', name: '工具', icon: 'tools' },
];
const shortcuts = [
  ['Gmail', 'https://mail.google.com/', 'f-mail'], ['Outlook', 'https://outlook.live.com/', 'f-mail'],
  ['GitHub', 'https://github.com/', 'f-work'], ['Linear', 'https://linear.app/', 'f-work'],
  ['Notion', 'https://www.notion.so/', 'f-work'], ['提交作业', 'https://example.edu/submit', 'f-work'],
  ['Figma', 'https://www.figma.com/', 'f-work'],
  ['Coursera', 'https://www.coursera.org/', 'f-study'], ['知乎', 'https://www.zhihu.com/', 'f-study'],
  ['中国大学MOOC', 'https://www.icourse163.org/', 'f-study'],
  ['淘宝', 'https://www.taobao.com/', 'f-shop'], ['京东', 'https://www.jd.com/', 'f-shop'],
  ['哔哩哔哩', 'https://www.bilibili.com/', 'f-fun'], ['YouTube', 'https://www.youtube.com/', 'f-fun'],
  ['Cloudflare', 'https://dash.cloudflare.com/', 'f-tools'], ['维基百科', 'https://zh.wikipedia.org/', 'f-tools'],
  ['Unsplash', 'https://unsplash.com/', 'f-tools'], ['MDN', 'https://developer.mozilla.org/', 'f-tools'],
].map(([title, url, folderId], index) => ({ id: `demo-${index}`, title, url, folderId }));

const shipped = {
  engine: 'google', newTab: true, wallpaper: { kind: 'builtin', id: 'alpine-mist' }, dim: 0.32,
  shortcutLayout: 'flat', folders: [],
  shortcuts: [
    { id: 'github', title: 'GitHub', url: 'https://github.com/', folderId: null },
    { id: 'gmail', title: 'Gmail', url: 'https://mail.google.com/', folderId: null },
    { id: 'bilibili', title: '哔哩哔哩', url: 'https://www.bilibili.com/', folderId: null },
    { id: 'wikipedia', title: '维基百科', url: 'https://zh.wikipedia.org/', folderId: null },
    { id: 'cloudflare', title: 'Cloudflare', url: 'https://dash.cloudflare.com/', folderId: null },
  ],
};

async function open(browser, options) {
  const context = await browser.newContext({ deviceScaleFactor: 1, ...options });
  context.setExtraHTTPHeaders({ 'cf-connecting-ip': `accept-${randomUUID()}` });
  return context;
}

async function signIn(context) {
  const response = await context.request.post(`${ORIGIN}/api/auth/sign-in/email`, {
    headers: { Origin: ORIGIN },
    data: { email: 'owner@example.com', password: 'BeyondFog-test-password-2026' },
  });
  if (response.status() !== 200) throw new Error(`sign-in ${response.status()}`);
}

async function write(context, data) {
  const snapshot = await (await context.request.get(`${ORIGIN}/api/preferences`)).json();
  const put = await context.request.put(`${ORIGIN}/api/preferences`, {
    headers: { Origin: ORIGIN },
    data: { schemaVersion: 2, version: snapshot.version, data },
  });
  if (put.status() !== 200) throw new Error(`preferences ${put.status()}`);
}

const browser = await chromium.launch();
const results = [];

async function capture(label, width, height, state) {
  const context = await open(browser, { viewport: { width, height } });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
  if (state === 'signed') { await signIn(context); await write(context, { ...shipped, shortcutLayout: 'folders', folders, shortcuts }); }

  // The dev server keeps a HMR websocket open, so "networkidle" never settles there.
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('.shortcut-grid, .shortcut-skeleton').first().waitFor();
  await page.waitForTimeout(700);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.screenshot({ path: `${OUT}/${label}-${state}.png` });

  const row = { label, state, viewport: `${width}x${height}`, overflow, errors: errors.length, notes: [] };
  if (overflow > 0) row.notes.push(`overflow ${overflow}px`);

  if (state === 'signed') {
    await page.locator('.folder-trigger').first().click();
    await page.locator('.folder-popup').waitFor();
    await page.waitForTimeout(350);
    const popup = await page.evaluate(() => {
      const rect = document.querySelector('.folder-popup').getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, vw: innerWidth, vh: innerHeight, sheet: document.querySelector('.folder-popup').classList.contains('is-sheet') };
    });
    row.sheet = popup.sheet;
    if (popup.x < 0 || popup.y < 0 || popup.x + popup.w > popup.vw + 1 || popup.y + popup.h > popup.vh + 1) row.notes.push('popup outside viewport');
    await page.screenshot({ path: `${OUT}/${label}-${state}-popup.png` });
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: '打开设置' }).click();
    await page.getByRole('dialog').waitFor();
    await page.waitForTimeout(350);
    const panel = await page.evaluate(() => {
      const rect = document.querySelector('.panel').getBoundingClientRect();
      return { x: rect.x, y: rect.y, w: rect.width, h: rect.height, vw: innerWidth, vh: innerHeight };
    });
    if (panel.x < 0 || panel.y < 0 || panel.x + panel.w > panel.vw + 1 || panel.y + panel.h > panel.vh + 1) row.notes.push('settings panel outside viewport');
    await page.screenshot({ path: `${OUT}/${label}-${state}-settings.png` });
  }

  results.push(row);
  await context.close();
}

for (const [width, height, label] of viewports) {
  await capture(label, width, height, 'guest');
  await capture(label, width, height, 'signed');
}
for (const [width, height, label] of zoomed) await capture(label, width, height, 'signed');

{
  const context = await open(browser, { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await signIn(context);
  await write(context, { ...shipped, shortcutLayout: 'folders', folders, shortcuts });
  await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('.folder-trigger').first().waitFor();
  await page.locator('.folder-trigger').first().click();
  await page.locator('.folder-popup').waitFor();
  const motion = await page.evaluate(() => {
    const popup = getComputedStyle(document.querySelector('.folder-popup'));
    const tile = getComputedStyle(document.querySelector('.folder-popup-sites a') ?? document.body);
    return { animation: popup.animationDuration, transition: tile.transitionDuration };
  });
  await page.screenshot({ path: `${OUT}/390x844-reduced-motion.png` });
  results.push({ label: 'reduced-motion', state: 'signed', viewport: '390x844', overflow: 0, errors: 0, motion, notes: motion.animation === '0s' ? [] : [`animation ${motion.animation}`] });
  await context.close();
}

{
  const context = await open(browser, { viewport: { width: 900, height: 700 } });
  await signIn(context);
  await write(context, shipped);
  await context.close();
}

await browser.close();
writeFileSync(`${OUT}/report.json`, JSON.stringify(results, null, 2));
for (const row of results) {
  console.log(`${row.label} ${row.state}: overflow=${row.overflow} errors=${row.errors} ${row.notes.join('; ') || 'ok'}`);
}
