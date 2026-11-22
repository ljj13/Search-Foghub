# P13-A：Cloudflare RUM 与 CSP 冲突修复

日期：2026-11-22
生产域名：`https://search.foghub.org`
生产版本：`f358b11d-da50-48cc-8e64-4dd7c74b2dde`（commit `0d25fc5`）

## 1. 问题根因

Cloudflare 在边缘向 HTML 响应注入了 Web Analytics 的 RUM 信标：

```html
<script type="module" src="https://static.cloudflareinsights.com/beacon.min.js/vce701823e78c4301a35b7e07294d87301792088814092"
        integrity="sha512-UKNk8GbxkABxKcXYuLkO16EleLGUkcvJWtpSNmExE0Too3ZaFAxTscNWEc1OdAv5/BikHawapSCaiD2XCmp+Bw=="
        data-cf-beacon='{"version":"2024.11.0","token":"951d24ec968f49838e83d7232ab4dee1","r":1,"spa":2}'
        crossorigin="anonymous"></script>
```

而 BeyondFog 的 CSP 是 `script-src 'self'`，因此浏览器拦截该脚本并在控制台报 CSP violation。

逐项核查结果：

| 问题 | 结论 | 证据 |
|---|---|---|
| RUM 是自动注入还是应用引入 | **Cloudflare 自动注入** | 仓库 `src/`、`index.html`、`public/` 中没有任何 `cloudflareinsights` 引用；注入的 `<script>` 带 `data-cf-beacon` 与 Cloudflare 的 integrity 哈希 |
| Web Analytics 是否整个 zone 生效 | 不是全 zone 注入 | `https://foghub.org/`（apex）与 `https://admin.proxy.foghub.org/` 的 HTML 均无信标；只有 `search.foghub.org` 被注入 |
| 能否只对 `search.foghub.org` 禁用 | **可以** | Configuration Rules 支持 `http.host eq "search.foghub.org"` + `disable_rum` |
| 是否还有其他第三方脚本 | 没有 | 修复后页面只有 `<script type="module" src="/assets/index-BJdcq09k.js">` 一个脚本 |
| CSP 由哪一层设置 | Worker 层 | `worker/headers.ts` 的 `applySecurityHeaders()`；`run_worker_first: true` 使 HTML 也经过 Worker，Worker 的头覆盖静态资源层 |
| 是否存在多个 CSP 头 | 没有 | 响应头只有一个 `content-security-policy` |
| 是否有边缘规则改 CSP | 没有 | 规则列表里此前只有重定向/缓存类模板，没有任何 Transform/Response Header 规则；本次新增的规则只做 `disable_rum` |

## 2. Cloudflare 原有设置

- Zone：`foghub.org`（`24d327f1a74ad843887d5f303db2bf99`，Free 计划）
- Web Analytics：zone 级 RUM 注入开启，`search.foghub.org` 的 HTML 被注入信标
- Configuration Rules：修复前为空
- 其他子域（`proxy.foghub.org`、`admin.proxy.foghub.org`、apex）未被注入，保持原样

## 3. 修复选择及理由

采用 **Configuration Rule 精确禁用 RUM**，不改 CSP、不改 Worker、不重新部署：

- 规则名：`Disable RUM for search.foghub.org`
- 匹配表达式：`http.host eq "search.foghub.org"`
- 操作：`禁用真实用户监视 (RUM)`（Web Analytics 性能信标已禁用）
- 状态：活动（顺序 1）

理由：

1. 冲突的根因是"多了一个不该有的脚本"，而不是"CSP 太严"。放宽 CSP 会永久削弱防护面，且需要为 Cloudflare 的域名开洞。
2. 规则按 host 精确匹配，只影响 `search.foghub.org`，不会关闭 zone 内其他业务的统计。
3. 不需要重新部署 Worker，变更可随时删除规则回滚。

未采用的方案：

- 放宽 CSP 到 `script-src 'self' https://static.cloudflareinsights.com`：违反"不盲目放宽 CSP"的要求，且 BeyondFog 并不消费 RUM 数据。
- zone 级关闭 Web Analytics：会影响 `foghub.org` 下其他站点。
- 在 Worker 里改写 HTML 删除脚本：脆弱且增加每次请求开销。

## 4. 配置变更范围

| 项目 | 变更 |
|---|---|
| Cloudflare Zone `foghub.org` | 新增 1 条 Configuration Rule（`disable_rum`，host 精确匹配） |
| Worker 代码 | 无 |
| `wrangler.jsonc` | 无 |
| D1 / Durable Objects / Secrets | 无 |
| 其他子域 | 无 |
| DNS / Email Routing | 无 |

## 5. CSP 前后差异

**没有差异**。修复前后响应头逐字相同：

```
default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: https:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'
```

`scripts/production-smoke.mjs` 现在会断言该字符串完全相等，任何弱化都会让冒烟测试失败。

## 6. 浏览器控制台验证

修复后（真实浏览器，`https://search.foghub.org/?p13=console-check`）：

- Console：0 条记录（此前每次加载都有 1 条 CSP violation）
- Network：0 个 `cloudflareinsights.com` 请求
- 页面：标题 `BeyondFog · 搜索首页`，5 个默认捷径，「登录」按钮正常，脚本只有 `/assets/index-BJdcq09k.js`

## 7. 对其他域名的影响检查

| 域名 | 状态 | 信标 | 说明 |
|---|---|---|---|
| `search.foghub.org` | 200 | 无（修复目标） | 规则命中 |
| `foghub.org` | 200 | 无 | 修复前也无，未受影响 |
| `admin.proxy.foghub.org` | 200 | 无 | 修复前也无，未受影响 |
| `proxy.foghub.org` | 404（该路径本身无页面） | 无 | 未受影响 |
| `beyondfog.cc.cd` | 302 → `https://search.foghub.org/...` | — | 跳转与路径/查询保留不变 |

## 8. 正式上线状态

- 规则已在生产生效（Cloudflare 控制台显示"1 个生效 / 活动"）。
- 生产 Worker 版本未变：`f358b11d-da50-48cc-8e64-4dd7c74b2dde`。
- 生产界面未变：仍是 `main` 的 `index-BJdcq09k.js`。
- 回滚方式：删除该 Configuration Rule 即可恢复注入（无需改代码）。

## 9. 自动化回归

`scripts/production-smoke.mjs` 新增两项断言：

1. `content-security-policy` 与预期策略**完全相等**（防止被弱化）。
2. HTML 中不含 `cloudflareinsights.com/beacon` 或 `data-cf-beacon`（防止 RUM 信标回归）。

运行结果：

```
HTTPS 首页与文档安全响应头：通过
CSP 完整未被弱化、无 RUM 信标注入：通过
前端资源与私人账号信息隔离：通过
未登录私人接口与禁止缓存：通过
公开注册关闭与真实账号错误密码：通过（往返 445 ms）
```
