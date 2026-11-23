# P15 正式上线 Report

- 日期：2026-11-23（Asia/Singapore）
- 生产站点：`https://search.foghub.org`
- 部署版本：`6781765d-2c11-4d36-ac25-4dd594135077`（commit `8871b60`）
- 结论：**三项任务全部完成**，生产数据未改动，旧域名跳转与 RUM/CSP 修复均保持有效。

## 1. 最终执行结论

| 验收项 | 结果 | 证据 |
| --- | --- | --- |
| `staging.search.foghub.org` 不再是公开站点 | PASS | Custom Domain 已删除；DNS 无记录（NXDOMAIN）；TLS 无法建立 |
| `search.foghub.org` 展示现代化前端 | PASS | 首页 bundle `index-CLYzVnaq.js`（旧版 `index-BJdcq09k.js` 已下线） |
| 网站可直接访问、无 HTTP Basic 弹窗 | PASS | 匿名 `GET /` 200；响应无 `WWW-Authenticate`；Basic 闸门代码已移除 |
| BeyondFog 自身账号认证正常 | PASS | `get-session` 200/null、错误密码 401、注册 403、未登录私人接口 401 + `no-store`、非白名单 Origin 403 |
| 现有用户数据不变 | PASS | 部署前后 D1：`user` 1 行、`preferences` 1 行（`version` 30）、`webdav` 1 行 |
| 旧域名 302 正常 | PASS | `https://beyondfog.cc.cd/x/y?z=1` → 302 `https://search.foghub.org/x/y?z=1` |
| RUM/CSP 冲突不复发 | PASS | HTML 无 beacon；CSP 与上线前逐字一致；`scripts/production-smoke.mjs` 已加回归断言 |
| 桌面与移动端验收 | PASS | 1440×900 / 768×1024 / 390×844 三视口 47/47 只读检查通过，无横向溢出、无失败请求 |
| GitHub main 与实际部署对应 | PASS | 部署构建 = `8871b60`；`main` 头为 `b10bf6d`（仅文档与检查脚本）；在 HEAD 重新构建的 bundle 与线上逐字相同 |
| 未创建备份或快照 | PASS | 未导出 D1、未复制密钥、未建快照、未写生产测试数据 |

## 2. Staging 域名删除结果

- **Custom Domain**：删除 `staging.search.foghub.org` 对 `beyondfog-staging` 的绑定（domain id `a16aeccd46d179b0445176616532a8681027fe5e`）。当前账号下的 Workers 自定义域只剩 `search.foghub.org`（`beyondfog`）与 `beyondfog.cc.cd`（`beyondfog`），生产绑定未改动。
- **DNS**：`GET /zones/24d327f1a74ad843887d5f303db2bf99/dns_records?name=staging.search.foghub.org` 返回 0 条；系统解析只返回 zone 的 SOA（NXDOMAIN），HTTPS 握手无法建立 → 该地址不再提供 BeyondFog 页面。
- **RUM 规则**：`foghub.org` 的 `http_config_settings` ruleset（`f332debfb61f4bbab0e3ed1eccf62ac5`）原有两条规则，更新后只保留 `Disable RUM for search.foghub.org`（`86fa8f980cfc4776bb1095ae8626cb14`）；仅作用于 staging 的规则 `c044abc25e424a83bdbcf46855829acd` 已删除。
- **其他占用**：`GET /zones/{zone}/workers/routes` 为空；`https://beyondfog-staging.fogpurification.workers.dev/` 返回 404（`workers_dev: false` 生效）；没有 Pages 项目使用该域名。
- **保留不删**：staging Worker（版本 `0f5a49a1-5b4f-44ec-955d-74a650ad1e12`）、D1 `beyondfog-staging-db`（`fb23bb45-004f-4c2a-afe9-4cb65ceabbc5`）与其 Durable Object 命名空间。它们没有任何公开入口，删除与否需另行授权。

## 3. HTTP Basic 清理结果

- `worker/index.ts`：删除 `stagingGate()`、`env.STAGING_ACCESS` 判断以及 `env.ENVIRONMENT === 'staging'` 的 `X-Robots-Tag` 分支。
- `worker/types.ts`：删除 `STAGING_ACCESS` 与 `ENVIRONMENT` 字段。
- 删除仅服务于 staging 的文件：`wrangler.staging.jsonc`、`scripts/deploy-staging.mjs`、`scripts/staging-smoke.mjs`、`scripts/create-staging-account.mjs`、`scripts/staging-ui-check.mjs`。P14 的技术文档保留为历史记录（已在正文标注已下线）。
- 新增 `scripts/production-ui-check.mjs`：只读生产浏览器验收（不登录、不写偏好），替代 staging 的浏览器回归脚本。
- 证据：首页、静态资源、`/api/*` 响应均无 `WWW-Authenticate`；匿名访问 200；应用内登录弹窗与 Better Auth 全部保留（错误密码 401 `INVALID_EMAIL_OR_PASSWORD`）。

## 4. Git 合并与提交

- 合并前：`main` = `fe1e5c6`（README 更新），`feat/ui-modernize` = `11e3785`（领先 5 个提交）。
- `git merge --ff-only feat/ui-modernize` → `11e3785`（快进，无冲突、无 squash）。
- 清理提交 `8871b60 chore: retire the staging access gate before launch`（Worker 去掉 Basic 闸门、删除 staging 配置与脚本、新增生产只读 UI 检查）。
- `git push origin main`：`fe1e5c6..8871b60`，随后本报告的提交 `b10bf6d` 再推一次（`8871b60..b10bf6d`）。`b10bf6d` 只含文档与 `scripts/production-ui-check.mjs`，不在 Worker/前端构建产物里。
- 工作区在构建与部署时干净（部署即由 `8871b60` 的代码构建）。

## 5. Cloudflare 生产部署版本

| 项目 | 值 |
| --- | --- |
| Worker | `beyondfog`（沿用现有 Worker，未改名、未新建） |
| 版本 | `6781765d-2c11-4d36-ac25-4dd594135077`（100%，2026-11-23T04:11:08Z / 12:11 SGT） |
| Commit | `8871b60`（部署构建；`main` 头 `b10bf6d` 仅文档与检查脚本，HEAD 重建 bundle 相同） |
| JS bundle | `/assets/index-CLYzVnaq.js`（380.92 kB / gzip 117.27 kB） |
| CSS bundle | `/assets/index-DWmpK7lc.css`（30.27 kB / gzip 7.53 kB） |
| 上传体积 | 1668.74 KiB / gzip 366.44 KiB |
| 绑定 | `SERVICE`（BeyondFogService）、`DB`（beyondfog，`f2bb555f-83d0-4bb4-8ff8-d0b7a0995669`）、`ASSETS`、`EMAIL`（fogpurification@gmail.com，发件人 `noreply@beyondfog.cc.cd`） |
| 变量 | `APP_ORIGIN=https://search.foghub.org`、`OWNER_EMAIL`、`EMAIL_FROM`、`WEBDAV_ALLOWED_HOSTS` |
| 回滚目标 | `f358b11d-da50-48cc-8e64-4dd7c74b2dde`（旧版界面，commit `0d25fc5`） |
| 更早版本 | `05f718cd-88eb-4936-ba04-1ad9df253fc7` |

- 首次部署尝试（10:47）在 Cloudflare API 超时处失败，`wrangler deployments status` 仍为 `f358b11d`，未产生半成品版本；重试后成功。
- 回滚命令：`npx wrangler rollback f358b11d-da50-48cc-8e64-4dd7c74b2dde`。

## 6. 正式网站实际测试

### 6.1 自动化结果（部署后）

- `node scripts/production-smoke.mjs`：5 组全过（首页与安全头、CSP 完整且无 beacon、bundle 不含私人账号、未登录私人接口 401 + `no-store`、注册关闭与错误密码 401，往返 563 ms）。
- `node scripts/production-ui-check.mjs`：**47/47 通过**。
  - 首页：200、无 Basic 质询、现代化 bundle、无 RUM 信标、CSP `script-src 'self'` 完整、HSTS 一年。
  - 三视口（1440×900 / 768×1024 / 390×844）：无骨架残留、5 个默认捷径、顶栏「登录」、无横向溢出、无控制台错误、无失败请求。
  - 登录弹窗：桌面 420×499 @ (510,200)、平板 420×499 @ (174,262)、手机 350×489 @ (20,177)，均在视口内；错误密码显示「邮箱或密码错误」；Escape 关闭。
  - 安全：`get-session` 200/null、`/api/preferences` 与 `/api/webdav/connection` 401 + `no-store`、`sign-up` 403、非白名单 Origin 403、旧域名 302 且保留路径与查询。
- 部署前本地回归：`tsc --noEmit` 干净、`vitest` 78/78、`playwright` 50/50、`npm run build` 通过。

### 6.2 逐项对照

| 检查项 | 结果 | 说明 |
| --- | --- | --- |
| 无 HTTP Basic 登录 | PASS | 响应头无 `WWW-Authenticate` |
| 未登录直接访问 | PASS | 三个视口均 200 |
| 现代化 UI 加载 | PASS | 新搜索框、圆角磁贴、WebP 壁纸、骨架屏逻辑 |
| 五个默认快捷入口 | PASS | `.shortcut-link` = 5 |
| 搜索框 | PASS | 表单渲染、可键入 |
| 加载骨架 | PASS | 无残留；本地断网用例覆盖骨架→真实内容的切换 |
| 深色/浅色主题 | NOT TESTED（不适用） | 应用只有深色玻璃主题，没有浅色模式开关 |
| 无横向溢出 | PASS | 三视口 `scrollWidth - innerWidth = 0` |
| 登录弹窗、错误密码、注册关闭、Origin 校验 | PASS | 见 6.1 |
| Session Cookie 属性 | NOT TESTED（需登录） | 无生产账号凭据；staging 同代码实测 `HttpOnly`/`Secure`/`SameSite=Lax` 且 host 限定 |
| 设置面板 / 偏好 / 文件夹弹层 / 网盘入口 / 移动端抽屉 / 焦点恢复 | NOT TESTED（需登录） | 同一份前端在 staging 做过 62/62（含登录态、设置、弹层、持久化），本地 e2e 50/50 覆盖；合并后前端代码未改，仅删除 staging 专用代码 |
| HTTPS / 证书 | PASS | 200，无证书错误 |
| CSP 严格、无 RUM Beacon | PASS | 与上线前逐字一致 |
| 静态资源 404 | PASS | 无失败请求 |
| Console 错误 | PASS | 匿名首页 0 条；错误密码仅产生预期的 401 资源日志 |

## 7. Better Auth 和 D1/DO 数据保护

- `worker/auth.ts`、`APP_ORIGIN`、`trustedOrigins`、密码策略、会话配置均未改动；本次只删除了 staging 专用分支。
- 生产 D1 只做只读核对：`SELECT COUNT(*)` 三条，部署前后均为 `user = 1`、`preferences = 1`（`version = 30`）、`webdav = 1`；未执行任何写语句、迁移或结构变更。
- 生产 Durable Object 仍是同一命名空间下的 `beyondfog-private-service`，未清空、未重建；限流与 `request_limits` 表未受影响。
- 未修改密码、会话密钥、`EMAIL_FROM` 与 `send_email` 绑定；未发送任何邮件。
- 未创建测试账号；测试只使用匿名请求与错误的密码。

## 8. 旧域名 302 回归

- `https://beyondfog.cc.cd/x/y?z=1` → `302` → `https://search.foghub.org/x/y?z=1`（路径与查询保留）。
- `assets.run_worker_first: true` 保持不变，旧域名的所有路径仍先进入 Worker 再决定跳转。
- 跳转使用 302 而非 301，浏览器不会永久缓存，回滚成本低。

## 9. 遗留问题与风险

1. `workers_dev` 仍为 `true`，`https://beyondfog.fogpurification.workers.dev` 可以加载同一份匿名页面；API 调用会因 Origin 不在白名单而被 403 拒绝。这是历史配置，本次未改动；建议后续关闭以免出现第二个公开主机名。
2. P14 的 staging Worker、D1 与 DO 命名空间仍在（无域名、无入口、无数据写入）；是否删除需另行授权。
3. 生产的登录态 UI（设置面板、偏好保存、文件夹弹层、网盘入口）本次没有在线实测，因为没有生产账号凭据，且纪律禁止创建测试账号写入生产数据。等效覆盖来自 staging 62/62 与本地 e2e 50/50。
4. RUM 修复依赖 `foghub.org` 的 Configuration Rule；若该规则被删除或 zone 级 Web Analytics 重新开启，beacon 会回来。`scripts/production-smoke.mjs` 已加入 CSP 全文与 beacon 缺失断言，可随时复测。
5. 发件人仍为 `noreply@beyondfog.cc.cd`（`foghub.org` 的 Email Routing 未启用），本次按要求未修改。

## 10. 无备份纪律确认

- 未导出、未复制、未快照任何生产 D1 数据；未复制生产密钥；未读取用户密码或会话内容。
- 未创建数据库副本、未创建 Cloudflare 版本快照、未保留临时 SQL 文件。
- 唯一的数据库操作是两条只读 `COUNT` 查询。
- 未在 `search.foghub.org` 上做任何写操作（偏好、网盘、账号均未触碰）。
