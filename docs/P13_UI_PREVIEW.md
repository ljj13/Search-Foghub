# P13-B：现代化前端独立预览与验收

日期：2026-11-22
生产域名：`https://search.foghub.org`（未改动）
生产版本：`f358b11d-da50-48cc-8e64-4dd7c74b2dde`（commit `0d25fc5`）

## 1. 分支对照

| 项目 | `main` | `feat/ui-modernize` |
|---|---|---|
| 最新提交 | `0d25fc5` chore: serve the site from search.foghub.org | `3a43a2b` feat: modernize the home screen, shortcuts grid and folder menus |
| 相对 main | — | 领先 2 个提交（`46281cb`、`3a43a2b`） |
| 差异规模 | — | 38 文件，+1535 / −80 |
| 是否包含域名迁移 | 是 | **是**（已 rebase 到 `0d25fc5`，`main` 是祖先） |
| Worker / `wrangler.jsonc` / `migrations` | — | **与 main 完全一致**（`git diff main..feat/ui-modernize -- worker/ wrangler.jsonc migrations/` 为空） |
| 是否推送 | 已推送 | 未推送 |

结论：分支只改前端（`src/`、`src/styles/`、`tests/`、`docs/`），Worker 与绑定没有差异，因此不存在"分支落后于域名迁移"的问题。

## 2. Preview 使用的方式

**没有创建云端 Preview 部署**，使用本地开发服务器 + Playwright 做真实浏览器验收。

原因（已实际核查）：

1. `wrangler preview`（4.147.0，满足 ≥4.135.0 要求）是"把当前 Worker 作为 Preview 部署"，**沿用生产绑定**：D1 `f2bb555f-83d0-4bb4-8ff8-d0b7a0995669`、Durable Object `BeyondFogService`、`EMAIL` 发送绑定、`ASSETS`。
2. `wrangler preview` 只支持 `--var` / `--secrets-file` / `--worker-name`，**没有绑定覆盖参数**；`preview base-config` 也只管理 secrets，不能替换 D1/DO。
3. 因此 Preview URL 上的登录、偏好读写都会落到**生产 D1 与生产 DO**，违反"Preview 不得写生产 D1 / 不得修改生产 DO / 不得读取私人用户数据"的硬约束。
4. 另建一套 D1 + Worker 属于新建生产级资源，超出本轮"只允许针对 `search.foghub.org` 做 RUM 配置变更"的 Cloudflare 操作范围，且任务明确禁止创建数据库副本/快照。

按任务允许的降级路径执行：**本地开发服务器 + Playwright**，并在此明确标注"未完成云端 Preview 部署"。

## 3. Preview 地址

- 本地地址：`http://127.0.0.1:5173`（仅本机，未暴露公网）
- 云端 Preview URL：**无**（BLOCKED，原因见上）
- 生产域名 `https://search.foghub.org` 未用于 Preview，Custom Domain 未改动

## 4. 测试资源隔离

| 资源 | Preview（本地） | 生产 | 是否隔离 |
|---|---|---|---|
| D1 | `.wrangler/state` 本地 SQLite（`npm run db:local` + `seed-test.mjs`） | 远程 D1 `f2bb555f-…` | 是 |
| Durable Objects | 本地 miniflare 实例 | 生产 `beyondfog-private-service` | 是 |
| Secrets | `.dev.vars`（本地随机密钥） | Worker Secrets | 是 |
| 账号 | `owner@example.com` / 本地测试密码 | `fogpurification@gmail.com` | 是 |
| 邮件 | 未配置 `EMAIL` 绑定，重置流程只验证界面 | 生产 `send_email` | 是（未发真实邮件） |
| WebDAV | 只验证入口与未连接空态，未使用真实网盘凭据 | 生产加密连接 | 是 |
| 偏好数据 | 虚构演示数据（6 文件夹 / 18 站点），测试后复原为 shipped defaults | 真实用户数据 | 是 |

## 5. 验收结果（真实浏览器，Playwright Chromium）

### 5.1 首页

| 视口 | 水平溢出 | 默认捷径 | 登录按钮 | Console 错误 | 截图 |
|---|---|---|---|---|---|
| 1440×900 | 0 | 5 | 登录 | 0 | `guest-desktop-1440x900.png` |
| 768×1024 | 0 | 5 | 登录 | 0 | `guest-tablet-768x1024.png` |
| 390×844 | 0 | 5 | 登录 | 0 | `guest-mobile-390x844.png` |

- 搜索框可输入（`雾景`），提交按钮可见；`role=searchbox` 语义正确。
- 悬停效果：图标 `translateY(-4px)`，实测 `none → matrix(1,0,0,1,0,-4)`。
- 加载状态：登录态、无缓存、偏好请求延迟 2s 时，显示 6 个骨架方块 + 顶栏「正在连接」+ `aria-busy=true`；请求返回后切换为真实布局（5 个捷径 + 「我的空间」）。
- 空状态：访客 5 个默认捷径 + 「添加捷径」占位；文件夹布局下 6 个文件夹 + 「添加文件夹」。

### 5.2 账号

| 检查项 | 结果 |
|---|---|
| 登录弹窗 | 三个视口均完整在视口内（桌面 420×499 @ x=510；平板 420×499 @ x=174；手机 350×489 @ x=20） |
| 表单校验 | 空提交被浏览器原生必填校验拦截（无自定义错误文案） |
| 错误密码 | 显示「邮箱或密码错误」 |
| 注册关闭 | 弹窗内无注册入口；`POST /api/auth/sign-up/email` 返回 403 |
| 密码重置界面 | 「忘记密码」进入重置表单，含邮箱输入与发送按钮（未发真实邮件） |
| Escape 关闭 | 三个视口均关闭成功 |
| 会话失效提示 | 由 `usePreferences` 的 401 分支清除本地快照并提示「会话已结束，私人内容已清除」（单测覆盖） |

### 5.3 私人功能

| 检查项 | 结果 |
|---|---|
| 设置面板 | 桌面 460×900 贴右；平板 460×1024；手机全屏 390×844，均不越界 |
| 四个页签 | 外观 / 捷径 / 网盘 / 账号 均可切换并渲染内容 |
| 捷径搜索 | 「按名称或域名查找」+ 「共 N 个」计数（P1 新增） |
| 网盘入口 | 未连接时显示连接表单与坚果云预设，未使用真实凭据 |
| 未登录拦截 | 访客 `GET /api/preferences` → 401（`no-store`），首页不请求私人接口（0 条 401 控制台错误） |
| API 错误处理 | 偏好加载失败时首页显示「暂时无法加载云端设置」+ 重试，账号仍显示「我的空间」 |

### 5.4 响应式与可访问性

| 检查项 | 结果 |
|---|---|
| 水平溢出 | 6 个组合（3 视口 × 访客/登录）全部 0 |
| 移动端按钮可点击 | 文件夹底部抽屉、添加网站、设置页签均可点击 |
| 弹窗越界 | 登录弹窗、设置面板、文件夹弹层均未越界 |
| 键盘 Tab | 首个 Tab 落在「打开设置」按钮（header 在 DOM 中先于搜索框） |
| Escape | 登录弹窗、设置面板、文件夹弹层均可关闭；弹层关闭后焦点回到触发按钮 |
| 焦点可见 | `:focus-visible` 2px 实线描边（实测 `solid 2px rgb(167,209,238)`） |
| 中文换行 | 文件夹弹层名称两行截断为 0 个（`truncated: 0`），`title` 属性保留全名 |
| 深色/浅色主题 | 产品为深色雾景主题（`color-scheme: dark`），无浅色主题 → N/A |
| Console 异常 | 访客与登录态 3 视口均为 0 条 |

### 5.5 文件夹弹层

| 视口 | 位置/尺寸 | 底部抽屉 | 越界 | 名称截断 |
|---|---|---|---|---|
| 1440×900 | 360×201 @ (392, 671) | 否 | 否 | 0 |
| 768×1024 | 360×201 @ (56, 704) | 否 | 否 | 0 |
| 390×844 | 366×205 @ (12, 626) | **是**（`is-sheet`） | 否 | 0 |

## 6. 截图位置

- 生产（main）：`.artifacts/p13-prod/home-{desktop-1440x900,tablet-768x1024,mobile-390x844}.png`
- 分支访客：`.artifacts/p13-preview/guest-*.png`
- 分支登录态：`.artifacts/p13-preview/signed-*.png`
- 设置面板：`.artifacts/p13-preview/settings-*.png`、`settings-{捷径,网盘,账号}-*.png`
- 文件夹布局与弹层：`.artifacts/p13-preview/folders-*.png`、`popup-folders-*.png`
- 登录/重置弹窗：`.artifacts/p13-preview/login-*.png`、`reset-*.png`
- 加载骨架：`.artifacts/p13-preview/loading-signed-1440x900.png`

## 7. 构建与测试结果（当前最新代码）

| 项目 | 结果 |
|---|---|
| `npx tsc --noEmit` | 通过（exit 0） |
| ESLint | 项目未配置 → N/A |
| 单元测试 `npx vitest run` | **78 / 78 通过**（10 文件，2.91s） |
| 构建 `npm run build` | 通过：CSS 30.27 kB（gzip 7.53）、JS 380.92 kB（gzip 117.27） |
| Worker 配置校验 | `wrangler.jsonc` 与 main 一致，`wrangler deploy --dry-run` 未执行（避免任何部署动作） |
| Playwright `npx playwright test` | **50 / 50 通过**（3.2m） |
| Preview API 冒烟 | 本地 `GET /api/preferences`（登录后）200；访客 401；`sign-in` 200 |

## 8. 与当前生产版对照

| 维度 | 当前 main（生产） | feat/ui-modernize（本地） |
|---|---|---|
| 首页视觉 | 5 捷径 + 添加捷径，固定网格 | 同左，新增设计变量与两行名称、折叠规则 |
| 桌面布局 1440×900 | 溢出 0 | 溢出 0 |
| 手机布局 390×844 | 溢出 0 | 溢出 0，文件夹弹层改为底部抽屉 |
| 搜索体验 | 可用 | 可用；输入不再触发整页重渲染 |
| 登录体验 | 可用 | 可用；状态区 `aria-live`、错误 `role=alert` |
| 默认快捷入口 | 5 个 | 5 个（一致） |
| 加载性能（构建产物） | CSS 23.46 kB / gzip 6.05；JS 374.94 kB / gzip 115.38 | CSS 30.27 kB / gzip 7.53；JS 380.92 kB / gzip 117.27（合计 gzip +3.37 kB） |
| Console 错误（访客） | 1 条（`/api/preferences` 401） | **0 条** |
| 自动化测试 | 单元 71 / e2e 47 | 单元 78 / e2e 50 |
| Worker 兼容性 | 生产已知 | Worker 代码与 main 完全一致 |

性能说明：本地 dev server 与生产 CDN 不可比，因此**没有**用本地加载时间推断生产性能；上表只比较构建产物体积。运行时性能差异未在同等条件下测量。

## 9. 仍需修复 / 值得继续优化的 UI 问题

1. **Tab 顺序**：首个 Tab 落在顶栏「打开设置」按钮，搜索框不是第一个焦点。起始页可考虑在非触屏设备上自动聚焦搜索框。
2. **空表单校验**：依赖浏览器原生必填校验，没有自定义中文提示。
3. **弹层键盘进入**：从触发按钮按 ArrowDown 时先落到「添加网站」按钮，而不是第一个网站链接（顺序可再调）。
4. **浅色主题**：产品只有深色雾景主题，若未来需要浅色需单独设计。
5. **首访骨架屏**：无本地快照时约 1 秒骨架屏（设计如此，非缺陷）。

## 10. 是否建议未来上线

**建议上线，但需要单独安排一次发布窗口**：

- 功能与回归：单元 78/78、e2e 50/50、三视口真实浏览器验收全部通过，无溢出、无控制台错误。
- 兼容性：Worker 与 main 完全一致，D1/DO 绑定不变，无需数据迁移（壁纸只存 id，`.webp` 文件名替换不影响偏好）。
- 风险点：构建体积 gzip +3.37 kB；Tab 顺序与空表单提示属于可接受的体验差异。
- 上线方式建议：`git push origin feat/ui-modernize` → 合并到 `main` → `npm run deploy`，并保留 `f358b11d` 作为回滚目标。

本轮**未合并、未部署、未推送**。
