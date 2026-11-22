# P13-C：生产环境最终核查

日期：2026-11-22
生产域名：`https://search.foghub.org`
生产版本：`f358b11d-da50-48cc-8e64-4dd7c74b2dde`（commit `0d25fc5`，100% 流量）
现代化分支：`feat/ui-modernize` @ `3a43a2b`（未推送、未合并、未部署）

## 验收总表

| 验收项 | 结果 | 证据 |
|---|---|---|
| RUM/CSP 冲突消除 | **PASS** | 生产 HTML 无 `cloudflareinsights` 信标；浏览器 Network 0 个 beacon 请求；Console 0 条 CSP violation |
| CSP 安全性保持 | **PASS** | 响应头与修复前逐字相同，`script-src 'self'` 未放宽；冒烟脚本断言完整字符串相等 |
| BeyondFog 正式首页 | **PASS** | `https://search.foghub.org/` 200，标题「BeyondFog · 搜索首页」，5 个默认捷径，bundle `/assets/index-BJdcq09k.js` |
| 旧域名 302 | **PASS** | `https://beyondfog.cc.cd/a/b?c=1` → 302 `https://search.foghub.org/a/b?c=1`（路径与查询保留） |
| Better Auth | **PASS** | `get-session` 200/null；错误密码 401 `INVALID_EMAIL_OR_PASSWORD`；注册 403；未登录私人接口 401 + `no-store` |
| 生产 D1/DO 未变化 | **PASS** | `main` 的 `wrangler.jsonc`：D1 `f2bb555f-83d0-4bb4-8ff8-d0b7a0995669`、DO `BeyondFogService`、`APP_ORIGIN https://search.foghub.org`、`run_worker_first: true`；部署版本仍为 `f358b11d` |
| 现代化 Preview 隔离 | **BLOCKED** | 云端 Preview 未创建（`wrangler preview` 沿用生产 D1/DO，无绑定覆盖参数）；本地 dev + 本地 D1/DO 隔离已验证 |
| 现代化桌面界面 | **PASS** | 1440×900：溢出 0、Console 0、设置面板 460×900 不越界、文件夹弹层 360×201 不越界 |
| 现代化移动端界面 | **PASS** | 390×844：溢出 0、Console 0、设置面板全屏不越界、文件夹弹层为底部抽屉 366×205 @ x=12 |
| 单元测试 | **PASS** | `npx vitest run` 78/78（10 文件，2.91s） |
| Playwright | **PASS** | `npx playwright test` 50/50（3.2m） |
| main 未合并现代化代码 | **PASS** | `main` 仍为 `0d25fc5`；`git log main..feat/ui-modernize` 只有分支自己的 2 个提交 |
| 生产未部署现代化界面 | **PASS** | 生产 bundle 仍为 `index-BJdcq09k.js`（main 构建产物）；部署版本 `f358b11d` 未变 |

## 逐项说明

### 1. RUM/CSP 冲突

- 根因：Cloudflare 边缘向 `search.foghub.org` 的 HTML 注入 Web Analytics 信标，被 `script-src 'self'` 拦截。
- 修复：新增 Configuration Rule `Disable RUM for search.foghub.org`（`http.host eq "search.foghub.org"` + `disable_rum`），未改 CSP、未改 Worker、未重新部署。
- 验证：HTML 无信标、Network 无 beacon、Console 0 条、CSP 逐字不变。详见 `docs/P13_RUM_CSP_FIX.md`。

### 2. 生产资源未变化

- Worker 名称、Custom Domain、D1、DO、Secrets、Email Routing、DNS 均未改动。
- 本轮唯一的 Cloudflare 变更是 1 条 Configuration Rule。
- 未执行任何数据库迁移、未创建备份/副本/快照、未发送真实邮件。

### 3. 其他子域

| 域名 | 状态 | 信标 | 说明 |
|---|---|---|---|
| `foghub.org` | 200 | 无 | 修复前也无，未受影响 |
| `admin.proxy.foghub.org` | 200 | 无 | 修复前也无，未受影响 |
| `proxy.foghub.org` | 404（该路径本身无页面） | 无 | 未受影响 |
| `beyondfog.cc.cd` | 302 | — | 跳转不变 |

规则按 host 精确匹配，不会关闭 zone 内其他业务的统计。

### 4. 现代化 Preview

- 未创建云端 Preview：`wrangler preview`（4.147.0）会把当前 Worker 作为 Preview 部署并**沿用生产 D1/DO/EMAIL 绑定**，且没有绑定覆盖参数；用它做登录/偏好测试会写生产数据，违反隔离要求。
- 降级为本地 dev server + Playwright：本地 D1（`.wrangler/state`）、本地 DO、`.dev.vars` 密钥、测试账号 `owner@example.com`，与生产完全隔离。
- 因此"现代化 Preview 隔离"标记为 **BLOCKED**（云端部分未完成），本地隔离已验证。
- 详见 `docs/P13_UI_PREVIEW.md`。

### 5. 自动化回归

`scripts/production-smoke.mjs` 新增两项断言（CSP 完整字符串相等、HTML 无 RUM 信标），运行结果：

```
HTTPS 首页与文档安全响应头：通过
CSP 完整未被弱化、无 RUM 信标注入：通过
前端资源与私人账号信息隔离：通过
未登录私人接口与禁止缓存：通过
公开注册关闭与真实账号错误密码：通过（往返 445 ms）
```

### 6. CI/CD

仓库没有 `.github/` 目录，也没有其他自动部署配置；推送 `feat/ui-modernize` 不会触发生产部署。

## 未完成 / 未验证项

| 项目 | 状态 | 原因 |
|---|---|---|
| 云端 Preview 部署 | NOT DONE | 无法在满足数据隔离的前提下创建（见上） |
| 现代化分支推送 | NOT DONE | 本轮要求不合并、不部署；分支保留在本地 |
| 生产性能对比 | NOT TESTED | 本地 dev 与生产 CDN 不可比，只比较了构建产物体积 |
| 浅色主题 | N/A | 产品只有深色雾景主题 |

## 结论

- 生产环境：`https://search.foghub.org` 运行 `f358b11d`（`main` 的 `0d25fc5`），界面为原版，RUM/CSP 冲突已消除，CSP 未被弱化，旧域名 302 正常。
- 现代化前端：`feat/ui-modernize` @ `3a43a2b` 独立存在，单元 78/78、e2e 50/50、三视口真实浏览器验收通过，建议未来单独安排发布窗口上线。
- 本轮未合并、未部署、未推送现代化分支。
