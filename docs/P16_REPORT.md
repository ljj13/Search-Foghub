# P16 — 品牌统一为 FogHub

日期：2026-11-23  
线上站点：<https://search.foghub.org>  
部署版本：`a9a1134c-9d6c-447b-bf5c-8a3304d9960c`（Cloudflare Workers，100% 流量）  
提交：`ccf459e feat: rebrand the site as FogHub`（已推送 `main`）

## 结果

页面左上角现在显示「☁ FogHub」，整块 Logo 是可点击的链接，指向 <https://foghub.org/>。全站用户可见的 BeyondFog 文案已统一为 FogHub，界面、壁纸、搜索、快捷方式与个人功能均未改变。

## 改动清单

| 位置 | 原文案 | 现文案 |
| --- | --- | --- |
| 顶栏 Logo | `BeyondFog` | `FogHub`（云朵图标保留，整块区域为 `<a href="https://foghub.org/">`） |
| 页脚标语 | `BEYOND THE FOG, MORE TO DISCOVER.` | `FOGHUB — EXPLORE BEYOND THE ORDINARY.` |
| 页面标题 | `BeyondFog · 搜索首页` | `FogHub · 搜索首页` |
| Meta description | `BeyondFog — 你的搜索首页` | `FogHub — 你的搜索首页` |
| 登录/设置弹窗顶部小标题 | `BEYONDFOG` | `FOGHUB` |
| 设置 · 账号页 | 「欢迎来到 BeyondFog」/「BeyondFog」/「BeyondFog 1.0」 | 同上三处改为 FogHub |
| 密码重置邮件 | 发件人 `BeyondFog`、主题「重置 BeyondFog 密码」 | 发件人 `FogHub`、主题「重置 FogHub 密码」 |
| 网盘默认目录 | `BeyondFog/wallpapers` | `FogHub/wallpapers`（仅新建连接的默认值，已保存的连接不受影响） |

## 修改文件

- `index.html`
- `src/App.tsx`（Logo 结构与页脚标语）
- `src/Modal.tsx`（弹窗 eyebrow）
- `src/Settings.tsx`（账号页文案）
- `src/styles/base.css`（`.brand` 的悬停与键盘焦点反馈）
- `worker/auth.ts`（重置邮件发件人与主题）
- `worker/webdav.ts`（默认目录默认值）

## 刻意保留的内部标识

为避免影响的只是外观，以下内容一个字节都没动：GitHub 仓库名、Cloudflare Worker 名 `beyondfog`、D1 数据库与其 ID、Durable Object 类 `BeyondFogService` 与实例名 `beyondfog-private-service`、Better Auth 的 `appName`/`cookiePrefix`/密钥、API 路径、数据表与迁移、环境变量名、历史部署标识、`localStorage` 快照键 `beyondfog.snapshot.v2`、旧域名 `beyondfog.cc.cd` 及其 302 跳转。用户偏好、帐号、会话与网盘连接均未触碰。

## 验证（线上）

因为本次只改文案与 Logo 结构，按任务要求没有重跑完整单元测试、Playwright 套件或 Staging 验收；`npm run build`（含 `tsc --noEmit`）通过。上线后用真实浏览器对生产站点逐项核对：

- Logo 文本 `FogHub`，`href=https://foghub.org/`，`aria-label="FogHub 首页"`；
- 整块 Logo 是页面第一个 Tab 停靠点，焦点环为 2px 实线（`rgb(167, 209, 238)`）；
- 悬停透明度过渡到 `0.78`；
- 点击后确实跳转到 `https://foghub.org/`；
- 页脚标语为 `FOGHUB — EXPLORE BEYOND THE ORDINARY.`；
- 390×844 移动端 Logo 位置 `x=22, y=31`，与右上角登录/设置按钮不重叠；
- 桌面与移动端控制台均无报错；
- `GET https://search.foghub.org/` 返回 200，`<title>` 为 `FogHub · 搜索首页`，bundle 为新版 `index-BfzNNe7m.js`，HTML 中已无 `BeyondFog`。

截图：`.artifacts/p16/desktop.png`、`.artifacts/p16/mobile.png`（仅本地保留，未入库）。
